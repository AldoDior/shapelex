import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  LEXICAL_PROFILE,
  LazyFingerprintIndex,
  type FingerprintMatchAlignment,
  type FingerprintMatchWindow,
  type MatchResult
} from "./fingerprint/index.js";
import {
  StoreBusyError,
  StoreRevisionConflictError,
  TransactionalStoreV2,
  sourceRecordFromMaterial,
  type StoreSourceRecord
} from "./storage/index.js";

export type { MatchKind } from "./fingerprint/index.js";

export interface CompactMatch {
  uri: string;
  matchKind:
    | "exact"
    | "normalized_equal"
    | "strong_related"
    | "related_reordered"
    | "related"
    | "keyword"
    | "unrelated";
  score: number;
  exact: boolean;
  mustExpand: boolean;
  criticalDiff: boolean;
}

const DEFAULT_SESSION_ID = "default";
const DEFAULT_STORE_FILE = "shapelex-store.json";
export const DEFAULT_MAX_STORE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_TEXT_BYTES = MAX_TEXT_CHARS * 4;
const MAX_QUERY_CHARS = 2_000;
const MAX_LABEL_CHARS = 200;
const LONG_SPAN_CHARS = 240;
const RECENT_MESSAGE_CHARS = 900;
const MIN_TOKEN_SAVINGS_RATIO = 0.15;
const TOKEN_ESTIMATOR_ID = "shapelex-heuristic-v1";
const MAX_USAGE_EVENTS_PER_SESSION = 500;
const MAX_ANCHORS = 12;
const CONTEXT_RADIUS = 90;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const TEXT_MODES = new Set(["text", "doc", "message", "code"]);
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "are", "was", "were", "you", "your", "about", "into", "onto", "before",
  "after", "then", "than", "they", "them", "their", "there", "here", "what",
  "when", "where", "which", "while", "also", "como", "para", "pero", "porque",
  "esta", "este", "estos", "estas", "con", "del", "las", "los", "una", "unos",
  "que", "por", "sus", "mas", "menos", "hay", "ser", "son", "fue"
]);
const PROTECTED_WORDS = new Set([
  "not", "no", "never", "without", "must", "should", "shall", "cannot", "can't",
  "do", "don't", "dont", "avoid", "only", "always", "before", "after", "unless",
  "except", "if", "else", "throw", "return", "delete", "remove", "drop", "reset",
  "approve", "deny", "allow", "block", "nunca", "jamas", "sin", "debe", "debes",
  "evita", "evitar", "solo", "siempre", "antes", "despues", "excepto", "eliminar",
  "borrar", "rechazar", "permitir", "bloquear", "prohibido"
]);
const ACTION_WORDS = new Set([
  "delete", "remove", "drop", "reset", "approve", "deny", "allow", "block",
  "return", "throw", "commit", "push", "merge", "deploy", "borrar", "eliminar",
  "aprobar", "rechazar", "permitir", "bloquear", "guardar", "ejecutar"
]);
const STORE_RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function staleSourceError(message: string, cause?: unknown) {
  const error = new Error(message, cause instanceof Error ? { cause } : undefined) as Error & {
    code: "STALE_SOURCE";
  };
  error.code = "STALE_SOURCE";
  return error;
}

function sleepForStoreRetry(milliseconds: number) {
  Atomics.wait(STORE_RETRY_SIGNAL, 0, 0, milliseconds);
}

export class ShapeLexEngine {
  sessions: Map<string, any>;
  persistent: boolean;
  maxStoreBytes: number;
  storageDir?: string;
  storePath?: string;
  gitignoreProtection?: any;
  workspaceRoot: string;
  workspaceRootReal: string;
  workspaceId: string;
  storeCoordinator?: TransactionalStoreV2<any>;
  sourceRecords: Map<string, StoreSourceRecord>;
  fingerprintIndexes: Map<string, LazyFingerprintIndex>;

  constructor({
    storageDir,
    persistent = Boolean(storageDir),
    maxStoreBytes = DEFAULT_MAX_STORE_BYTES,
    workspaceRoot = process.cwd()
  }: { storageDir?: string; persistent?: boolean; maxStoreBytes?: number; workspaceRoot?: string } = {}) {
    this.sessions = new Map();
    this.sourceRecords = new Map();
    this.fingerprintIndexes = new Map();
    this.persistent = persistent;
    this.maxStoreBytes = normalizeMaxStoreBytes(maxStoreBytes);
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.workspaceRootReal = fs.realpathSync(this.workspaceRoot);
    this.workspaceId = sourceHash(normalizeWorkspaceIdentity(this.workspaceRootReal));
    this.storageDir = this.persistent && storageDir ? path.resolve(storageDir) : undefined;
    this.storePath = this.storageDir ? path.join(this.storageDir, DEFAULT_STORE_FILE) : undefined;
    this.gitignoreProtection = this.persistent
      ? protectLocalStoreWithGitignore(this.storageDir)
      : { status: "not-needed", reason: "memory-only" };
    if (this.persistent && this.storePath) {
      this.storeCoordinator = new TransactionalStoreV2({
        storePath: this.storePath,
        persistent: true,
        maxStoreBytes: this.maxStoreBytes,
        workspaceId: this.workspaceId,
        resolveFileSource: ({ relativePath, document }) => this.#resolveLegacyFileSource(relativePath, document)
      });
    }
    this.#loadStore();
  }

  compress(input: any) {
    if (!input || typeof input !== "object") {
      throw new TypeError("input must be an object");
    }
    const mode = input.mode ?? (input.messages ? "conversation" : "text");
    if (Array.isArray(input.messages)) {
      return this.compressMessages({ ...input, mode: "conversation" });
    }
    return this.compressText({ ...input, mode });
  }

  compressText(input: any = {}) {
    return this.#retryStoreMutation(() => this.#compressText(input));
  }

