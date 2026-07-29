import { sha256Hex } from "./exact.js";
import {
  classifyFingerprintDocuments,
  isKeywordFallback,
  scoreFingerprintMatch
} from "./matcher.js";
import {
  buildBoundedFingerprintDocument,
  buildFingerprintDocument
} from "./profile.js";
import {
  LEXICAL_PROFILE,
  type Fingerprint,
  type FingerprintDocument,
  type MatchResult
} from "./types.js";

export type FingerprintText = string | Uint8Array;
export type FingerprintTextProvider = () => FingerprintText;

export interface FingerprintIndexLimits {
  maxPostingsPerHash: number;
  maxFingerprintsPerDocument: number;
  maxQueryFingerprints: number;
  maxColdDocumentsPerQuery: number;
  maxCandidateDocuments: number;
  maxVerificationsPerQuery: number;
  maxEstimatedBytes: number;
}

export const DEFAULT_INDEX_LIMITS: Readonly<FingerprintIndexLimits> = Object.freeze({
  maxPostingsPerHash: 128,
  maxFingerprintsPerDocument: 50_000,
  maxQueryFingerprints: 4_096,
  maxColdDocumentsPerQuery: 32,
  maxCandidateDocuments: 32,
  maxVerificationsPerQuery: 16,
  maxEstimatedBytes: 64 * 1024 * 1024
});

export interface FingerprintRegistration {
  id: string;
  textProvider: FingerprintTextProvider;
  versionProvider?: () => string | number;
}

export interface FingerprintIndexMatch {
  documentId: string;
  result: MatchResult;
  /**
   * Present when the result describes a bounded byte range rather than the
   * complete registered document. Callers must create or reuse a span handle
   * for this range before exposing an exact match.
   */
  window?: FingerprintMatchWindow;
  alignment?: FingerprintMatchAlignment;
}

export interface FingerprintMatchWindow {
  rawByteStart: number;
  rawByteEnd: number;
}

export interface FingerprintMatchAlignment {
  dominantTokenOffset: number | null;
  dominantVotes: number;
  usefulVotes: number;
  coherentPeaks: number;
}

export interface FingerprintSearchDiagnostics {
  profile: typeof LEXICAL_PROFILE.id;
  searchComplete: boolean;
  fallbackRequired: boolean;
  limitsHit: string[];
  queryFingerprints: number;
  warmedDocuments: number;
  coldDocumentsRemaining: number;
  candidateDocuments: number;
  verifiedCandidates: number;
  suppressedHashes: number;
  estimatedIndexBytes: number;
  evictions: number;
  staleDocuments: string[];
}

export interface FingerprintSearchResult {
  matches: FingerprintIndexMatch[];
  diagnostics: FingerprintSearchDiagnostics;
}

export interface FingerprintIndexStats {
  profile: typeof LEXICAL_PROFILE.id;
  registeredDocuments: number;
  warmDocuments: number;
  coldDocuments: number;
  postingHashes: number;
  suppressedHashes: number;
  estimatedIndexBytes: number;
  evictions: number;
  incompleteSearches: number;
}

interface Posting {
  documentId: string;
  position: number;
  rawByteStart: number;
  rawByteEnd: number;
}

interface RegistrationRecord extends FingerprintRegistration {
  generation: number;
}

interface WarmDocument {
  fingerprint: FingerprintDocument;
  indexedFingerprints: Fingerprint[];
  estimatedBytes: number;
  lastAccess: number;
  complete: boolean;
  generation: number;
  sourceVersion?: string | number;
}

interface PreliminaryCandidate {
  documentId: string;
  votes: number;
  coherentVotes: number;
  dominantVotes: number;
  alignmentDominance: number;
  alignmentPeaks: number;
  dominantTokenOffset: number | null;
  rawByteOffsets: OffsetPeak[];
  tokenContainment: number;
  characterJaccard: number;
}

interface CandidateVotes {
  total: number;
  tokenTotal: number;
  tokenOffsets: Map<number, number>;
  rawByteOffsets: Map<number, number>;
}

