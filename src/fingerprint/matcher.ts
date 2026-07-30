import { detectCriticalDifference } from "./critical-diff.js";
import { verifyExactBytes } from "./exact.js";
import { buildFingerprintDocument } from "./profile.js";
import type {
  Fingerprint,
  FingerprintDocument,
  MatchKind,
  MatchMetrics,
  MatchResult,
  MatchThresholds
} from "./types.js";

export const DEFAULT_MATCH_THRESHOLDS: Readonly<MatchThresholds> = Object.freeze({
  strongTokenContainment: 0.90,
  strongCharacterJaccard: 0.85,
  strongAlignmentDominance: 0.60,
  strongMinimumVotes: 3,
  relatedTokenContainment: 0.60,
  relatedCharacterJaccard: 0.65
});
const MAX_ALIGNMENT_POSITIONS_PER_HASH = 128;
const MAX_ALIGNMENT_VOTES = 100_000;

export function scoreFingerprintMatch(
  query: FingerprintDocument,
  candidate: FingerprintDocument
): MatchMetrics {
  const tokenAlignment = alignmentMetrics(
    query.tokenFingerprints,
    candidate.tokenFingerprints
  );
  return {
    tokenContainment: containment(
      query.tokenFingerprints.map((item) => item.hash),
      candidate.tokenFingerprints.map((item) => item.hash)
    ),
    characterJaccard: jaccard(
      query.characterFingerprints.map((item) => item.hash),
      candidate.characterFingerprints.map((item) => item.hash)
    ),
    alignmentDominance: tokenAlignment.dominance,
    usefulVotes: tokenAlignment.votes,
    alignmentPeaks: tokenAlignment.peaks
  };
}

export function classifyFingerprintMatch(
  queryText: string | Uint8Array,
  candidateText: string | Uint8Array,
  thresholds: Readonly<MatchThresholds> = DEFAULT_MATCH_THRESHOLDS
): MatchResult {
  const query = buildFingerprintDocument(queryText);
  const candidate = buildFingerprintDocument(candidateText);
  return classifyFingerprintDocuments(
    query,
    candidate,
    queryText,
    candidateText,
    thresholds
  );
}

export function classifyFingerprintDocuments(
  query: FingerprintDocument,
  candidate: FingerprintDocument,
  queryBytes: string | Uint8Array,
  candidateBytes: string | Uint8Array,
  thresholds: Readonly<MatchThresholds> = DEFAULT_MATCH_THRESHOLDS
): MatchResult {
  const metrics = scoreFingerprintMatch(query, candidate);
  const queryText = decodeText(queryBytes);
  const candidateText = decodeText(candidateBytes);
  const criticalDifference = detectCriticalDifference(queryText, candidateText);
  const exact = verifyExactBytes(queryBytes, candidateBytes, candidate.sha256);
  const normalizedEqual = tokenSequencesEqual(
    query.strictTokenValues,
    candidate.strictTokenValues
  );
  const tooWeakForFingerprinting = isKeywordFallback(query);
  const strongSignals = (
    metrics.tokenContainment >= thresholds.strongTokenContainment
    && metrics.characterJaccard >= thresholds.strongCharacterJaccard
    && metrics.usefulVotes >= thresholds.strongMinimumVotes
  );
  const reorderedSignals = (
    metrics.tokenContainment >= thresholds.relatedTokenContainment
    && metrics.characterJaccard >= thresholds.strongCharacterJaccard
    && metrics.usefulVotes >= thresholds.strongMinimumVotes
    && metrics.alignmentPeaks >= 2
  );

  let matchKind: MatchKind;
  if (exact) {
    matchKind = "exact";
  } else if (normalizedEqual) {
    matchKind = "normalized_equal";
  } else if (tooWeakForFingerprinting) {
    matchKind = "keyword";
  } else if (reorderedSignals) {
    matchKind = "related_reordered";
  } else if (
    strongSignals
    && metrics.alignmentDominance >= thresholds.strongAlignmentDominance
    && !criticalDifference.different
  ) {
    matchKind = "strong_related";
  } else if (
    metrics.tokenContainment >= thresholds.relatedTokenContainment
    || metrics.characterJaccard >= thresholds.relatedCharacterJaccard
  ) {
    matchKind = "related";
  } else {
    matchKind = "unrelated";
  }

  return {
    matchKind,
    score: exact ? 1 : compositeScore(metrics),
    exact,
    mustExpand: !exact,
    criticalDiff: criticalDifference.different,
    metrics,
    criticalDifference
  };
}

function alignmentMetrics(
  query: readonly Fingerprint[],
  candidate: readonly Fingerprint[]
): { dominance: number; votes: number; peaks: number } {
  const candidatePositions = new Map<string, number[]>();
  for (const item of candidate) {
    const positions = candidatePositions.get(item.hash) ?? [];
    if (positions.length < MAX_ALIGNMENT_POSITIONS_PER_HASH) {
      positions.push(item.position);
    }
    candidatePositions.set(item.hash, positions);
  }

  const offsets = new Map<number, number>();
  let votes = 0;
  for (const queryItem of query) {
    for (const candidatePosition of candidatePositions.get(queryItem.hash) ?? []) {
      if (votes >= MAX_ALIGNMENT_VOTES) {
        break;
      }
      const offset = candidatePosition - queryItem.position;
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
      votes += 1;
    }
    if (votes >= MAX_ALIGNMENT_VOTES) {
      break;
    }
  }
  if (votes === 0) {
    return { dominance: 0, votes: 0, peaks: 0 };
  }

  const sortedCounts = [...offsets.values()].sort((left, right) => right - left);
  const peakThreshold = Math.max(2, Math.ceil(votes * 0.20));
  return {
    dominance: sortedCounts[0]! / votes,
    votes,
    peaks: sortedCounts.filter((count) => count >= peakThreshold).length
  };
}

function containment(queryHashes: readonly string[], candidateHashes: readonly string[]): number {
  const querySet = new Set(queryHashes);
  if (querySet.size === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateHashes);
  let intersection = 0;
  for (const hash of querySet) {
    if (candidateSet.has(hash)) {
      intersection += 1;
    }
  }
  return intersection / querySet.size;
}

function jaccard(leftHashes: readonly string[], rightHashes: readonly string[]): number {
  const left = new Set(leftHashes);
  const right = new Set(rightHashes);
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const hash of left) {
    if (right.has(hash)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

export function isKeywordFallback(query: FingerprintDocument): boolean {
  const values = query.strictTokenValues;
  if (query.tokenFingerprints.length === 0 || values.length < 5) {
    return true;
  }
  const counts = new Map(values.map((value) => [value, 0]));
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let highestFrequency = 0;
  for (const count of counts.values()) {
    highestFrequency = Math.max(highestFrequency, count);
  }
  return counts.size < 3 || highestFrequency / values.length > 0.80;
}

function tokenSequencesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function compositeScore(metrics: MatchMetrics): number {
  const score = (
    metrics.tokenContainment * 0.50
    + metrics.characterJaccard * 0.30
    + metrics.alignmentDominance * 0.20
  );
  return Math.max(0, Math.min(1, Number(score.toFixed(6))));
}

function decodeText(value: string | Uint8Array): string {
  if (typeof value === "string") {
    return value;
  }
  const bytes = Buffer.from(value);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new TypeError("fingerprint input must be valid UTF-8");
  }
  return text;
}