  compressFile({
    sessionId = DEFAULT_SESSION_ID,
    sourcePath,
    label,
    mode,
    budgetTokens,
    text
  }: any = {}) {
    if (text !== undefined) {
      throw new TypeError("Provide sourcePath or text, not both");
    }
    assertString(sourcePath, "sourcePath");
    const source = this.#resolveWorkspaceFile(sourcePath);
    if (source.byteLength > MAX_TEXT_BYTES) {
      throw new RangeError(`source file exceeds the maximum UTF-8 size of ${MAX_TEXT_BYTES} bytes`);
    }
    const fileBuffer = fs.readFileSync(source.absolutePath);
    const fileText = fileBuffer.toString("utf8");
    if (!Buffer.from(fileText, "utf8").equals(fileBuffer)) {
      throw new Error("ShapeLex sourcePath must reference a valid UTF-8 text file");
    }
    assertBoundedString(fileText, "source file", MAX_TEXT_CHARS);
    const normalizedMode = mode === undefined ? inferFileMode(source.relativePath) : mode;
    return this.#retryStoreMutation(() => this.#compressText({
        sessionId,
        text: fileText,
        label: label ?? source.relativePath,
        mode: normalizedMode,
        budgetTokens
      }, {
        kind: "file",
        relativePath: source.relativePath,
        byteLength: fileBuffer.length
      }));
  }

  #compressText(
    { sessionId = DEFAULT_SESSION_ID, text, label = "text", mode = "text", budgetTokens }: any = {},
    fileSource?: any
  ) {
    this.#refreshStoreIfChanged();
    assertBoundedString(text, "text", MAX_TEXT_CHARS);
    const normalizedMode = normalizeTextMode(mode);
    const normalizedLabel = normalizeLabel(label);
    const sourceId = `source_${sourceHash(text)}`;
    const deduplicated = this.sourceRecords.has(sourceId);
    const session = this.#session(sessionId);
    const transaction = sessionTransactionSnapshot(session);
    const document = this.#createDocument(session, { text, label: normalizedLabel, mode: normalizedMode });
    if (fileSource) {
      try {
        this.#convertDocumentToFileBacked(session, document, fileSource);
      } catch (error) {
        rollbackDocumentTransaction(session, document, transaction);
        throw error;
      }
    } else {
      this.#convertDocumentToTextBacked(session, document);
    }
    document.handles = document.handles.map(publicHandleMetadata);
    const compressedText = renderNavigableDocument(document);
    const payload = resultPayload(session.id, compressedText, document.handles, text);

    Object.assign(payload, {
      documentId: document.id,
      uri: document.uri,
      label: document.label,
      mode: document.mode,
      levels: document.levels,
      risk: document.risk,
      confidence: document.confidence,
      code: document.code,
      conversation: document.conversation,
      source: document.source
    });
    payload.deduplicated = deduplicated;
    payload.matchKind = deduplicated ? "exact" : "unrelated";

    if (Number.isFinite(budgetTokens)) {
      payload.budgetTokens = budgetTokens;
      payload.withinBudget = payload.compressedTokenEstimate <= budgetTokens;
    }

    const result = applyCompressionPolicy(payload, text);
    this.#recordCompressionUsage(session, result, text, "text");
    try {
      this.#saveStore();
    } catch (error) {
      rollbackDocumentTransaction(session, document, transaction);
      this.#dropUnusedSourceRecords();
      throw error;
    }
    this.#registerDocumentFingerprints(session, document);
    return result;
  }

  compressMessages(input: any = {}) {
    return this.#retryStoreMutation(() => this.#compressMessages(input));
  }

  #compressMessages({ sessionId = DEFAULT_SESSION_ID, messages, budgetTokens, label = "conversation" }: any = {}) {
    this.#refreshStoreIfChanged();
    if (!Array.isArray(messages)) {
      throw new TypeError("messages must be an array");
    }
    let aggregateCharacters = 0;
    messages.forEach((message, index) => {
      assertMessage(message, index);
      aggregateCharacters += (
        String(message.role).length
        + String(index).length
        + String(message.content).length
        + 6
      );
      if (aggregateCharacters > MAX_TEXT_CHARS) {
        throw new RangeError(`messages must be ${MAX_TEXT_CHARS} characters or fewer in total`);
      }
    });
    const normalizedLabel = normalizeLabel(label);

    const text = messages
      .map((message, index) => `[${message.role ?? "unknown"}#${index}] ${message.content ?? ""}`)
      .join("\n\n");
    assertBoundedString(text, "messages", MAX_TEXT_CHARS);
    const sourceId = `source_${sourceHash(text)}`;
    const deduplicated = this.sourceRecords.has(sourceId);
    const session = this.#session(sessionId);
    const transaction = sessionTransactionSnapshot(session);
    const document = this.#createDocument(session, {
      text,
      label: normalizedLabel,
      mode: "conversation",
      messages
    });
    this.#convertDocumentToTextBacked(session, document);
    document.handles = document.handles.map(publicHandleMetadata);

    const compressedMessages = messages.map((message, index) => {
      const role = String(message.role ?? "unknown");
      const content = String(message.content ?? "");
      const isLatest = index === messages.length - 1;
      const threshold = isLatest ? RECENT_MESSAGE_CHARS : LONG_SPAN_CHARS;

      if (content.length <= threshold && !shouldCompressSpan(content)) {
        return `[${role}#${index}] ${content.trim()}`;
      }

      const handle = document.handles.find((item) => item.index === index);
      if (handle && (!isLatest || content.length > threshold)) {
        return `[${role}#${index}] ${renderHandle(handle)}`;
      }
      return `[${role}#${index}] ${content.trim()}`;
    });

    const compressedText = withInstruction([
      renderLevelSummary(document),
      compactJoin(compressedMessages)
    ].join("\n\n"));
    const payload = resultPayload(session.id, compressedText, document.handles, text);

    Object.assign(payload, {
      documentId: document.id,
      uri: document.uri,
      label: document.label,
      mode: document.mode,
      levels: document.levels,
      risk: document.risk,
      confidence: document.confidence,
      conversation: document.conversation
    });
    payload.deduplicated = deduplicated;
    payload.matchKind = deduplicated ? "exact" : "unrelated";

    if (Number.isFinite(budgetTokens)) {
      payload.budgetTokens = budgetTokens;
      payload.withinBudget = payload.compressedTokenEstimate <= budgetTokens;
    }

    const result = applyCompressionPolicy(payload, text);
    this.#recordCompressionUsage(session, result, text, "conversation");
    try {
      this.#saveStore();
    } catch (error) {
      rollbackDocumentTransaction(session, document, transaction);
      this.#dropUnusedSourceRecords();
      throw error;
    }
    this.#registerDocumentFingerprints(session, document);
    return result;
  }

  expand({ sessionId = DEFAULT_SESSION_ID, handle }: any): any {
    this.#refreshStoreIfChanged();
    assertString(handle, "handle");
    const id = normalizeSessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }

    const parsed = parseShapeLexUri(handle);
    assertUriSession(parsed.sessionId, id, handle);
    if (parsed.kind === "doc") {
      const document = session.documents.get(parsed.id);
      if (!document) {
        throw new Error(`Unknown ShapeLex document: ${handle}`);
      }
      const documentText = document.source?.kind === "file"
        ? this.#readFileDocument(document.source, handle)
        : document.source?.kind === "text"
          ? this.#readTextDocument(document.source, handle)
          : document.text;
      assertDocumentIntegrity(document, handle, documentText);
      session.lastAccessedAt = new Date().toISOString();
      return {
        handle,
        text: documentText,
        metadata: {
          documentId: document.id,
          uri: document.uri,
          label: document.label,
          mode: document.mode,
          checksum: document.checksum,
          risk: document.risk,
          source: document.source
        }
      };
    }

    const span = session.spans.get(parsed.id);
    if (!span) {
      throw new Error(`Unknown ShapeLex handle: ${handle}`);
    }
    const spanText = span.source?.kind === "file"
      ? this.#readFileSpan(span.source, handle)
      : span.source?.kind === "text"
        ? this.#readTextSpan(span.source, handle)
        : span.text;
    assertSpanIntegrity(span, handle, spanText);

    session.lastAccessedAt = new Date().toISOString();
    return {
      handle,
      text: spanText,
      metadata: {
        ...publicHandleMetadata(span.metadata),
        source: span.source
      }
    };
  }

  search(input: any = {}) {
    return this.#retryStoreMutation(() => this.#search(input));
  }

  #search({ sessionId = DEFAULT_SESSION_ID, query, mode, limit = 8 }: any = {}) {
    this.#refreshStoreIfChanged();
    assertBoundedString(query, "query", MAX_QUERY_CHARS);
    const id = normalizeSessionId(sessionId);
    const normalizedMode = mode === undefined ? undefined : normalizeSearchMode(mode);
    const normalizedLimit = normalizeLimit(limit);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }

    const queryTokens = tokenize(query).map((token) => token.toLowerCase());
    const fingerprintSearch = this.#fingerprintIndex(session).search(query);
    const results: any[] = [];
    const matchedDocuments = new Set<string>();
    const createdSpanIds: string[] = [];
    const nextSpanBeforeSearch = session.nextSpan;
    const staleDocuments = new Set(
      fingerprintSearch.diagnostics.staleDocuments
        .map((documentId) => resolveFingerprintTarget(session, documentId)?.document.id)
        .filter((documentId): documentId is string => Boolean(documentId))
    );

    for (const match of fingerprintSearch.matches) {
      if (match.result.matchKind === "unrelated") {
        continue;
      }
      let target = resolveFingerprintTarget(session, match.documentId);
      if (!target || (normalizedMode && target.document.mode !== normalizedMode)) {
        continue;
      }
      let effectiveResult = match.result;
      if (match.window && match.result.exact) {
        const materialized = this.#materializeFingerprintWindow(
          session,
          target,
          match.window,
          query
        );
        if (materialized) {
          target = materialized.target;
          if (materialized.created) {
            createdSpanIds.push(materialized.target.metadata.spanId);
          }
        } else {
          effectiveResult = downgradeUnmaterializedExactWindow(match.result);
        }
      }
      if (matchedDocuments.has(target.document.id)) {
        continue;
      }
      matchedDocuments.add(target.document.id);
      results.push(fingerprintSearchResult(target, effectiveResult, match.alignment));
    }

    for (const document of session.documents.values()) {
      if (normalizedMode && document.mode !== normalizedMode) {
        continue;
      }
      if (staleDocuments.has(document.id)) {
        continue;
      }
      if (matchedDocuments.has(document.id)) {
        continue;
      }
      const score = scoreDocument(document, queryTokens);
      if (score <= 0) {
        continue;
      }
      results.push({
        documentId: document.id,
        uri: document.uri,
        label: document.label,
        mode: document.mode,
        score: Math.min(1, score / Math.max(1, queryTokens.length)),
        matchKind: "keyword",
        exact: false,
        mustExpand: Boolean(document.risk?.mustExpand || document.risk?.shouldExpand),
        criticalDiff: false,
        risk: document.risk,
        bestAnchors: document.levels[2].anchors.filter((anchor) => queryTokens.includes(anchor.toLowerCase())).slice(0, 6),
        criticalExtracts: document.levels[3].criticalExtracts.slice(0, 3)
      });
    }

    if (createdSpanIds.length > 0) {
      try {
        this.#saveStore();
      } catch (error) {
        if (!(error instanceof StoreRevisionConflictError)) {
          for (const spanId of createdSpanIds) {
            session.spans.delete(spanId);
            session.spanToDocument.delete(spanId);
            for (const document of session.documents.values()) {
              document.handles = document.handles.filter((handle) => handle.spanId !== spanId);
              document.levels["4"].handles = document.levels["4"].handles.filter(
                (handle) => handle.uri !== `sx://${session.id}/span/${spanId}`
              );
            }
          }
          session.nextSpan = nextSpanBeforeSearch;
        }
        throw error;
      }
    }

    return {
      sessionId: id,
      query,
      searchComplete: fingerprintSearch.diagnostics.searchComplete,
      diagnostics: fingerprintSearch.diagnostics,
      results: results
        .sort(comparePublicSearchResults)
        .slice(0, normalizedLimit)
    };
  }

  retrieve({ sessionId = DEFAULT_SESSION_ID, uri, level = 1, query }: any = {}): any {
    this.#refreshStoreIfChanged();
    assertString(uri, "uri");
    const id = normalizeSessionId(sessionId);
    const normalizedLevel = normalizeLevel(level);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }

    const parsed = parseShapeLexUri(uri);
    assertUriSession(parsed.sessionId, id, uri);
    if (parsed.kind === "span") {
      return this.expand({ sessionId: id, handle: uri });
    }

    const document = session.documents.get(parsed.id);
    if (!document) {
      throw new Error(`Unknown ShapeLex document: ${uri}`);
    }

    const levels = {};
    for (const key of ["0", "1", "2", "3", "4"]) {
      if (Number(key) <= normalizedLevel) {
        levels[key] = sanitizeResourcePayload(document.levels[key]);
      }
    }

    const response: any = {
      sessionId: id,
      documentId: document.id,
      uri: document.uri,
      label: document.label,
      mode: document.mode,
      requestedLevel: normalizedLevel,
      levels,
      risk: document.risk,
      confidence: document.confidence
    };

    if (query) {
      response.search = this.search({ sessionId: id, query, mode: document.mode, limit: 5 }).results;
    }

    return response;
  }

  context({ sessionId = DEFAULT_SESSION_ID, query, mode, limit = 3, detail = "standard" }: any = {}) {
    this.#refreshStoreIfChanged();
    const id = normalizeSessionId(sessionId);
    assertBoundedString(query, "query", MAX_QUERY_CHARS);
    const normalizedMode = mode === undefined ? undefined : normalizeSearchMode(mode);
    const normalizedLimit = normalizeLimit(limit);
    const normalizedDetail = normalizeContextDetail(detail);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }

    const searchResponse = this.search({
      sessionId: id,
      query,
      mode: normalizedMode,
      limit: normalizedLimit
    });
    const matches = searchResponse.results;
    const seenDocuments = new Set<string>();
    const documents = matches.flatMap((match) => {
      if (seenDocuments.has(match.documentId)) {
        return [];
      }
      const document = session.documents.get(match.documentId);
      if (!document) {
        return [];
      }
      seenDocuments.add(match.documentId);
      return [{
        ...compactDocumentContext(document, {
          query,
          detail: normalizedDetail
        }),
        match: compactMatchMetadata(match)
      }];
    });
    const contextText = renderContextText({
      sessionId: id,
      query,
      documents,
      detail: normalizedDetail
    });

    return {
      sessionId: id,
      query,
      detail: normalizedDetail,
      searchComplete: searchResponse.searchComplete,
      results: documents,
      contextText,
      tokenEstimate: estimateTokens(contextText),
      guidance: documents.some((document) => document.risk.mustExpand || document.risk.shouldExpand)
        ? "Use this compact context for orientation. Expand listed handles before relying on exact code, numbers, commands, or user intent."
        : "Compact context is enough for orientation. Expand handles before quoting exact wording."
    };
  }

  explain({ sessionId = DEFAULT_SESSION_ID, uri }: any = {}) {
    this.#refreshStoreIfChanged();
    assertString(uri, "uri");
    const id = normalizeSessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }
    const parsed = parseShapeLexUri(uri);
    assertUriSession(parsed.sessionId, id, uri);
    const document = parsed.kind === "doc"
      ? session.documents.get(parsed.id)
      : session.documents.get(session.spanToDocument.get(parsed.id));

    if (!document) {
      throw new Error(`Unknown ShapeLex URI: ${uri}`);
    }

    return {
      uri,
      documentId: document.id,
      mode: document.mode,
      explanation: [
        "Level 0 is a short orientation summary.",
        "Level 1 is a navigable semantic map.",
        "Level 2 exposes model-readable anchors; internal fingerprints stay private.",
        "Level 3 preserves exact critical extracts.",
        "Level 4 contains exact expandable handles."
      ],
      riskPolicy: document.risk,
      expansionGuidance: document.risk.mustExpand
        ? "Expand before relying on this memory for user intent, numbers, code, or instructions."
        : "Compressed levels are usable for orientation; expand before quoting or executing."
    };
  }

  riskAssessment({ sessionId = DEFAULT_SESSION_ID, uri, text }: any = {}) {
    this.#refreshStoreIfChanged();
    if (text !== undefined) {
      assertBoundedString(text, "text", MAX_TEXT_CHARS);
      const analysis = analyzeRisk(text, { mode: "text", criticalExtracts: extractCriticalExtracts(text) });
      return analysis;
    }

    assertString(uri, "uri");
    const id = normalizeSessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${id}`);
    }
    const parsed = parseShapeLexUri(uri);
    assertUriSession(parsed.sessionId, id, uri);
    if (parsed.kind === "span") {
      const span = session.spans.get(parsed.id);
      if (!span) {
        throw new Error(`Unknown ShapeLex handle: ${uri}`);
      }
      return span.metadata.risk;
    }
    const document = session.documents.get(parsed.id);
    if (!document) {
      throw new Error(`Unknown ShapeLex document: ${uri}`);
    }
    return document.risk;
  }

  listResources({ sessionId }: any = {}) {
    this.#refreshStoreIfChanged();
    const id = sessionId === undefined ? undefined : normalizeSessionId(sessionId);
    const sessions = id ? [this.sessions.get(id)].filter(Boolean) : [...this.sessions.values()];
    const resources = [];

    for (const session of sessions) {
      for (const document of session.documents.values()) {
        resources.push({
          uri: document.uri,
          name: document.label,
          title: `${document.label} (${document.mode})`,
          description: document.levels[0].summary,
          mimeType: "application/json"
        });
        for (const level of ["0", "1", "2", "3", "4"]) {
          resources.push({
            uri: `${document.uri}/level/${level}`,
            name: `${document.label}:level:${level}`,
            title: `ShapeLex level ${level} for ${document.label}`,
            description: levelDescription(level),
            mimeType: "application/json"
          });
        }
      }
    }

    return { resources };
  }

  readResource({ uri }: any) {
    this.#refreshStoreIfChanged();
    assertString(uri, "uri");
    const parsed = parseResourceUri(uri);
    const session = this.sessions.get(parsed.sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${parsed.sessionId}`);
    }
    const document = session.documents.get(parsed.documentId);
    if (!document) {
      throw new Error(`Unknown ShapeLex document: ${uri}`);
    }

    const payload = parsed.level === undefined
      ? document
      : document.levels[String(parsed.level)];

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(sanitizeResourcePayload(payload), null, 2)
        }
      ]
    };
  }

  stats({ sessionId }: any = {}) {
    this.#refreshStoreIfChanged();
    const id = sessionId === undefined ? undefined : normalizeSessionId(sessionId);
    const sessions = id ? [this.sessions.get(id)].filter(Boolean) : [...this.sessions.values()];
    const sessionStats = sessions.map((session) => {
      const fingerprintIndex = this.#fingerprintIndex(session).stats();
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        activeDocuments: session.documents.size,
        activeHandles: session.spans.size,
        approxMemoryBytes: storedSpanBytes(session, this.sourceRecords),
        referencedSourceBytes: referencedSourceBytes(session),
        fingerprintIndex,
        usage: summarizeUsageEvents(session.usageEvents ?? [])
      };
    });

    return {
      sessions: sessionStats,
      activeDocuments: sessionStats.reduce((sum, item) => sum + item.activeDocuments, 0),
      activeHandles: sessionStats.reduce((sum, item) => sum + item.activeHandles, 0),
      approxMemoryBytes: sessionStats.reduce((sum, item) => sum + item.approxMemoryBytes, 0),
      referencedSourceBytes: sessionStats.reduce((sum, item) => sum + item.referencedSourceBytes, 0),
      fingerprintIndex: {
        profile: LEXICAL_PROFILE.id,
        registeredDocuments: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.registeredDocuments, 0),
        warmDocuments: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.warmDocuments, 0),
        coldDocuments: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.coldDocuments, 0),
        estimatedIndexBytes: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.estimatedIndexBytes, 0),
        suppressedHashes: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.suppressedHashes, 0),
        evictions: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.evictions, 0),
        incompleteSearches: sessionStats.reduce((sum, item) => sum + item.fingerprintIndex.incompleteSearches, 0),
        strategy: "lazy-memory-only"
      },
      tokenAccounting: {
        estimator: TOKEN_ESTIMATOR_ID,
        exact: false,
        note: "Counts are deterministic estimates, not provider-billed tokens. Record provider-reported usage separately when available.",
        usage: summarizeUsageEvents(sessions.flatMap((session) => session.usageEvents ?? []))
      },
      persistence: {
        enabled: this.persistent,
        storePath: this.storePath ? path.basename(this.storePath) : undefined,
        maxStoreBytes: this.maxStoreBytes,
        strategy: this.persistent ? "single-json-file" : "memory-only",
        format: this.persistent ? "transactional-json-v2" : "memory-only",
        gitignoreProtection: this.gitignoreProtection
      }
    };
  }

  memoryOverview({ sessionId }: any = {}) {
    this.#refreshStoreIfChanged();
    const id = sessionId === undefined ? DEFAULT_SESSION_ID : normalizeSessionId(sessionId);
    const sessions = [...this.sessions.values()]
      .sort((a, b) => Date.parse(b.lastAccessedAt) - Date.parse(a.lastAccessedAt));
    const current = this.sessions.get(id);
    const sessionSummaries = sessions.map((session) => {
      const fingerprintIndex = this.#fingerprintIndex(session).stats();
      return {
        sessionId: session.id,
        isCurrent: session.id === id,
        lastUsed: session.lastAccessedAt,
        documents: session.documents.size,
        handles: session.spans.size,
        approxMemoryBytes: storedSpanBytes(session, this.sourceRecords),
        referencedSourceBytes: referencedSourceBytes(session),
        fingerprintIndex,
        labels: [...session.documents.values()].map((document) => document.label).slice(0, 6)
      };
    });

    const suggestions = [];
    if (!current) {
      suggestions.push(`No memory exists yet for session "${id}". If this is a new project, start by compressing long context with this sessionId.`);
    }
    if (sessionSummaries.length > 1) {
      suggestions.push("Use a different sessionId for each project or task so old memory does not mix with new work.");
    }
    const staleSessions = sessions.filter((session) => daysSince(session.lastAccessedAt) >= 14);
    if (staleSessions.length > 0) {
      suggestions.push(`You have ${staleSessions.length} session(s) not used in 14+ days. Run shapelex_prune with {"olderThanDays":14,"dryRun":true} before deleting.`);
    }
    if (sessionSummaries.length > 10) {
      suggestions.push("You have more than 10 sessions. Consider shapelex_prune with dryRun=true and maxSessions set to the number of active projects you care about.");
    }
    if (suggestions.length === 0) {
      suggestions.push("Memory looks tidy. Keep using one clear sessionId per project.");
    }

    return {
      currentSessionId: id,
      plainEnglish: current
        ? `You are using ShapeLex memory session "${id}". It has ${current.documents.size} document(s) and ${current.spans.size} expandable handle(s).`
        : `You are using session name "${id}", but it does not have stored memory yet.`,
      sessions: sessionSummaries,
      fingerprintIndex: {
        profile: LEXICAL_PROFILE.id,
        warmDocuments: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.warmDocuments, 0),
        coldDocuments: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.coldDocuments, 0),
        estimatedIndexBytes: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.estimatedIndexBytes, 0),
        suppressedHashes: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.suppressedHashes, 0),
        evictions: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.evictions, 0),
        incompleteSearches: sessionSummaries.reduce((sum, item) => sum + item.fingerprintIndex.incompleteSearches, 0),
        strategy: "lazy-memory-only"
      },
      tokenAccounting: {
        estimator: TOKEN_ESTIMATOR_ID,
        exact: false,
        currentSession: summarizeUsageEvents(current?.usageEvents ?? [])
      },
      suggestions,
      cleanupExamples: {
        previewOldSessions: { olderThanDays: 14, dryRun: true },
        removeOldSessions: { olderThanDays: 14 },
        keepNewestTen: { maxSessions: 10, dryRun: true }
      }
    };
  }

  clear(input: any = {}) {
    return this.#retryStoreMutation(() => this.#clear(input));
  }

  #clear({ sessionId }: any = {}) {
    this.#refreshStoreIfChanged();
    const previousSessions = new Map(this.sessions);
    const previousIndexes = new Map(this.fingerprintIndexes);
    const previousSources = new Map(this.sourceRecords);
    if (sessionId !== undefined) {
      const id = normalizeSessionId(sessionId);
      this.sessions.delete(id);
      this.fingerprintIndexes.delete(id);
    } else {
      this.sessions.clear();
      this.fingerprintIndexes.clear();
    }

    this.#dropUnusedSourceRecords();
    try {
      this.#saveStore();
    } catch (error) {
      if (!(error instanceof StoreRevisionConflictError)) {
        this.sessions = previousSessions;
        this.fingerprintIndexes = previousIndexes;
        this.sourceRecords = previousSources;
      }
      throw error;
    }
    return { cleared: true };
  }

  prune(input: any = {}) {
    return this.#retryStoreMutation(() => this.#prune(input));
  }

  #prune({ olderThanDays, maxSessions, dryRun = false }: any = {}) {
    this.#refreshStoreIfChanged();
    const cutoff = olderThanDays === undefined
      ? undefined
      : Date.now() - normalizeNonNegativeNumber(olderThanDays, "olderThanDays") * 24 * 60 * 60 * 1000;
    const keepSessions = maxSessions === undefined
      ? undefined
      : normalizeLimit(maxSessions);

    const ordered = [...this.sessions.values()]
      .sort((a, b) => Date.parse(a.lastAccessedAt) - Date.parse(b.lastAccessedAt));
    const toRemove = new Set<string>();

    if (cutoff !== undefined) {
      for (const session of ordered) {
        if (Date.parse(session.lastAccessedAt) < cutoff) {
          toRemove.add(session.id);
        }
      }
    }

    if (keepSessions !== undefined) {
      const survivors = ordered.filter((session) => !toRemove.has(session.id));
      const overflow = Math.max(0, survivors.length - keepSessions);
      for (const session of survivors.slice(0, overflow)) {
        toRemove.add(session.id);
      }
    }

    const removedSessions = [...toRemove].sort();
    const before = this.stats();

    if (!dryRun) {
      const previousSessions = new Map(this.sessions);
      const previousIndexes = new Map(this.fingerprintIndexes);
      const previousSources = new Map(this.sourceRecords);
      for (const sessionId of removedSessions) {
        this.sessions.delete(sessionId);
        this.fingerprintIndexes.delete(sessionId);
      }
      this.#dropUnusedSourceRecords();
      try {
        this.#saveStore();
      } catch (error) {
        if (!(error instanceof StoreRevisionConflictError)) {
          this.sessions = previousSessions;
          this.fingerprintIndexes = previousIndexes;
          this.sourceRecords = previousSources;
        }
        throw error;
      }
    }

    const after = dryRun ? before : this.stats();
    return {
      dryRun: Boolean(dryRun),
      removedSessions,
      removedCount: removedSessions.length,
      before: {
        activeDocuments: before.activeDocuments,
        activeHandles: before.activeHandles,
        approxMemoryBytes: before.approxMemoryBytes
      },
      after: {
        activeDocuments: after.activeDocuments,
        activeHandles: after.activeHandles,
        approxMemoryBytes: after.approxMemoryBytes
      }
    };
  }

  flush() {
    return this.#retryStoreMutation(() => {
      this.#refreshStoreIfChanged();
      this.#saveStore();
      return {
        persisted: this.persistent,
        storePath: this.storePath
      };
    });
  }

  #retryStoreMutation<T>(operation: () => T): T {
    const startedAt = Date.now();
    let attempt = 0;
    while (true) {
      try {
        return operation();
      } catch (error) {
        if (!(error instanceof StoreRevisionConflictError) || Date.now() - startedAt >= 2_000) {
          if (error instanceof StoreRevisionConflictError) {
            throw new StoreBusyError(this.storePath);
          }
          throw error;
        }
        attempt += 1;
        sleepForStoreRetry(1 + ((process.pid * 17 + attempt * 13) % 17));
      }
    }
  }

  #session(sessionId) {
    const id = normalizeSessionId(sessionId);
    let session = this.sessions.get(id);

    if (!session) {
      const now = new Date().toISOString();
      session = {
        id,
        createdAt: now,
        lastAccessedAt: now,
        nextSpan: 1,
        nextDocument: 1,
        documents: new Map(),
        spans: new Map(),
        spanToDocument: new Map(),
        usageEvents: []
      };
      this.sessions.set(id, session);
    }

    session.lastAccessedAt = new Date().toISOString();
    return session;
  }

  #createDocument(session: any, { text, label, mode, messages }: any) {
    const documentId = `doc_${session.nextDocument++}`;
    const document: any = {
      id: documentId,
      uri: `sx://${session.id}/doc/${documentId}`,
      label,
      mode,
      text,
      checksum: sourceHash(text),
      createdAt: new Date().toISOString(),
      handles: [],
      messages
    };

    const sourceSpans = mode === "conversation" && Array.isArray(messages)
      ? spansFromMessages(messages)
      : splitIntoSpans(text).map((span, index) => ({ ...span, index }));

    for (const sourceSpan of sourceSpans) {
      const metadata = this.#storeSpan(session, document, {
        text: sourceSpan.text,
        label,
        role: sourceSpan.role ?? mode,
        index: sourceSpan.index,
        mode
      });
      document.handles.push(metadata);
    }

    const anchors = unique(document.handles.flatMap((handle) => handle.anchors)).slice(0, MAX_ANCHORS);
    const protectedTerms = unique(document.handles.flatMap((handle) => handle.protectedTerms));
    const criticalExtracts = extractCriticalExtracts(text);
    const code = mode === "code" ? analyzeCode(text, document) : undefined;
    const conversation = mode === "conversation" ? analyzeConversation(messages ?? text, document) : undefined;
    const risk = analyzeRisk(text, { mode, criticalExtracts, code, conversation, protectedTerms });

    document.risk = risk;
    document.confidence = confidenceFromRisk(risk);
    document.code = code;
    document.conversation = conversation;
    document.levels = buildLevels(document, { anchors, protectedTerms, criticalExtracts, code, conversation });

    session.documents.set(document.id, document);
    return document;
  }

  #recordCompressionUsage(session: any, result: any, rawText: string, kind: string) {
    const event = {
      timestamp: new Date().toISOString(),
      operation: kind === "conversation" ? "compress_messages" : "compress_text",
      estimator: TOKEN_ESTIMATOR_ID,
      exact: false,
      rawCharacters: String(rawText ?? "").length,
      compressedCharacters: String(result.compressedText ?? "").length,
      rawTokens: result.rawTokenEstimate,
      compressedTokens: result.compressedTokenEstimate,
      tokenDelta: Math.max(0, result.rawTokenEstimate - result.compressedTokenEstimate),
      savingsRatio: result.savingsRatio,
      compressionSkipped: Boolean(result.compressionSkipped)
    };
    session.usageEvents = [...(session.usageEvents ?? []), event].slice(-MAX_USAGE_EVENTS_PER_SESSION);
  }

  #convertDocumentToFileBacked(session: any, document: any, fileSource: any) {
    const sourceText = document.text;
    const sourceRecord = sourceRecordFromMaterial({
      bytes: Buffer.from(sourceText, "utf8"),
      origin: {
        kind: "file",
        sessionId: session.id,
        documentId: document.id,
        relativePath: fileSource.relativePath
      }
    });
    this.#mergeSourceRecord(sourceRecord);
    let searchOffset = 0;
    let searchByteOffset = 0;

    for (const handle of document.handles) {
      const span = session.spans.get(handle.spanId);
      if (!span || typeof span.text !== "string") {
        throw new Error(`ShapeLex could not create a file-backed source for ${handle.uri}`);
      }
      let matchedText = span.text;
      let startChar = sourceText.indexOf(matchedText, searchOffset);
      if (startChar < 0 && matchedText.includes("\n")) {
        const crlfText = matchedText.replace(/\n/g, "\r\n");
        const crlfStart = sourceText.indexOf(crlfText, searchOffset);
        if (crlfStart >= 0) {
          matchedText = crlfText;
          startChar = crlfStart;
        }
      }
      if (startChar < 0) {
        throw new Error(`ShapeLex could not locate span content in ${fileSource.relativePath}`);
      }
      const endChar = startChar + matchedText.length;
      const startByte = searchByteOffset + Buffer.byteLength(sourceText.slice(searchOffset, startChar), "utf8");
      const endByte = startByte + Buffer.byteLength(matchedText, "utf8");
      const spanChecksum = sourceHash(matchedText);
      handle.checksum = spanChecksum;
      handle.charLength = matchedText.length;
      handle.tokenEstimate = estimateTokens(matchedText);
      span.source = {
        kind: "file",
        relativePath: fileSource.relativePath,
        startByte,
        endByte,
        checksum: spanChecksum,
        documentChecksum: document.checksum
      };
      delete span.metadata.shapes;
      delete span.metadata.fingerprints;
      delete span.text;
      searchOffset = endChar;
      searchByteOffset = endByte;
    }

    document.source = {
      kind: "file",
      sourceId: sourceRecord.sourceId,
      relativePath: fileSource.relativePath,
      encoding: "utf8",
      byteLength: fileSource.byteLength,
      checksum: document.checksum
    };
    delete document.text;
  }

  #convertDocumentToTextBacked(session: any, document: any) {
    if (typeof document.text !== "string") {
      return;
    }
    const sourceText = document.text;
    const sourceRecord = sourceRecordFromMaterial({
      bytes: Buffer.from(sourceText, "utf8"),
      origin: {
        kind: "text",
        sessionId: session.id,
        documentId: document.id
      },
      legacyChecksum: typeof document.checksum === "string" && document.checksum.length < 64
        ? document.checksum
        : undefined
    });
    this.#mergeSourceRecord(sourceRecord);
    let searchOffset = 0;
    let searchByteOffset = 0;

    for (const handle of document.handles) {
      const span = session.spans.get(handle.spanId);
      if (!span || typeof span.text !== "string") {
        throw new Error(`ShapeLex could not create an exact text source for ${handle.uri}`);
      }
      let matchedText = span.text;
      let startChar = sourceText.indexOf(matchedText, searchOffset);
      if (startChar < 0 && matchedText.includes("\n")) {
        const crlfText = matchedText.replace(/\n/g, "\r\n");
        const crlfStart = sourceText.indexOf(crlfText, searchOffset);
        if (crlfStart >= 0) {
          matchedText = crlfText;
          startChar = crlfStart;
        }
      }
      if (startChar < 0) {
        throw new Error(`ShapeLex could not locate exact text for ${handle.uri}`);
      }
      const endChar = startChar + matchedText.length;
      const startByte = searchByteOffset + Buffer.byteLength(sourceText.slice(searchOffset, startChar), "utf8");
      const endByte = startByte + Buffer.byteLength(matchedText, "utf8");
      const spanChecksum = sourceHash(matchedText);
      handle.checksum = spanChecksum;
      handle.charLength = matchedText.length;
      handle.tokenEstimate = estimateTokens(matchedText);
      span.metadata.checksum = spanChecksum;
      span.metadata.charLength = matchedText.length;
      span.metadata.tokenEstimate = estimateTokens(matchedText);
      span.source = {
        kind: "text",
        sourceId: sourceRecord.sourceId,
        startByte,
        endByte,
        checksum: spanChecksum,
        documentChecksum: sourceRecord.sha256
      };
      delete span.metadata.shapes;
      delete span.metadata.fingerprints;
      delete span.text;
      searchOffset = endChar;
      searchByteOffset = endByte;
    }

    document.checksum = sourceRecord.sha256;
    document.source = {
      kind: "text",
      sourceId: sourceRecord.sourceId,
      encoding: "utf8",
      byteLength: sourceRecord.byteLength,
      checksum: sourceRecord.sha256
    };
    delete document.text;
  }

  #mergeSourceRecord(candidate: StoreSourceRecord) {
    const existing = this.sourceRecords.get(candidate.sourceId);
    if (!existing) {
      this.sourceRecords.set(candidate.sourceId, candidate);
      return;
    }
    if (
      existing.sha256 !== candidate.sha256
      || existing.byteLength !== candidate.byteLength
      || (existing.text !== undefined && candidate.text !== undefined && existing.text !== candidate.text)
    ) {
      throw new Error("ShapeLex detected a source digest collision");
    }
    existing.text ??= candidate.text;
    for (const origin of candidate.origins) {
      if (!existing.origins.some((item) => JSON.stringify(item) === JSON.stringify(origin))) {
        existing.origins.push(origin);
      }
    }
    existing.legacyChecksums = [...new Set([
      ...existing.legacyChecksums,
      ...candidate.legacyChecksums
    ])];
  }

  #adoptStoredSource(session: any, document: any) {
    const currentSourceId = document.source?.sourceId;
    const sourceRecord = (
      typeof currentSourceId === "string"
        ? this.sourceRecords.get(currentSourceId)
        : undefined
    ) ?? [...this.sourceRecords.values()].find((record) => record.origins.some((origin) => (
      origin.sessionId === session.id && origin.documentId === document.id
    )));

    if (typeof document.text === "string") {
      this.#convertDocumentToTextBacked(session, document);
      return;
    }
    if (!sourceRecord) {
      return;
    }
    document.source ??= {};
    document.source.sourceId = sourceRecord.sourceId;
    document.source.checksum = sourceRecord.sha256;
    document.checksum = sourceRecord.sha256;
    for (const span of session.spans.values()) {
      if (span.metadata?.documentId !== document.id || !span.source) {
        continue;
      }
      span.source.sourceId ??= sourceRecord.sourceId;
      span.source.documentChecksum = sourceRecord.sha256;
    }
  }

  #resolveWorkspaceFile(sourcePath: string) {
    const candidate = path.isAbsolute(sourcePath)
      ? path.resolve(sourcePath)
      : path.resolve(this.workspaceRootReal, sourcePath);
    if (!fs.existsSync(candidate)) {
      throw new Error(`ShapeLex source file does not exist: ${sourcePath}`);
    }
    const absolutePath = fs.realpathSync(candidate);
    const relativePath = path.relative(this.workspaceRootReal, absolutePath);
    if (!relativePath) {
      throw new Error("ShapeLex sourcePath must identify a file inside the workspace");
    }
    if (path.isAbsolute(relativePath) || relativePath.startsWith(`..${path.sep}`) || relativePath === "..") {
      throw new Error("ShapeLex sourcePath must stay inside the configured workspace root");
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`ShapeLex sourcePath is not a file: ${sourcePath}`);
    }
    return {
      absolutePath,
      relativePath: relativePath.split(path.sep).join("/"),
      byteLength: stat.size
    };
  }

  #readFileDocument(source: any, handle: string) {
    let fileBuffer: Buffer;
    try {
      const resolved = this.#resolveWorkspaceFile(source.relativePath);
      fileBuffer = fs.readFileSync(resolved.absolutePath);
    } catch (error) {
      throw staleSourceError(`ShapeLex source file is unavailable: ${handle}`, error);
    }
    const text = fileBuffer.toString(source.encoding ?? "utf8");
    if (!checksumMatches(text, source.checksum)) {
      throw staleSourceError(`ShapeLex source file changed after registration: ${handle}`);
    }
    return text;
  }

  #readFileSpan(source: any, handle: string) {
    let fileBuffer: Buffer;
    try {
      const resolved = this.#resolveWorkspaceFile(source.relativePath);
      fileBuffer = fs.readFileSync(resolved.absolutePath);
    } catch (error) {
      throw staleSourceError(`ShapeLex source file is unavailable: ${handle}`, error);
    }
    const documentText = fileBuffer.toString("utf8");
    if (!checksumMatches(documentText, source.documentChecksum)) {
      throw staleSourceError(`ShapeLex source file changed after registration: ${handle}`);
    }
    const text = fileBuffer.subarray(source.startByte, source.endByte).toString("utf8");
    if (!checksumMatches(text, source.checksum)) {
      throw staleSourceError(`ShapeLex file-backed span checksum mismatch: ${handle}`);
    }
    return text;
  }

  #readTextDocument(source: any, handle: string) {
    const record = this.sourceRecords.get(source.sourceId);
    if (!record || typeof record.text !== "string") {
      throw new Error(`ShapeLex exact text source is unavailable: ${handle}`);
    }
    if (!checksumMatches(record.text, source.checksum ?? record.sha256)) {
      throw new Error(`ShapeLex text source checksum mismatch: ${handle}`);
    }
    return record.text;
  }

  #readTextSpan(source: any, handle: string) {
    const documentText = this.#readTextDocument({
      sourceId: source.sourceId,
      checksum: source.documentChecksum
    }, handle);
    const bytes = Buffer.from(documentText, "utf8");
    const text = bytes.subarray(source.startByte, source.endByte).toString("utf8");
    if (!checksumMatches(text, source.checksum)) {
      throw new Error(`ShapeLex text-backed span checksum mismatch: ${handle}`);
    }
    return text;
  }

  #fingerprintIndex(session: any) {
    let index = this.fingerprintIndexes.get(session.id);
    if (!index) {
      index = new LazyFingerprintIndex();
      this.fingerprintIndexes.set(session.id, index);
      for (const document of session.documents.values()) {
        this.#registerDocumentFingerprints(session, document, index);
      }
    }
    return index;
  }

  #registerDocumentFingerprints(
    _session: any,
    document: any,
    index = this.#fingerprintIndex(_session)
  ) {
    index.registerDocument({
      id: `doc:${document.id}`,
      textProvider: () => this.#documentTextForFingerprint(document),
      versionProvider: () => this.#sourceVersion(document.source, document.checksum)
    });
  }

  #materializeFingerprintWindow(
    session: any,
    target: any,
    window: FingerprintMatchWindow,
    queryText: string
  ): { target: any; created: boolean } | undefined {
    const targetBase = Number(target.span?.source?.startByte ?? 0);
    const targetText = target.span
      ? this.#spanTextForFingerprint(target.span, target.uri)
      : this.#documentTextForFingerprint(target.document);
    const targetBytes = Buffer.from(targetText, "utf8");
    if (
      !Number.isSafeInteger(window.rawByteStart)
      || !Number.isSafeInteger(window.rawByteEnd)
      || window.rawByteStart < 0
      || window.rawByteEnd <= window.rawByteStart
      || window.rawByteEnd > targetBytes.length
    ) {
      return undefined;
    }
    const startByte = targetBase + window.rawByteStart;
    const endByte = targetBase + window.rawByteEnd;
    const documentText = this.#documentTextForFingerprint(target.document);
    const documentBytes = Buffer.from(documentText, "utf8");
    const queryBytes = Buffer.from(queryText, "utf8");
    const exactBytes = documentBytes.subarray(startByte, endByte);
    if (
      !exactBytes.equals(queryBytes)
      || sourceHash(exactBytes.toString("utf8")) !== sourceHash(queryText)
    ) {
      return undefined;
    }

    for (const handle of target.document.handles ?? []) {
      const span = session.spans.get(handle.spanId);
      if (
        span?.source?.startByte === startByte
        && span?.source?.endByte === endByte
        && checksumMatches(queryText, span.source.checksum)
      ) {
        return {
          target: resolveFingerprintTarget(session, `span:${handle.spanId}`),
          created: false
        };
      }
    }

    const metadata = this.#storeSpan(session, target.document, {
      text: queryText,
      label: `${target.document.label} exact fingerprint match`,
      role: target.document.mode,
      index: target.document.handles.length,
      mode: target.document.mode
    });
    const span = session.spans.get(metadata.spanId);
    if (!span) {
      return undefined;
    }
    if (target.document.source?.kind === "file") {
      span.source = {
        kind: "file",
        relativePath: target.document.source.relativePath,
        startByte,
        endByte,
        checksum: metadata.checksum,
        documentChecksum: target.document.checksum
      };
    } else if (target.document.source?.kind === "text") {
      span.source = {
        kind: "text",
        sourceId: target.document.source.sourceId,
        startByte,
        endByte,
        checksum: metadata.checksum,
        documentChecksum: target.document.checksum
      };
    }
    if (span.source) {
      delete span.text;
    }
    delete span.metadata.shapes;
    delete span.metadata.fingerprints;
    const publicMetadata = publicHandleMetadata(metadata);
    target.document.handles.push(publicMetadata);
    target.document.levels["4"].handles.push({
      uri: publicMetadata.uri,
      label: publicMetadata.label,
      role: publicMetadata.role,
      index: publicMetadata.index,
      tokenEstimate: publicMetadata.tokenEstimate,
      risk: publicMetadata.risk
    });
    return {
      target: resolveFingerprintTarget(session, `span:${metadata.spanId}`),
      created: true
    };
  }

  #documentTextForFingerprint(document: any) {
    if (document.source?.kind === "file") {
      return this.#readFileDocument(document.source, document.uri);
    }
    if (document.source?.kind === "text") {
      return this.#readTextDocument(document.source, document.uri);
    }
    return String(document.text ?? "");
  }

  #spanTextForFingerprint(span: any, handle: string) {
    if (span.source?.kind === "file") {
      return this.#readFileSpan(span.source, handle);
    }
    if (span.source?.kind === "text") {
      return this.#readTextSpan(span.source, handle);
    }
    return String(span.text ?? "");
  }

  #sourceVersion(source: any, checksum: unknown) {
    if (source?.kind !== "file") {
      return String(source?.checksum ?? checksum ?? "");
    }
    try {
      const resolved = this.#resolveWorkspaceFile(source.relativePath);
      const stat = fs.statSync(resolved.absolutePath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return "missing";
    }
  }

  #storeSpan(session, document, span) {
    const spanId = `span_${session.nextSpan++}`;
    const analysis = analyzeSpan(span.text);
    const uri = `sx://${session.id}/span/${spanId}`;
    const risk = analyzeRisk(span.text, {
      mode: span.mode,
      criticalExtracts: extractCriticalExtracts(span.text),
      protectedTerms: analysis.protectedTerms
    });
    const metadata = {
      spanId,
      documentId: document.id,
      uri,
      label: span.label,
      role: span.role,
      index: span.index,
      mode: span.mode,
      charLength: span.text.length,
      checksum: sourceHash(span.text),
      tokenEstimate: estimateTokens(span.text),
      anchors: analysis.anchors,
      protectedTerms: analysis.protectedTerms,
      shapes: analysis.shapes,
      fingerprints: analysis.fingerprints,
      risk
    };

    session.spans.set(spanId, {
      text: span.text,
      metadata
    });
    session.spanToDocument.set(spanId, document.id);

    return metadata;
  }

  #resolveLegacyFileSource(relativePath: string, document: unknown): Uint8Array | undefined {
    try {
      const resolved = this.#resolveWorkspaceFile(relativePath);
      if (resolved.byteLength > MAX_TEXT_BYTES) {
        return undefined;
      }
      const bytes = fs.readFileSync(resolved.absolutePath);
      const text = bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(bytes)) {
        return undefined;
      }
      const legacyChecksum = isPlainObject(document) && typeof document.checksum === "string"
        ? document.checksum
        : undefined;
      return legacyChecksum && checksumMatches(text, legacyChecksum) ? bytes : undefined;
    } catch {
      return undefined;
    }
  }

  #loadStore() {
    if (!this.storeCoordinator) {
      return;
    }
    const snapshot = this.storeCoordinator.snapshot({ refresh: false });
    this.#hydrateSessions(snapshot.sessions, snapshot.sources);
  }

  #hydrateSessions(storedSessions: any[], storedSources: StoreSourceRecord[] = []) {
    this.sessions.clear();
    this.fingerprintIndexes.clear();
    this.sourceRecords = new Map(storedSources.map((source) => [source.sourceId, source]));
    for (const item of storedSessions) {
      const id = normalizeSessionId(item.id);
      const session = {
        id,
        createdAt: item.createdAt,
        lastAccessedAt: item.lastAccessedAt,
        nextSpan: item.nextSpan,
        nextDocument: item.nextDocument,
        documents: new Map(),
        spans: new Map(),
        spanToDocument: new Map(),
        usageEvents: Array.isArray(item.usageEvents) ? item.usageEvents.slice(-MAX_USAGE_EVENTS_PER_SESSION) : []
      };

      for (const document of item.documents ?? []) {
        session.documents.set(document.id, document);
      }
      for (const span of item.spans ?? []) {
        hydrateStoredSpan(session, span, session.documents.get(span.metadata?.documentId));
        session.spans.set(span.metadata.spanId, span);
        session.spanToDocument.set(span.metadata.spanId, span.metadata.documentId);
      }
      for (const document of session.documents.values()) {
        hydrateStoredDocument(session, document);
        this.#adoptStoredSource(session, document);
      }
      this.sessions.set(session.id, session);
      this.#fingerprintIndex(session);
    }
  }

  #refreshStoreIfChanged() {
    if (!this.storeCoordinator || !this.storeCoordinator.refreshIfChanged()) {
      return false;
    }
    const snapshot = this.storeCoordinator.snapshot({ refresh: false });
    this.#hydrateSessions(snapshot.sessions, snapshot.sources);
    return true;
  }

  #saveStore() {
    if (!this.storeCoordinator) {
      return;
    }
    const sessions = [...this.sessions.values()].map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        nextSpan: session.nextSpan,
        nextDocument: session.nextDocument,
        documents: [...session.documents.values()].map(serializeDocumentForStore),
        spans: [...session.spans.values()].map(serializeSpanForStore),
        usageEvents: session.usageEvents ?? []
      }));
    const sources = this.#sourceRecordsForSessions(sessions);
    try {
      this.storeCoordinator.transact((draft) => {
        draft.sessions = sessions;
        draft.sources = sources;
        draft.index = { strategy: "lazy-memory-only", state: "cold" };
      });
    } catch (error) {
      if (error instanceof StoreRevisionConflictError) {
        this.storeCoordinator.refreshIfChanged();
        const snapshot = this.storeCoordinator.snapshot({ refresh: false });
        this.#hydrateSessions(snapshot.sessions, snapshot.sources);
      }
      throw error;
    }
  }

  #sourceRecordsForSessions(sessions: readonly any[]) {
    const originsBySource = new Map<string, StoreSourceRecord["origins"]>();
    for (const session of sessions) {
      for (const document of session.documents ?? []) {
        const sourceId = document.source?.sourceId;
        if (typeof sourceId !== "string") {
          continue;
        }
        const origins = originsBySource.get(sourceId) ?? [];
        const origin = document.source?.kind === "file"
          ? {
              kind: "file" as const,
              sessionId: String(session.id),
              documentId: String(document.id),
              relativePath: String(document.source.relativePath)
            }
          : {
              kind: "text" as const,
              sessionId: String(session.id),
              documentId: String(document.id)
            };
        origins.push(origin);
        originsBySource.set(sourceId, origins);
      }
    }

    return [...originsBySource.entries()].map(([sourceId, origins]) => {
      const source = this.sourceRecords.get(sourceId);
      if (!source) {
        throw new Error(`ShapeLex source record is unavailable: ${sourceId}`);
      }
      return {
        ...source,
        origins
      };
    }).sort((left, right) => left.sha256.localeCompare(right.sha256));
  }

  #dropUnusedSourceRecords() {
    const used = new Set<string>();
    for (const session of this.sessions.values()) {
      for (const document of session.documents.values()) {
        if (typeof document.source?.sourceId === "string") {
          used.add(document.source.sourceId);
        }
      }
    }
    for (const sourceId of this.sourceRecords.keys()) {
      if (!used.has(sourceId)) {
        this.sourceRecords.delete(sourceId);
      }
    }
  }
}