interface RankedCandidateVotes {
  documentId: string;
  votes: CandidateVotes;
  coherentVotes: number;
  dominantVotes: number;
}

interface OffsetPeak {
  offset: number;
  votes: number;
}

interface MaterializedWindow {
  bytes: Uint8Array;
  rawByteStart: number;
  rawByteEnd: number;
}

export class LazyFingerprintIndex {
  readonly limits: Readonly<FingerprintIndexLimits>;
  #registrations = new Map<string, RegistrationRecord>();
  #warmDocuments = new Map<string, WarmDocument>();
  #postings = new Map<string, Posting[]>();
  #stoppedHashes = new Set<string>();
  #reverseHashCounts = new Map<string, Map<string, number>>();
  #globalHashCounts = new Map<string, number>();
  #estimatedBytes = 0;
  #clock = 0;
  #generation = 0;
  #evictions = 0;
  #incompleteSearches = 0;

  constructor(limits: Partial<FingerprintIndexLimits> = {}) {
    this.limits = Object.freeze(validateLimits({ ...DEFAULT_INDEX_LIMITS, ...limits }));
  }

  registerDocument(registration: FingerprintRegistration): void {
    assertDocumentId(registration.id);
    if (typeof registration.textProvider !== "function") {
      throw new TypeError("textProvider must be a function");
    }
    if (
      registration.versionProvider !== undefined
      && typeof registration.versionProvider !== "function"
    ) {
      throw new TypeError("versionProvider must be a function");
    }
    if (this.#registrations.has(registration.id)) {
      this.invalidateDocument(registration.id);
    }
    this.#registrations.set(registration.id, {
      ...registration,
      generation: ++this.#generation
    });
  }

  unregisterDocument(documentId: string): boolean {
    assertDocumentId(documentId);
    const existed = this.#registrations.delete(documentId);
    this.#removeWarmDocument(documentId);
    return existed;
  }

  invalidateDocument(documentId: string): boolean {
    assertDocumentId(documentId);
    return this.#removeWarmDocument(documentId);
  }

  warmDocument(documentId: string): boolean {
    assertDocumentId(documentId);
    const registration = this.#registrations.get(documentId);
    if (!registration) {
      throw new Error(`Unknown fingerprint document: ${documentId}`);
    }
    const existing = this.#warmDocuments.get(documentId);
    if (existing?.generation === registration.generation) {
      existing.lastAccess = ++this.#clock;
      return false;
    }
    if (existing) {
      this.#removeWarmDocument(documentId);
    }

    const content = registration.textProvider();
    assertFingerprintText(content);
    const limited = buildBoundedFingerprintDocument(
      content,
      this.limits.maxFingerprintsPerDocument
    );
    const indexedFingerprints = combinedFingerprints(limited.document);
    const record: WarmDocument = {
      fingerprint: limited.document,
      indexedFingerprints,
      estimatedBytes: estimateDocumentBytes(limited.document, indexedFingerprints.length),
      lastAccess: ++this.#clock,
      complete: limited.complete,
      generation: registration.generation,
      sourceVersion: readSourceVersion(registration)
    };

    this.#warmDocuments.set(documentId, record);
    this.#estimatedBytes += record.estimatedBytes;
    this.#addPostings(documentId, indexedFingerprints);
    this.#enforceMemoryLimit(documentId);
    return true;
  }

  search(queryText: FingerprintText): FingerprintSearchResult {
    assertFingerprintText(queryText);
    const limitsHit = new Set<string>();
    const staleDocuments: string[] = [];
    this.#invalidateChangedDocuments(staleDocuments);
    if (staleDocuments.length > 0) {
      limitsHit.add("stale_document");
    }
    const evictionsBefore = this.#evictions;
    const limitedQuery = buildBoundedFingerprintDocument(
      queryText,
      this.limits.maxQueryFingerprints
    );
    const query = limitedQuery.document;
    const queryFingerprints = combinedFingerprints(query);
    if (!limitedQuery.complete) {
      limitsHit.add("query_fingerprint_limit");
    }
    let stoppedQueryFingerprints = queryFingerprints.filter((fingerprint) => (
      this.#stoppedHashes.has(postingKey(fingerprint))
    )).length;
    if (stoppedQueryFingerprints > 0) {
      limitsHit.add("suppressed_hash_limit");
    }
    if (queryFingerprints.length === 0 || isKeywordFallback(query)) {
      limitsHit.add("query_low_entropy");
      this.#incompleteSearches += 1;
      return {
        matches: [],
        diagnostics: {
          profile: LEXICAL_PROFILE.id,
          searchComplete: false,
          fallbackRequired: true,
          limitsHit: [...limitsHit].sort(),
          queryFingerprints: queryFingerprints.length,
          warmedDocuments: this.#warmDocuments.size,
          coldDocumentsRemaining: this.#coldDocumentIds().length,
          candidateDocuments: 0,
          verifiedCandidates: 0,
          suppressedHashes: this.#stoppedHashes.size,
          estimatedIndexBytes: this.#estimatedBytes,
          evictions: this.#evictions,
          staleDocuments: staleDocuments.sort()
        }
      };
    }

    const coldBefore = this.#coldDocumentIds();
    const toWarm = coldBefore.slice(0, this.limits.maxColdDocumentsPerQuery);
    if (coldBefore.length > toWarm.length) {
      limitsHit.add("cold_document_limit");
    }
    for (const documentId of toWarm) {
      try {
        this.warmDocument(documentId);
      } catch (error) {
        if (!isStaleSourceError(error)) {
          throw error;
        }
        staleDocuments.push(documentId);
        limitsHit.add("stale_document");
        this.invalidateDocument(documentId);
      }
    }
    stoppedQueryFingerprints = queryFingerprints.filter((fingerprint) => (
      this.#stoppedHashes.has(postingKey(fingerprint))
    )).length;
    if (stoppedQueryFingerprints > 0) {
      limitsHit.add("suppressed_hash_limit");
    }
    if ([...this.#warmDocuments.values()].some((document) => !document.complete)) {
      limitsHit.add("document_fingerprint_limit");
    }

    const candidateVotes = this.#candidateVotes(queryFingerprints);
    let voteCandidates = [...candidateVotes.entries()]
      .map(([documentId, votes]) => rankCandidateVotes(documentId, votes))
      .sort(compareRankedCandidateVotes);
    if (voteCandidates.length > this.limits.maxCandidateDocuments) {
      voteCandidates = voteCandidates.slice(0, this.limits.maxCandidateDocuments);
      limitsHit.add("candidate_document_limit");
    }

    const candidates = voteCandidates
      .map((candidate) => preliminaryCandidate(
        candidate.documentId,
        candidate.votes,
        query,
        this.#warmDocuments.get(candidate.documentId)?.fingerprint
      ))
      .filter((candidate): candidate is PreliminaryCandidate => Boolean(candidate))
      .sort(comparePreliminaryCandidates);

    const selectedForVerification = candidates.slice(0, this.limits.maxVerificationsPerQuery);
    if (candidates.length > selectedForVerification.length) {
      limitsHit.add("verification_limit");
    }

    const matches: FingerprintIndexMatch[] = [];
    for (const candidate of selectedForVerification) {
      const registration = this.#registrations.get(candidate.documentId);
      const warm = this.#warmDocuments.get(candidate.documentId);
      if (!registration || !warm) {
        continue;
      }
      let candidateText: FingerprintText;
      try {
        candidateText = registration.textProvider();
      } catch (error) {
        if (!isStaleSourceError(error)) {
          throw error;
        }
        staleDocuments.push(candidate.documentId);
        limitsHit.add("stale_document");
        this.invalidateDocument(candidate.documentId);
        continue;
      }
      assertFingerprintText(candidateText);
      if (sha256Hex(candidateText) !== warm.fingerprint.sha256) {
        staleDocuments.push(candidate.documentId);
        limitsHit.add("stale_document");
        this.invalidateDocument(candidate.documentId);
        continue;
      }
      warm.lastAccess = ++this.#clock;
      const fullDocumentResult = classifyFingerprintDocuments(
        query,
        warm.fingerprint,
        queryText,
        candidateText
      );
      const materialized = materializeCandidateWindow(
        query,
        queryText,
        warm.fingerprint,
        candidateText,
        candidate
      );
      const windowResult = materialized
        ? classifyFingerprintDocuments(
          query,
          buildFingerprintDocument(materialized.bytes),
          queryText,
          materialized.bytes
        )
        : undefined;
      const useWindow = Boolean(
        materialized
        && windowResult
        && shouldUseWindowResult(windowResult, fullDocumentResult)
      );
      matches.push({
        documentId: candidate.documentId,
        result: useWindow ? windowResult! : fullDocumentResult,
        ...(useWindow ? {
          window: {
            rawByteStart: materialized!.rawByteStart,
            rawByteEnd: materialized!.rawByteEnd
          }
        } : {}),
        alignment: {
          dominantTokenOffset: candidate.dominantTokenOffset,
          dominantVotes: candidate.dominantVotes,
          usefulVotes: candidate.votes,
          coherentPeaks: candidate.alignmentPeaks
        }
      });
    }
    matches.sort(compareFinalMatches);

    const coldAfter = this.#coldDocumentIds();
    if (this.#evictions > evictionsBefore) {
      limitsHit.add("memory_limit");
    }
    const searchComplete = limitsHit.size === 0;
    if (!searchComplete) {
      this.#incompleteSearches += 1;
    }
    return {
      matches,
      diagnostics: {
        profile: LEXICAL_PROFILE.id,
        searchComplete,
        fallbackRequired: (
          queryFingerprints.length === 0
          || stoppedQueryFingerprints === queryFingerprints.length
        ),
        limitsHit: [...limitsHit].sort(),
        queryFingerprints: queryFingerprints.length,
        warmedDocuments: this.#warmDocuments.size,
        coldDocumentsRemaining: coldAfter.length,
        candidateDocuments: candidates.length,
        verifiedCandidates: matches.length,
        suppressedHashes: this.#stoppedHashes.size,
        estimatedIndexBytes: this.#estimatedBytes,
        evictions: this.#evictions,
        staleDocuments: staleDocuments.sort()
      }
    };
  }

  stats(): FingerprintIndexStats {
    return {
      profile: LEXICAL_PROFILE.id,
      registeredDocuments: this.#registrations.size,
      warmDocuments: this.#warmDocuments.size,
      coldDocuments: this.#registrations.size - this.#warmDocuments.size,
      postingHashes: this.#postings.size,
      suppressedHashes: this.#stoppedHashes.size,
      estimatedIndexBytes: this.#estimatedBytes,
      evictions: this.#evictions,
      incompleteSearches: this.#incompleteSearches
    };
  }

  clear(): void {
    this.#registrations.clear();
    this.#warmDocuments.clear();
    this.#postings.clear();
    this.#stoppedHashes.clear();
    this.#reverseHashCounts.clear();
    this.#globalHashCounts.clear();
    this.#estimatedBytes = 0;
    this.#clock = 0;
    this.#evictions = 0;
    this.#incompleteSearches = 0;
  }

  #candidateVotes(queryFingerprints: readonly Fingerprint[]): Map<string, CandidateVotes> {
    const votes = new Map<string, CandidateVotes>();
    for (const fingerprint of queryFingerprints) {
      const key = postingKey(fingerprint);
      if (this.#stoppedHashes.has(key)) {
        continue;
      }
      for (const posting of this.#postings.get(key) ?? []) {
        const summary = votes.get(posting.documentId) ?? {
          total: 0,
          tokenTotal: 0,
          tokenOffsets: new Map<number, number>(),
          rawByteOffsets: new Map<number, number>()
        };
        summary.total += 1;
        incrementCount(
          summary.rawByteOffsets,
          posting.rawByteStart - fingerprint.rawByteStart
        );
        if (fingerprint.channel === "token") {
          summary.tokenTotal += 1;
          incrementCount(
            summary.tokenOffsets,
            posting.position - fingerprint.position
          );
        }
        votes.set(posting.documentId, summary);
      }
    }
    return votes;
  }

  #invalidateChangedDocuments(staleDocuments: string[]): void {
    for (const [documentId, warm] of [...this.#warmDocuments.entries()].sort(
      ([leftId], [rightId]) => compareIds(leftId, rightId)
    )) {
      const registration = this.#registrations.get(documentId);
      if (!registration?.versionProvider) {
        continue;
      }
      const currentVersion = readSourceVersion(registration);
      if (currentVersion !== warm.sourceVersion) {
        staleDocuments.push(documentId);
        this.#removeWarmDocument(documentId);
      }
    }
  }

  #addPostings(documentId: string, fingerprints: readonly Fingerprint[]): void {
    const documentCounts = new Map<string, number>();
    for (const fingerprint of fingerprints) {
      const key = postingKey(fingerprint);
      documentCounts.set(key, (documentCounts.get(key) ?? 0) + 1);
      const count = (this.#globalHashCounts.get(key) ?? 0) + 1;
      this.#globalHashCounts.set(key, count);
      if (this.#stoppedHashes.has(key)) {
        continue;
      }
      if (count > this.limits.maxPostingsPerHash) {
        this.#stoppedHashes.add(key);
        this.#postings.delete(key);
        continue;
      }
      const bucket = this.#postings.get(key) ?? [];
      bucket.push({
        documentId,
        position: fingerprint.position,
        rawByteStart: fingerprint.rawByteStart,
        rawByteEnd: fingerprint.rawByteEnd
      });
      this.#postings.set(key, bucket);
    }
    this.#reverseHashCounts.set(documentId, documentCounts);
  }

  #removeWarmDocument(documentId: string): boolean {
    const warm = this.#warmDocuments.get(documentId);
    if (!warm) {
      return false;
    }
    this.#warmDocuments.delete(documentId);
    this.#estimatedBytes = Math.max(0, this.#estimatedBytes - warm.estimatedBytes);

    const documentCounts = this.#reverseHashCounts.get(documentId) ?? new Map();
    for (const [key, removedCount] of documentCounts) {
      const remaining = Math.max(0, (this.#globalHashCounts.get(key) ?? 0) - removedCount);
      if (remaining === 0) {
        this.#globalHashCounts.delete(key);
        this.#stoppedHashes.delete(key);
        this.#postings.delete(key);
      } else {
        this.#globalHashCounts.set(key, remaining);
        if (!this.#stoppedHashes.has(key)) {
          const bucket = this.#postings.get(key);
          if (bucket) {
            const retained = bucket.filter((posting) => posting.documentId !== documentId);
            if (retained.length === 0) {
              this.#postings.delete(key);
            } else {
              this.#postings.set(key, retained);
            }
          }
        }
      }
    }
    this.#reverseHashCounts.delete(documentId);
    return true;
  }

  #enforceMemoryLimit(preferredDocumentId: string): void {
    while (this.#estimatedBytes > this.limits.maxEstimatedBytes && this.#warmDocuments.size > 0) {
      const candidates = [...this.#warmDocuments.entries()]
        .sort(([leftId, left], [rightId, right]) => (
          left.lastAccess - right.lastAccess || compareIds(leftId, rightId)
        ));
      const victim = candidates.find(([documentId]) => (
        documentId !== preferredDocumentId || candidates.length === 1
      ));
      if (!victim) {
        break;
      }
      this.#removeWarmDocument(victim[0]);
      this.#evictions += 1;
    }
  }

  #coldDocumentIds(): string[] {
    return [...this.#registrations.keys()]
      .filter((documentId) => !this.#warmDocuments.has(documentId))
      .sort(compareIds);
  }
}

function combinedFingerprints(document: FingerprintDocument): Fingerprint[] {
  return [...document.tokenFingerprints, ...document.characterFingerprints];
}

function preliminaryCandidate(
  documentId: string,
  votes: CandidateVotes,
  query: FingerprintDocument,
  candidate: FingerprintDocument | undefined
): PreliminaryCandidate | undefined {
  if (!candidate) {
    return undefined;
  }
  const metrics = scoreFingerprintMatch(query, candidate);
  const tokenPeaks = coherentOffsetPeaks(votes.tokenOffsets, votes.tokenTotal);
  const rawByteOffsets = sortedOffsetPeaks(votes.rawByteOffsets);
  const dominantVotes = tokenPeaks[0]?.votes ?? rawByteOffsets[0]?.votes ?? 0;
  return {
    documentId,
    votes: votes.total,
    coherentVotes: tokenPeaks.reduce((total, peak) => total + peak.votes, 0),
    dominantVotes,
    alignmentDominance: votes.tokenTotal === 0 ? 0 : dominantVotes / votes.tokenTotal,
    alignmentPeaks: tokenPeaks.length,
    dominantTokenOffset: tokenPeaks[0]?.offset ?? null,
    rawByteOffsets,
    tokenContainment: metrics.tokenContainment,
    characterJaccard: metrics.characterJaccard
  };
}

function comparePreliminaryCandidates(
  left: PreliminaryCandidate,
  right: PreliminaryCandidate
): number {
  return (
    right.dominantVotes - left.dominantVotes
    || right.coherentVotes - left.coherentVotes
    || right.alignmentDominance - left.alignmentDominance
    || right.tokenContainment - left.tokenContainment
    || right.characterJaccard - left.characterJaccard
    || right.votes - left.votes
    || compareIds(left.documentId, right.documentId)
  );
}

function compareFinalMatches(left: FingerprintIndexMatch, right: FingerprintIndexMatch): number {
  return (
    matchPriority(right.result) - matchPriority(left.result)
    || right.result.score - left.result.score
    || Number(Boolean(left.window)) - Number(Boolean(right.window))
    || compareIds(left.documentId, right.documentId)
  );
}

function rankCandidateVotes(
  documentId: string,
  votes: CandidateVotes
): RankedCandidateVotes {
  const peaks = coherentOffsetPeaks(votes.tokenOffsets, votes.tokenTotal);
  return {
    documentId,
    votes,
    coherentVotes: peaks.reduce((total, peak) => total + peak.votes, 0),
    dominantVotes: peaks[0]?.votes ?? 0
  };
}

function compareRankedCandidateVotes(
  left: RankedCandidateVotes,
  right: RankedCandidateVotes
): number {
  return (
    right.dominantVotes - left.dominantVotes
    || right.coherentVotes - left.coherentVotes
    || right.votes.total - left.votes.total
    || compareIds(left.documentId, right.documentId)
  );
}

function coherentOffsetPeaks(offsets: ReadonlyMap<number, number>, totalVotes: number): OffsetPeak[] {
  if (totalVotes === 0) {
    return [];
  }
  const threshold = Math.max(2, Math.ceil(totalVotes * 0.20));
  return sortedOffsetPeaks(offsets).filter((peak) => peak.votes >= threshold);
}

function sortedOffsetPeaks(offsets: ReadonlyMap<number, number>): OffsetPeak[] {
  return [...offsets.entries()]
    .map(([offset, votes]) => ({ offset, votes }))
    .sort((left, right) => right.votes - left.votes || left.offset - right.offset);
}

function materializeCandidateWindow(
  query: FingerprintDocument,
  queryText: FingerprintText,
  candidate: FingerprintDocument,
  candidateText: FingerprintText,
  preliminary: PreliminaryCandidate
): MaterializedWindow | undefined {
  if (query.rawByteLength === candidate.rawByteLength) {
    return undefined;
  }
  const queryBytes = toBytes(queryText);
  const candidateBytes = toBytes(candidateText);
  const rawPeak = preliminary.rawByteOffsets[0];
  if (rawPeak) {
    const exactWindow = boundedWindow(
      candidateBytes,
      rawPeak.offset,
      rawPeak.offset + query.rawByteLength
    );
    if (
      exactWindow
      && Buffer.from(exactWindow.bytes).equals(Buffer.from(queryBytes))
      && sha256Hex(exactWindow.bytes) === query.sha256
    ) {
      return exactWindow;
    }
  }

  const tokenOffset = preliminary.dominantTokenOffset;
  const queryFirst = query.tokens[0];
  const queryLast = query.tokens.at(-1);
  if (
    tokenOffset === null
    || !queryFirst
    || !queryLast
    || tokenOffset < 0
  ) {
    return undefined;
  }
  const candidateFirst = candidate.tokens[tokenOffset];
  const candidateLast = candidate.tokens[tokenOffset + query.tokens.length - 1];
  if (!candidateFirst || !candidateLast) {
    return undefined;
  }
  const leadingBytes = queryFirst.rawByteStart;
  const trailingBytes = query.rawByteLength - queryLast.rawByteEnd;
  return boundedWindow(
    candidateBytes,
    candidateFirst.rawByteStart - leadingBytes,
    candidateLast.rawByteEnd + trailingBytes
  );
}

function boundedWindow(
  candidateBytes: Uint8Array,
  rawByteStart: number,
  rawByteEnd: number
): MaterializedWindow | undefined {
  if (
    !Number.isSafeInteger(rawByteStart)
    || !Number.isSafeInteger(rawByteEnd)
    || rawByteStart < 0
    || rawByteEnd <= rawByteStart
    || rawByteEnd > candidateBytes.byteLength
  ) {
    return undefined;
  }
  return {
    bytes: candidateBytes.slice(rawByteStart, rawByteEnd),
    rawByteStart,
    rawByteEnd
  };
}

function shouldUseWindowResult(window: MatchResult, whole: MatchResult): boolean {
  if (window.matchKind === "exact") {
    return true;
  }
  if (whole.matchKind === "related_reordered") {
    return false;
  }
  return (
    matchPriority(window) > matchPriority(whole)
    || (
      matchPriority(window) === matchPriority(whole)
      && window.score > whole.score
    )
  );
}

function matchPriority(result: MatchResult): number {
  switch (result.matchKind) {
    case "exact": return 7;
    case "normalized_equal": return 6;
    case "strong_related": return 5;
    case "related_reordered": return 4;
    case "related": return 3;
    case "keyword": return 2;
    case "unrelated": return 1;
  }
}

function postingKey(fingerprint: Fingerprint): string {
  return `${fingerprint.channel}:${fingerprint.hash}`;
}

function incrementCount(counts: Map<number, number>, key: number): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function toBytes(value: FingerprintText): Uint8Array {
  return typeof value === "string"
    ? Buffer.from(value, "utf8")
    : Buffer.from(value);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function estimateDocumentBytes(document: FingerprintDocument, indexedCount: number): number {
  const structuralEstimate = (
    document.rawByteLength * 4
    + document.tokens.length * 96
    + indexedCount * 80
    + 512
  );
  /*
   * V8 object, Map, and array overhead varies across supported Node releases
   * and is substantially larger than serialized field sizes. Heap sampling of
   * this retained structure has reached roughly 3.3x the structural estimate.
   * A 4x safety factor keeps the configured budget conservative without
   * charging the temporary normalization/fingerprint build peak to the index.
   */
  return structuralEstimate * 4;
}

function validateLimits(limits: FingerprintIndexLimits): FingerprintIndexLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function assertDocumentId(documentId: string): void {
  if (typeof documentId !== "string" || documentId.length === 0 || documentId.length > 256) {
    throw new TypeError("document id must be a non-empty string of at most 256 characters");
  }
}

function assertFingerprintText(value: FingerprintText): void {
  if (typeof value !== "string" && !(value instanceof Uint8Array)) {
    throw new TypeError("text provider must return a string or Uint8Array");
  }
}

function isStaleSourceError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "STALE_SOURCE"
  );
}

function readSourceVersion(
  registration: FingerprintRegistration
): string | number | undefined {
  if (!registration.versionProvider) {
    return undefined;
  }
  const version = registration.versionProvider();
  if (
    typeof version !== "string"
    && !(typeof version === "number" && Number.isFinite(version))
  ) {
    throw new TypeError("versionProvider must return a string or finite number");
  }
  return version;
}