export function charShape(word, k = 3) {
  const original = String(word ?? "");
  const normalized = normalizeText(original).toLowerCase();
  const chars = [...normalized];
  const letters = chars.filter((char) => /[a-z]/.test(char));
  const length = chars.length;
  const prefix = chars.slice(0, k).join("");
  const suffix = chars.slice(Math.max(0, chars.length - k)).join("");
  const mask = runLengthEncode([...original].map(charClass).join(""));
  const vc = runLengthEncode(chars.map(vowelConsonantClass).join(""));
  const histogram = {};

  for (const letter of letters) {
    histogram[letter] = Number(((histogram[letter] ?? 0) + 1 / Math.max(1, letters.length)).toFixed(3));
  }

  return {
    length,
    prefix,
    suffix,
    mask,
    vc,
    histogram
  };
}

export function fingerprintTokens(tokens, { fanout = 2, bits = 16 } = {}) {
  const anchors = selectAnchors(tokens);
  const fingerprints = [];

  for (const anchor of anchors) {
    for (let offset = 1; offset <= fanout; offset += 1) {
      const target = tokens[anchor.index + offset];
      if (!target) {
        continue;
      }

      const anchorShape = localSignature(anchor.token);
      const targetShape = localSignature(target);
      fingerprints.push(shortHash(`${anchorShape}|${targetShape}|${offset}`, bits));
    }
  }

  return fingerprints;
}

export function estimateTokens(text) {
  const input = String(text ?? "").trim();
  if (!input) {
    return 0;
  }

  const wordPieces = input.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? [];
  const charEstimate = Math.ceil(input.length / 4);
  return Math.max(1, Math.ceil((wordPieces.length + charEstimate) / 2));
}

export function analyzeSpan(text) {
  const tokens = tokenize(text);
  const anchors = selectAnchors(tokens).map((item) => item.token).slice(0, MAX_ANCHORS);
  const protectedTerms = tokens.filter((token) => isProtectedToken(token)).slice(0, MAX_ANCHORS);
  const shapeTokens = anchors.length > 0 ? anchors : tokens.slice(0, 5);
  const shapes = shapeTokens.map((token) => {
    const shape = charShape(token);
    return `${shape.prefix}...${shape.suffix}:${shape.length}:${shape.vc}`;
  });
  const fingerprints = fingerprintTokens(tokens).slice(0, MAX_ANCHORS);

  return {
    anchors,
    protectedTerms: unique(protectedTerms),
    shapes,
    fingerprints
  };
}

function buildLevels(document: any, { anchors, protectedTerms, criticalExtracts, code, conversation }: any): any {
  const semanticMap = [];
  semanticMap.push({ kind: "document", label: document.label, mode: document.mode, handle: document.uri });
  if (protectedTerms.length > 0) {
    semanticMap.push({ kind: "protected_terms", items: protectedTerms.slice(0, 16) });
  }
  if (code) {
    semanticMap.push({ kind: "code", ...code.summary });
  }
  if (conversation) {
    semanticMap.push({ kind: "conversation", ...conversation.summary });
  }

  return {
    "0": {
      summary: summarizeDocument(document, { anchors, code, conversation }),
      confidence: document.confidence
    },
    "1": {
      map: semanticMap,
      code,
      conversation
    },
    "2": {
      anchors,
      protectedTerms
    },
    "3": {
      criticalExtracts
    },
    "4": {
      handles: document.handles.map((handle) => ({
        uri: handle.uri,
        label: handle.label,
        role: handle.role,
        index: handle.index,
        tokenEstimate: handle.tokenEstimate,
        risk: handle.risk
      })),
      documentHandle: document.uri
    }
  };
}

function summarizeDocument(document: any, { anchors, code, conversation }: any) {
  if (document.mode === "code" && code) {
    return `${document.label}: code memory with ${code.imports.length} imports, ${code.symbols.length} symbols, ${code.errors.length} errors, and ${document.handles.length} expandable spans.`;
  }
  if (document.mode === "conversation" && conversation) {
    return `${document.label}: conversation memory with ${conversation.decisions.length} decisions, ${conversation.constraints.length} constraints, ${conversation.todos.length} todos, and ${conversation.negations.length} negations.`;
  }
  const topic = anchors.length > 0 ? anchors.slice(0, 5).join(", ") : "general text";
  return `${document.label}: compressed ${document.mode} memory about ${topic}, with ${document.handles.length} expandable spans.`;
}

function renderNavigableDocument(document: any) {
  return withInstruction([
    `${document.uri} ${document.mode} risk=${document.risk.level} expand=${document.risk.shouldExpand}`,
    `L0 ${document.levels[0].summary}`,
    `L2 ${document.levels[2].anchors.slice(0, 8).join(",") || "none"}`,
    `L3 critical=${document.levels[3].criticalExtracts.length}`,
    `L4 ${document.levels[4].handles.map((item) => item.uri).join(",")}`
  ].join("\n\n"));
}

function renderLevelSummary(document: any) {
  return `ShapeLex document ${document.uri}\nLevel 0: ${document.levels[0].summary}\nRisk: ${document.risk.level} (${document.risk.score}) mustExpand=${document.risk.mustExpand}`;
}

function compactDocumentContext(document: any, { query, detail }: any) {
  const queryTokens = tokenize(query).map((token) => token.toLowerCase());
  const criticalExtracts = document.levels[3].criticalExtracts.slice(0, detail === "brief" ? 6 : 12);
  const symbols = (document.code?.symbols ?? [])
    .filter((symbol) => queryTokens.some((token) => symbol.name.toLowerCase().includes(token)))
    .slice(0, 8);
  const references = (document.code?.references ?? [])
    .filter((reference) => queryTokens.some((token) => reference.name.toLowerCase().includes(token)))
    .slice(0, 8);

  return {
    uri: document.uri,
    label: document.label,
    mode: document.mode,
    summary: document.levels[0].summary,
    anchors: document.levels[2].anchors.slice(0, detail === "brief" ? 8 : 14),
    protectedTerms: document.levels[2].protectedTerms.slice(0, 12),
    criticalExtracts,
    symbols,
    references,
    handles: document.levels[4].handles.slice(0, detail === "brief" ? 3 : 8),
    risk: document.risk
  };
}

function renderContextText({ sessionId, query, documents, detail }: any) {
  const lines = [
    `ShapeLex compact context session=${sessionId} detail=${detail}`,
    `Query: ${query}`
  ];

  if (documents.length === 0) {
    lines.push("No matching memory found. Ask the user for context or compress relevant material into this session.");
    return lines.join("\n");
  }

  documents.forEach((document, index) => {
    lines.push("");
    lines.push(`#${index + 1} ${document.label} ${document.uri} mode=${document.mode} risk=${document.risk.level}`);
    lines.push(`Summary: ${document.summary}`);
    lines.push(`Anchors: ${document.anchors.join(", ") || "none"}`);
    if (document.protectedTerms.length > 0) {
      lines.push(`Protected terms: ${document.protectedTerms.join(", ")}`);
    }
    if (document.symbols.length > 0) {
      lines.push(`Code symbols: ${document.symbols.map((symbol) => symbol.signature).join(" | ")}`);
    }
    if (document.references.length > 0) {
      lines.push(`References: ${document.references.map((reference) => `${reference.name}@${reference.line}`).join(", ")}`);
    }
    if (document.criticalExtracts.length > 0) {
      lines.push("Critical extracts:");
      for (const extract of document.criticalExtracts) {
        lines.push(`- ${extract.text}`);
      }
    }
    lines.push(`Expand if exactness matters: ${document.handles.map((handle) => handle.uri).join(", ") || document.uri}`);
  });

  return lines.join("\n");
}

function resultPayload(sessionId: any, compressedText: any, handles: any, rawText: any): any {
  const rawTokenEstimate = estimateTokens(rawText);
  const compressedTokenEstimate = estimateTokens(compressedText);

  return {
    sessionId,
    compressedText,
    handles: handles.map(publicHandleMetadata),
    rawTokenEstimate,
    compressedTokenEstimate,
    tokenAccounting: {
      estimator: TOKEN_ESTIMATOR_ID,
      exact: false
    },
    savingsRatio: rawTokenEstimate === 0
      ? 0
      : Number((1 - compressedTokenEstimate / rawTokenEstimate).toFixed(4))
  };
}

function applyCompressionPolicy(payload: any, rawText: any) {
  if (payload.rawTokenEstimate === 0) {
    return payload;
  }

  const minimumUsefulTokens = Math.floor(payload.rawTokenEstimate * (1 - MIN_TOKEN_SAVINGS_RATIO));
  if (payload.compressedTokenEstimate <= minimumUsefulTokens) {
    payload.compressionSkipped = false;
    return payload;
  }

  return {
    ...payload,
    compressedText: String(rawText ?? "").trim(),
    compressedTokenEstimate: payload.rawTokenEstimate,
    savingsRatio: 0,
    compressionSkipped: true,
    skipReason: `Compression did not meet the ${Math.round(MIN_TOKEN_SAVINGS_RATIO * 100)}% minimum token savings threshold. Exact text was returned so model quality is preserved.`
  };
}

function renderHandle(handle: any) {
  const anchors = handle.anchors.length > 0 ? handle.anchors.join("|") : "none";
  const protectedTerms = handle.protectedTerms.length > 0 ? ` protect=${handle.protectedTerms.join("|")}` : "";
  return `[${handle.uri} label=${handle.label} role=${handle.role} chars=${handle.charLength} tok~${handle.tokenEstimate} anchors=${anchors}${protectedTerms} risk=${handle.risk.level}]`;
}

function publicHandleMetadata(handle: any) {
  return {
    spanId: handle.spanId,
    documentId: handle.documentId,
    uri: handle.uri,
    label: handle.label,
    role: handle.role,
    index: handle.index,
    mode: handle.mode,
    charLength: handle.charLength,
    checksum: handle.checksum,
    tokenEstimate: handle.tokenEstimate,
    anchors: handle.anchors,
    protectedTerms: handle.protectedTerms,
    risk: handle.risk
  };
}

function compactMatchMetadata(match: any) {
  return {
    uri: match.uri,
    matchKind: match.matchKind,
    score: match.score,
    exact: Boolean(match.exact),
    mustExpand: Boolean(match.mustExpand),
    criticalDiff: Boolean(match.criticalDiff)
  };
}

function serializeDocumentForStore(document: any) {
  const { handles: _handles, ...storedDocument } = document;
  const level1 = { ...(document.levels?.["1"] ?? {}) };
  const level4 = { ...(document.levels?.["4"] ?? {}) };
  delete level1.code;
  delete level1.conversation;
  delete level4.handles;

  return {
    ...storedDocument,
    levels: {
      ...document.levels,
      "1": level1,
      "4": level4
    }
  };
}

function serializeSpanForStore(span: any) {
  if (!["file", "text"].includes(span.source?.kind)) {
    return span;
  }

  return {
    metadata: {
      spanId: span.metadata.spanId,
      documentId: span.metadata.documentId,
      index: span.metadata.index,
      charLength: span.metadata.charLength,
      checksum: span.metadata.checksum,
      tokenEstimate: span.metadata.tokenEstimate,
      anchors: span.metadata.anchors,
      protectedTerms: span.metadata.protectedTerms,
      risk: span.metadata.risk
    },
    source: {
      kind: span.source.kind,
      sourceId: span.source.sourceId,
      startByte: span.source.startByte,
      endByte: span.source.endByte
    }
  };
}

function hydrateStoredSpan(session: any, span: any, document: any) {
  if (!span?.metadata?.spanId || !span.metadata.documentId) {
    throw new Error(`Corrupt ShapeLex span in session: ${session.id}`);
  }
  if (!document) {
    throw new Error(`ShapeLex span references an unknown document: ${span.metadata.documentId}`);
  }

  span.metadata.uri ??= `sx://${session.id}/span/${span.metadata.spanId}`;
  span.metadata.label ??= document.label;
  span.metadata.role ??= document.mode;
  span.metadata.mode ??= document.mode;
  span.metadata.anchors ??= [];
  span.metadata.protectedTerms ??= [];

  if (span.source?.kind === "file") {
    if (document.source?.kind !== "file") {
      throw new Error(`ShapeLex file-backed span has no file-backed document: ${span.metadata.spanId}`);
    }
    span.source.relativePath ??= document.source.relativePath;
    span.source.checksum ??= span.metadata.checksum;
    span.source.documentChecksum ??= document.checksum;
  } else if (span.source?.kind === "text") {
    if (document.source?.kind !== "text") {
      throw new Error(`ShapeLex text-backed span has no text-backed document: ${span.metadata.spanId}`);
    }
    span.source.sourceId ??= document.source.sourceId;
    span.source.checksum ??= span.metadata.checksum;
    span.source.documentChecksum ??= document.checksum;
  }
}

function hydrateStoredDocument(session: any, document: any) {
  const handles = [...session.spans.values()]
    .filter((span) => span.metadata.documentId === document.id)
    .map((span) => publicHandleMetadata(span.metadata))
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  document.handles = handles;
  document.levels ??= {};
  document.levels["1"] ??= { map: [] };
  document.levels["2"] ??= { anchors: [], protectedTerms: [] };
  document.levels["3"] ??= { criticalExtracts: [] };
  document.levels["4"] ??= { documentHandle: document.uri };
  if (document.code !== undefined) {
    document.levels["1"].code = document.code;
  }
  if (document.conversation !== undefined) {
    document.levels["1"].conversation = document.conversation;
  }
  document.levels["4"].handles = handles.map((handle) => ({
    uri: handle.uri,
    label: handle.label,
    role: handle.role,
    index: handle.index,
    tokenEstimate: handle.tokenEstimate,
    risk: handle.risk
  }));
}

function sessionTransactionSnapshot(session: any) {
  return {
    nextSpan: session.nextSpan,
    nextDocument: session.nextDocument,
    usageEventCount: (session.usageEvents ?? []).length
  };
}

function rollbackDocumentTransaction(session: any, document: any, snapshot: any) {
  session.documents.delete(document.id);
  for (const handle of document.handles ?? []) {
    session.spans.delete(handle.spanId);
    session.spanToDocument.delete(handle.spanId);
  }
  session.nextSpan = snapshot.nextSpan;
  session.nextDocument = snapshot.nextDocument;
  session.usageEvents = (session.usageEvents ?? []).slice(0, snapshot.usageEventCount);
}

function summarizeUsageEvents(events: any[]) {
  const normalizedEvents = Array.isArray(events) ? events : [];
  const rawTokens = normalizedEvents.reduce((sum, event) => sum + Number(event.rawTokens ?? 0), 0);
  const compressedTokens = normalizedEvents.reduce((sum, event) => sum + Number(event.compressedTokens ?? 0), 0);
  const tokenDelta = rawTokens - compressedTokens;
  return {
    operations: normalizedEvents.length,
    rawTokens,
    compressedTokens,
    tokenDelta,
    savingsRatio: rawTokens === 0 ? 0 : Number((1 - compressedTokens / rawTokens).toFixed(4)),
    compressedOperations: normalizedEvents.filter((event) => !event.compressionSkipped).length,
    skippedOperations: normalizedEvents.filter((event) => event.compressionSkipped).length
  };
}

function storedSpanBytes(session: any, sourceRecords?: ReadonlyMap<string, StoreSourceRecord>) {
  const textSourceIds = new Set(
    [...session.documents.values()]
      .filter((document) => document.source?.kind === "text")
      .map((document) => document.source.sourceId)
  );
  const sourceBytes = [...textSourceIds].reduce(
    (sum, sourceId) => sum + Number(sourceRecords?.get(sourceId)?.byteLength ?? 0),
    0
  );
  return sourceBytes + [...session.spans.values()].reduce(
    (sum, span) => sum + (typeof span.text === "string" ? Buffer.byteLength(span.text, "utf8") : 0),
    0
  );
}

function referencedSourceBytes(session: any) {
  return [...session.documents.values()].reduce(
    (sum, document) => sum + Number(document.source?.byteLength ?? 0),
    0
  );
}

function withInstruction(text) {
  return [
    "ShapeLex memory. Retrieve/risk-check before relying; use shapelex_expand for exact wording, numbers, code, or intent.",
    text
  ].join("\n\n");
}

function splitIntoSpans(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  const source = paragraphs.length > 0 ? paragraphs : [normalized];
  const spans = [];

  for (const paragraph of source) {
    if (paragraph.length <= 700) {
      spans.push({ text: paragraph });
      continue;
    }

    const sentences = paragraph.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [paragraph];
    let buffer = "";

    for (const sentence of sentences) {
      if ((buffer + sentence).length > 700 && buffer.trim()) {
        spans.push({ text: buffer.trim() });
        buffer = "";
      }
      buffer += sentence;
    }

    if (buffer.trim()) {
      spans.push({ text: buffer.trim() });
    }
  }

  return spans;
}

function spansFromMessages(messages) {
  return messages.map((message, index) => ({
    role: String(message.role ?? "unknown"),
    index,
    text: String(message.content ?? "")
  }));
}

function shouldCompressSpan(text) {
  const tokenEstimate = estimateTokens(text);
  return text.length >= LONG_SPAN_CHARS || tokenEstimate >= 60;
}

function extractCriticalExtracts(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const sentences = normalized.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [normalized];
  const extracts = [];
  let searchOffset = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      continue;
    }
    const sourceStart = normalized.indexOf(trimmed, searchOffset);
    const sourceEnd = sourceStart >= 0 ? sourceStart + trimmed.length : undefined;
    if (sourceEnd !== undefined) {
      searchOffset = sourceEnd;
    }
    const tokens = tokenize(trimmed);
    const reasons = [];
    if (tokens.some((token) => isProtectedToken(token))) reasons.push("protected-term");
    if (containsNumber(trimmed)) reasons.push("number");
    if (containsEntity(trimmed)) reasons.push("entity");
    if (containsCodeSignal(trimmed)) reasons.push("code-signal");
    if (containsDecisionSignal(trimmed)) reasons.push("decision");
    if (reasons.length > 0) {
      const preview = clampText(trimmed, 260);
      extracts.push({
        text: preview,
        exact: preview === trimmed,
        truncated: preview !== trimmed,
        sourceStart: sourceStart >= 0 ? sourceStart : undefined,
        sourceEnd,
        reasons: unique(reasons),
        tokenEstimate: estimateTokens(trimmed)
      });
    }
  }

  if (extracts.length === 0 && normalized.trim()) {
    const trimmed = normalized.trim();
    const preview = clampText(trimmed, 220);
    const sourceStart = normalized.indexOf(trimmed);
    extracts.push({
      text: preview,
      exact: preview === trimmed,
      truncated: preview !== trimmed,
      sourceStart,
      sourceEnd: sourceStart + trimmed.length,
      reasons: ["orientation"],
      tokenEstimate: estimateTokens(normalized)
    });
  }

  const seen = new Set();
  return extracts.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 10);
}

function analyzeRisk(text: any, { mode, criticalExtracts = [], code, conversation, protectedTerms = [] }: any = {}) {
  const reasons = [];
  let score = 0.08;
  const input = String(text ?? "");
  const tokens = tokenize(input);

  if (protectedTerms.length > 0 || tokens.some((token) => isProtectedToken(token))) {
    score += 0.22;
    reasons.push("protected-terms");
  }
  if (containsNumber(input)) {
    score += 0.16;
    reasons.push("numbers");
  }
  if (tokens.some((token) => ACTION_WORDS.has(token.toLowerCase())) && tokens.some((token) => isProtectedToken(token))) {
    score += 0.18;
    reasons.push("negation-or-control-action");
  }
  if (mode === "code" || containsCodeSignal(input)) {
    score += 0.18;
    reasons.push("code");
  }
  if (criticalExtracts.length >= 4) {
    score += 0.12;
    reasons.push("many-critical-extracts");
  }
  if (code?.errors?.length > 0 || code?.stackTraces?.length > 0) {
    score += 0.2;
    reasons.push("errors-or-stack-traces");
  }
  if (conversation?.changesOfMind?.length > 0) {
    score += 0.16;
    reasons.push("changes-of-mind");
  }
  if (estimateTokens(input) > 400) {
    score += 0.08;
    reasons.push("long-context");
  }

  const bounded = Number(Math.min(0.98, score).toFixed(2));
  return {
    score: bounded,
    level: bounded >= 0.7 ? "high" : bounded >= 0.4 ? "medium" : "low",
    confidence: confidenceFromScore(bounded),
    semanticLossRisk: bounded,
    ambiguityRisk: Number(Math.min(0.95, bounded + (criticalExtracts.length === 0 ? 0.18 : 0)).toFixed(2)),
    mustExpand: bounded >= 0.72 || reasons.includes("errors-or-stack-traces"),
    shouldExpand: bounded >= 0.4,
    reasons: unique(reasons)
  };
}

function confidenceFromRisk(risk) {
  return risk.confidence;
}

function confidenceFromScore(score) {
  return Number(Math.max(0.05, 1 - score).toFixed(2));
}

function analyzeCode(text: any, document: any) {
  const lines = String(text ?? "").split("\n");
  const imports = [];
  const symbols = [];
  const references = [];
  const errors = [];
  const stackTraces = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (/^(import|export\s+.*from|const\s+\w+\s*=\s*require\(|using\s+|from\s+\S+\s+import\s+)/.test(trimmed)) {
      imports.push({ line: lineNumber, text: trimmed });
    }

    const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/)
      ?? trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/)
      ?? trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (functionMatch) {
      symbols.push({
        kind: "function",
        name: functionMatch[1],
        signature: trimmed,
        lineStart: lineNumber,
        handle: nearestHandle(document, lineNumber)
      });
    }

    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) {
      symbols.push({
        kind: "class",
        name: classMatch[1],
        signature: trimmed,
        lineStart: lineNumber,
        handle: nearestHandle(document, lineNumber)
      });
    }

    const callMatches = [...trimmed.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1])
      .filter((name) => !["if", "for", "while", "switch", "catch", "function"].includes(name));
    for (const name of callMatches) {
      references.push({ name, line: lineNumber });
    }

    if (/\b(error|exception|failed|failure|traceback|stack)\b/i.test(trimmed)) {
      errors.push({ line: lineNumber, text: trimmed });
    }
    if (/^\s*at\s+\S+|\bTraceback\b|^\s*File\s+".+", line \d+/.test(line)) {
      stackTraces.push({ line: lineNumber, text: trimmed });
    }
  });

  return {
    summary: {
      imports: imports.length,
      symbols: symbols.length,
      references: references.length,
      errors: errors.length,
      stackTraces: stackTraces.length
    },
    imports: imports.slice(0, 50),
    symbols: symbols.slice(0, 80),
    references: references.slice(0, 80),
    dependencies: unique(imports.map((item) => item.text.replace(/^import\s+/, "").replace(/^from\s+/, ""))).slice(0, 40),
    errors: errors.slice(0, 30),
    stackTraces: stackTraces.slice(0, 30)
  };
}

function analyzeConversation(messagesOrText: any, document: any) {
  const entries = Array.isArray(messagesOrText)
    ? messagesOrText.map((message, index) => ({
      role: String(message.role ?? "unknown"),
      index,
      content: String(message.content ?? "")
    }))
    : [{ role: "unknown", index: 0, content: String(messagesOrText ?? "") }];

  const memory: any = {
    decisions: [],
    constraints: [],
    preferences: [],
    todos: [],
    negations: [],
    changesOfMind: [],
    openQuestions: [],
    timeline: []
  };

  for (const entry of entries) {
    const content = entry.content.trim();
    const lower = content.toLowerCase();
    const base = {
      role: entry.role,
      index: entry.index,
      text: clampText(content, 220),
      handle: nearestHandle(document, entry.index + 1)
    };
    memory.timeline.push(base);
    if (/\b(decid|decision|decidimos|queda|acordamos|we will|we decided)\b/i.test(content)) memory.decisions.push(base);
    if (/\b(must|must not|should|should not|no |not |never|sin |debe|restric|constraint|avoid|evita)\b/i.test(content)) memory.constraints.push(base);
    if (/\b(prefiero|prefer|me gusta|i prefer|quiero que|tone|estilo)\b/i.test(content)) memory.preferences.push(base);
    if (/\b(todo|pending|pendiente|siguiente|next|hacer|implementar|fix|arreglar)\b/i.test(content)) memory.todos.push(base);
    if (tokensContainNegation(content)) memory.negations.push(base);
    if (/\b(cambio de opinion|mejor no|actually|instead|en vez|ya no|change)\b/i.test(lower)) memory.changesOfMind.push(base);
    if (content.includes("?")) memory.openQuestions.push(base);
  }

  memory.summary = {
    decisions: memory.decisions.length,
    constraints: memory.constraints.length,
    preferences: memory.preferences.length,
    todos: memory.todos.length,
    negations: memory.negations.length,
    changesOfMind: memory.changesOfMind.length,
    openQuestions: memory.openQuestions.length
  };

  return memory;
}

function nearestHandle(document: any, position: any) {
  if (!document.handles.length) {
    return document.uri;
  }
  const index = Math.max(0, Math.min(document.handles.length - 1, position - 1));
  return document.handles[index]?.uri ?? document.uri;
}

function scoreDocument(document: any, queryTokens: any[]) {
  const haystack = [
    document.label,
    document.mode,
    document.levels[0].summary,
    ...document.levels[2].anchors,
    ...document.levels[2].protectedTerms,
    ...document.levels[3].criticalExtracts.map((item) => item.text),
    ...(document.code?.symbols ?? []).map((symbol) => symbol.name),
    ...(document.code?.imports ?? []).map((item) => item.text),
    ...(document.conversation?.decisions ?? []).map((item) => item.text),
    ...(document.conversation?.constraints ?? []).map((item) => item.text)
  ].join(" ").toLowerCase();

  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function resolveFingerprintTarget(session: any, indexId: string) {
  if (indexId.startsWith("doc:")) {
    const document = session.documents.get(indexId.slice(4));
    return document ? { document, uri: document.uri, metadata: undefined } : undefined;
  }
  if (!indexId.startsWith("span:")) {
    return undefined;
  }
  const spanId = indexId.slice(5);
  const span = session.spans.get(spanId);
  const document = session.documents.get(session.spanToDocument.get(spanId));
  return span && document
    ? { document, span, uri: span.metadata.uri, metadata: span.metadata }
    : undefined;
}

function fingerprintSearchResult(
  target: any,
  result: MatchResult,
  alignment?: FingerprintMatchAlignment
) {
  const risk = target.metadata?.risk ?? target.document.risk;
  return {
    documentId: target.document.id,
    uri: target.uri,
    label: target.metadata?.label ?? target.document.label,
    mode: target.document.mode,
    score: result.score,
    matchKind: result.matchKind,
    exact: result.exact,
    mustExpand: result.mustExpand || Boolean(risk?.mustExpand),
    criticalDiff: result.criticalDiff,
    metrics: result.metrics,
    ...(alignment ? {
      alignment: {
        dominantVotes: alignment.dominantVotes,
        usefulVotes: alignment.usefulVotes,
        coherentPeaks: alignment.coherentPeaks
      }
    } : {}),
    risk,
    bestAnchors: (target.metadata?.anchors ?? target.document.levels[2].anchors).slice(0, 6),
    criticalExtracts: target.document.levels[3].criticalExtracts.slice(0, 3)
  };
}

function downgradeUnmaterializedExactWindow(result: MatchResult): MatchResult {
  return {
    ...result,
    matchKind: "related",
    score: Math.min(result.score, 0.999999),
    exact: false,
    mustExpand: true
  };
}

function comparePublicSearchResults(left: any, right: any) {
  return (
    publicMatchPriority(right.matchKind) - publicMatchPriority(left.matchKind)
    || Number(right.score ?? 0) - Number(left.score ?? 0)
    || String(left.uri).localeCompare(String(right.uri))
  );
}

function publicMatchPriority(matchKind: string) {
  return {
    exact: 7,
    normalized_equal: 6,
    strong_related: 5,
    related_reordered: 4,
    related: 3,
    keyword: 2,
    unrelated: 1
  }[matchKind] ?? 0;
}

function parseShapeLexUri(uri) {
  const value = String(uri);
  let match = value.match(/^sx:\/\/([A-Za-z0-9._-]{1,80})\/span\/(span_\d+)$/);
  if (match) return { kind: "span", sessionId: match[1], id: match[2] };
  match = value.match(/^sx:\/\/([A-Za-z0-9._-]{1,80})\/(span_\d+)$/);
  if (match) return { kind: "span", sessionId: match[1], id: match[2] };
  match = value.match(/^sx:\/\/([A-Za-z0-9._-]{1,80})\/doc\/(doc_\d+)$/);
  if (match) return { kind: "doc", sessionId: match[1], id: match[2] };
  throw new Error(`Invalid ShapeLex URI: ${uri}`);
}

function parseResourceUri(uri) {
  const match = String(uri).match(/^sx:\/\/([A-Za-z0-9._-]{1,80})\/doc\/(doc_\d+)(?:\/level\/([0-4]))?$/);
  if (!match) {
    throw new Error(`Invalid ShapeLex resource URI: ${uri}`);
  }
  return {
    sessionId: match[1],
    documentId: match[2],
    level: match[3]
  };
}

function sanitizeResourcePayload(payload: any) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (payload.levels && payload.handles && payload.checksum) {
    return {
      id: payload.id,
      uri: payload.uri,
      label: payload.label,
      mode: payload.mode,
      checksum: payload.checksum,
      source: payload.source,
      levels: payload.levels,
      risk: payload.risk,
      confidence: payload.confidence
    };
  }
  if (Array.isArray(payload.fingerprints)) {
    const { fingerprints: _fingerprints, ...publicPayload } = payload;
    return publicPayload;
  }
  return payload;
}

function assertDocumentIntegrity(document: any, handle: any, text = document.text) {
  if (!document.checksum) {
    return;
  }
  if (!checksumMatches(text, document.checksum)) {
    throw new Error(`ShapeLex document checksum mismatch: ${handle}`);
  }
}

function assertSpanIntegrity(span: any, handle: any, text = span.text) {
  if (!span.metadata?.checksum) {
    return;
  }
  if (!checksumMatches(text, span.metadata.checksum)) {
    throw new Error(`ShapeLex span checksum mismatch: ${handle}`);
  }
}

function levelDescription(level) {
  return {
    "0": "Ultra summary",
    "1": "Semantic map",
    "2": "Anchors and fingerprints",
    "3": "Critical exact extracts",
    "4": "Exact expansion handles"
  }[String(level)] ?? "ShapeLex level";
}

function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function compactJoin(parts) {
  return parts.filter(Boolean).map((part) => part.trim()).filter(Boolean).join("\n\n");
}

function tokenize(text) {
  return normalizeText(text).match(/[A-Za-z][A-Za-z0-9_'-]*|\d+(?:\.\d+)?|[^\s]/g) ?? [];
}

function selectAnchors(tokens) {
  return tokens
    .map((token, index) => ({ token, index, score: salience(token, index) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_ANCHORS)
    .sort((a, b) => a.index - b.index);
}

function salience(token, index) {
  const lower = token.toLowerCase();
  if (!/[a-z0-9]/i.test(token)) {
    return 0;
  }

  let score = Math.min(10, token.length);
  if (STOPWORDS.has(lower)) {
    score -= 6;
  }
  if (isProtectedToken(token)) {
    score += 8;
  }
  if (/[A-Z][a-z]+[A-Z]/.test(token) || token.includes("_")) {
    score += 4;
  }
  if (/\d/.test(token)) {
    score += 3;
  }
  if (/^[A-Z][A-Za-z0-9_'-]+$/.test(token)) {
    score += 2;
  }

  return score + Math.max(0, 3 - index * 0.05);
}

function isProtectedToken(token) {
  const lower = token.toLowerCase();
  return PROTECTED_WORDS.has(lower)
    || /^!?=|[<>]=?$/.test(token)
    || /^\d{1,4}([/-]\d{1,2}){1,2}$/.test(token)
    || /^\d+(?:\.\d+)?%?$/.test(token)
    || /^\$?\d+(?:,\d{3})*(?:\.\d+)?$/.test(token)
    || /^v?\d+\.\d+(?:\.\d+)?$/.test(token);
}

function localSignature(token) {
  const shape = charShape(token);
  return `${shape.prefix}:${shape.suffix}:${shape.length}:${shape.vc}`;
}

function shortHash(value, hexChars = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, hexChars);
}

function sourceHash(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function checksumMatches(value: string, expected: unknown) {
  if (typeof expected !== "string" || !/^[a-f0-9]{16,64}$/i.test(expected)) {
    return false;
  }
  return sourceHash(value).slice(0, expected.length) === expected.toLowerCase();
}

function normalizeWorkspaceIdentity(workspaceRoot: string) {
  const normalized = path.resolve(workspaceRoot).split(path.sep).join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function charClass(char) {
  if (/[A-Z]/.test(char)) return "U";
  if (/[a-z]/.test(char)) return "L";
  if (/[0-9]/.test(char)) return "D";
  if (char === "_") return "_";
  if (/\s/.test(char)) return "S";
  return "P";
}

function vowelConsonantClass(char) {
  if (!/[a-z]/.test(char)) {
    return "O";
  }
  return VOWELS.has(char) ? "V" : "C";
}

function runLengthEncode(value) {
  if (!value) {
    return "";
  }

  let output = "";
  let last = value[0];
  let count = 1;

  for (let index = 1; index < value.length; index += 1) {
    const current = value[index];
    if (current === last) {
      count += 1;
    } else {
      output += `${last}${count > 1 ? count : ""}`;
      last = current;
      count = 1;
    }
  }

  return output + `${last}${count > 1 ? count : ""}`;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).length > 0))];
}

function containsNumber(text) {
  return /(?:\$?\d+(?:,\d{3})*(?:\.\d+)?%?)|(?:\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?)|(?:v?\d+\.\d+(?:\.\d+)?)/i.test(text);
}

function containsEntity(text) {
  return /\b[A-Z][A-Za-z0-9_'-]{2,}\b|`[^`]+`|\b[A-Za-z]+[A-Z][A-Za-z0-9]*\b/.test(text);
}

function containsCodeSignal(text) {
  return /```|=>|function\s+\w+|class\s+\w+|import\s+|export\s+|throw\s+|return\s+|[{}();]/.test(text);
}

function containsDecisionSignal(text) {
  return /\b(decided|decision|must|should|todo|pending|decidimos|debe|pendiente|restriccion|restric)\b/i.test(text);
}

function tokensContainNegation(text) {
  return tokenize(text).some((token) => {
    const lower = token.toLowerCase();
    return ["not", "no", "never", "without", "nunca", "jamas", "sin"].includes(lower);
  });
}

function clampText(text, maxLength) {
  const value = String(text ?? "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function assertString(value, name) {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
}

function assertBoundedString(value, name, maxLength) {
  assertString(value, name);
  if (value.length > maxLength) {
    throw new RangeError(`${name} must be ${maxLength} characters or fewer`);
  }
}

function assertMessage(message, index) {
  if (!message || typeof message !== "object") {
    throw new TypeError(`messages[${index}] must be an object`);
  }
  assertBoundedString(message.role, `messages[${index}].role`, 40);
  assertBoundedString(message.content, `messages[${index}].content`, MAX_TEXT_CHARS);
}

function normalizeSessionId(sessionId) {
  const id = sessionId === undefined ? DEFAULT_SESSION_ID : String(sessionId);
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new TypeError("sessionId must be 1-80 characters using only letters, numbers, dot, underscore, or hyphen");
  }
  return id;
}

function normalizeTextMode(mode) {
  const value = String(mode ?? "text");
  if (!TEXT_MODES.has(value)) {
    throw new TypeError("mode must be one of: text, doc, message, code");
  }
  return value === "doc" || value === "message" ? "text" : value;
}

function inferFileMode(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return new Set([
    ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
    ".java", ".js", ".jsx", ".mjs", ".php", ".py", ".rb", ".rs", ".sh",
    ".sql", ".swift", ".ts", ".tsx", ".vue"
  ]).has(extension)
    ? "code"
    : "doc";
}

function normalizeLabel(label) {
  if (label === undefined || label === null || label === "") {
    return "text";
  }
  assertBoundedString(label, "label", MAX_LABEL_CHARS);
  return label;
}

function normalizeSearchMode(mode) {
  const value = String(mode);
  if (!["text", "code", "conversation"].includes(value)) {
    throw new TypeError("mode must be one of: text, code, conversation");
  }
  return value;
}

function normalizeLevel(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new TypeError("level must be an integer from 0 through 4");
  }
  return value;
}

function normalizeContextDetail(detail) {
  const value = String(detail ?? "standard");
  if (!["brief", "standard"].includes(value)) {
    throw new TypeError("detail must be one of: brief, standard");
  }
  return value;
}

function normalizeLimit(limit) {
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("limit must be a positive integer");
  }
  return Math.min(value, 50);
}

function normalizeNonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return number;
}

function daysSince(isoDate) {
  const timestamp = Date.parse(isoDate);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
}

function normalizeMaxStoreBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1024 * 1024) {
    throw new TypeError("maxStoreBytes must be at least 1 MiB");
  }
  return Math.floor(bytes);
}

function protectLocalStoreWithGitignore(storageDir: string | undefined) {
  if (!storageDir) {
    return { enabled: false, reason: "no-storage-dir" };
  }

  const storeName = path.basename(storageDir);
  if (!storeName.startsWith(".shapelex")) {
    return { enabled: false, reason: "non-shapelex-store-dir", storeDir: storageDir };
  }

  const gitRoot = findGitRoot(path.dirname(storageDir));
  if (!gitRoot) {
    return { enabled: false, reason: "not-in-git-repo", storeDir: storageDir };
  }

  const relativeStore = path.relative(gitRoot, storageDir).replace(/\\/g, "/");
  if (!relativeStore || relativeStore.startsWith("../") || path.isAbsolute(relativeStore)) {
    return { enabled: false, reason: "store-outside-git-repo", storeDir: storageDir, gitRoot };
  }

  const entry = `${relativeStore.replace(/\/+$/, "")}/`;
  const gitignorePath = path.join(gitRoot, ".gitignore");

  try {
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
    const lines = existing.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(entry)) {
      return { enabled: true, changed: false, entry, gitignorePath };
    }

    const eol = existing.includes("\r\n") ? "\r\n" : "\n";
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? eol : "";
    const heading = lines.includes("# ShapeLex local memory") ? "" : `# ShapeLex local memory${eol}`;
    fs.writeFileSync(gitignorePath, `${existing}${prefix}${heading}${entry}${eol}`);
    return { enabled: true, changed: true, entry, gitignorePath };
  } catch (error) {
    return {
      enabled: false,
      reason: "gitignore-write-failed",
      entry,
      gitignorePath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function findGitRoot(startDir: string) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function assertUriSession(uriSessionId, requestedSessionId, uri) {
  if (uriSessionId !== requestedSessionId) {
    throw new Error(`ShapeLex URI session mismatch: ${uri}`);
  }
}
