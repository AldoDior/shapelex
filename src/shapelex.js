import crypto from "node:crypto";

const DEFAULT_SESSION_ID = "default";
const LONG_SPAN_CHARS = 240;
const RECENT_MESSAGE_CHARS = 900;
const MAX_ANCHORS = 12;
const CONTEXT_RADIUS = 90;
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

export class ShapeLexEngine {
  constructor() {
    this.sessions = new Map();
  }

  compress(input) {
    const mode = input.mode ?? (input.messages ? "conversation" : "text");
    if (Array.isArray(input.messages)) {
      return this.compressMessages({ ...input, mode: "conversation" });
    }
    return this.compressText({ ...input, mode });
  }

  compressText({ sessionId = DEFAULT_SESSION_ID, text, label = "text", mode = "text", budgetTokens } = {}) {
    assertString(text, "text");
    const session = this.#session(sessionId);
    const document = this.#createDocument(session, { text, label, mode });
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
      conversation: document.conversation
    });

    if (Number.isFinite(budgetTokens)) {
      payload.budgetTokens = budgetTokens;
      payload.withinBudget = payload.compressedTokenEstimate <= budgetTokens;
    }

    return payload;
  }

  compressMessages({ sessionId = DEFAULT_SESSION_ID, messages, budgetTokens, label = "conversation" } = {}) {
    if (!Array.isArray(messages)) {
      throw new TypeError("messages must be an array");
    }

    const text = messages
      .map((message, index) => `[${message.role ?? "unknown"}#${index}] ${message.content ?? ""}`)
      .join("\n\n");
    const session = this.#session(sessionId);
    const document = this.#createDocument(session, {
      text,
      label,
      mode: "conversation",
      messages
    });

    const compressedMessages = messages.map((message, index) => {
      const role = String(message.role ?? "unknown");
      const content = String(message.content ?? "");
      const isLatest = index === messages.length - 1;
      const threshold = isLatest ? RECENT_MESSAGE_CHARS : LONG_SPAN_CHARS;

      if (content.length <= threshold && !shouldCompressSpan(content)) {
        return `[${role}#${index}] ${content.trim()}`;
      }

      const span = document.spans.find((item) => item.metadata.index === index);
      if (span && (!isLatest || content.length > threshold)) {
        return `[${role}#${index}] ${renderHandle(span.metadata)}`;
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

    if (Number.isFinite(budgetTokens)) {
      payload.budgetTokens = budgetTokens;
      payload.withinBudget = payload.compressedTokenEstimate <= budgetTokens;
    }

    return payload;
  }

  expand({ sessionId = DEFAULT_SESSION_ID, handle }) {
    assertString(handle, "handle");
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${sessionId}`);
    }

    const parsed = parseShapeLexUri(handle);
    if (parsed.kind === "doc") {
      const document = session.documents.get(parsed.id);
      if (!document) {
        throw new Error(`Unknown ShapeLex document: ${handle}`);
      }
      session.lastAccessedAt = new Date().toISOString();
      return {
        handle,
        text: document.text,
        metadata: {
          documentId: document.id,
          uri: document.uri,
          label: document.label,
          mode: document.mode,
          risk: document.risk
        }
      };
    }

    const span = session.spans.get(parsed.id);
    if (!span) {
      throw new Error(`Unknown ShapeLex handle: ${handle}`);
    }

    session.lastAccessedAt = new Date().toISOString();
    return {
      handle,
      text: span.text,
      metadata: span.metadata
    };
  }

  search({ sessionId = DEFAULT_SESSION_ID, query, mode, limit = 8 } = {}) {
    assertString(query, "query");
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${sessionId}`);
    }

    const queryTokens = tokenize(query).map((token) => token.toLowerCase());
    const results = [];

    for (const document of session.documents.values()) {
      if (mode && document.mode !== mode) {
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
        score,
        risk: document.risk,
        bestAnchors: document.levels[2].anchors.filter((anchor) => queryTokens.includes(anchor.toLowerCase())).slice(0, 6),
        criticalExtracts: document.levels[3].criticalExtracts.slice(0, 3)
      });
    }

    return {
      sessionId,
      query,
      results: results.sort((a, b) => b.score - a.score).slice(0, limit)
    };
  }

  retrieve({ sessionId = DEFAULT_SESSION_ID, uri, level = 1, query } = {}) {
    assertString(uri, "uri");
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${sessionId}`);
    }

    const parsed = parseShapeLexUri(uri);
    if (parsed.kind === "span") {
      return this.expand({ sessionId, handle: uri });
    }

    const document = session.documents.get(parsed.id);
    if (!document) {
      throw new Error(`Unknown ShapeLex document: ${uri}`);
    }

    const normalizedLevel = String(level);
    const levels = {};
    for (const key of ["0", "1", "2", "3", "4"]) {
      if (Number(key) <= Number(normalizedLevel)) {
        levels[key] = document.levels[key];
      }
    }

    const response = {
      sessionId,
      documentId: document.id,
      uri: document.uri,
      label: document.label,
      mode: document.mode,
      requestedLevel: Number(normalizedLevel),
      levels,
      risk: document.risk,
      confidence: document.confidence
    };

    if (query) {
      response.search = this.search({ sessionId, query, mode: document.mode, limit: 5 }).results;
    }

    return response;
  }

  explain({ sessionId = DEFAULT_SESSION_ID, uri } = {}) {
    assertString(uri, "uri");
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${sessionId}`);
    }
    const parsed = parseShapeLexUri(uri);
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
        "Level 2 exposes anchors and fingerprints for search.",
        "Level 3 preserves exact critical extracts.",
        "Level 4 contains exact expandable handles."
      ],
      riskPolicy: document.risk,
      expansionGuidance: document.risk.mustExpand
        ? "Expand before relying on this memory for user intent, numbers, code, or instructions."
        : "Compressed levels are usable for orientation; expand before quoting or executing."
    };
  }

  riskAssessment({ sessionId = DEFAULT_SESSION_ID, uri, text } = {}) {
    if (text !== undefined) {
      assertString(text, "text");
      const analysis = analyzeRisk(text, { mode: "text", criticalExtracts: extractCriticalExtracts(text) });
      return analysis;
    }

    assertString(uri, "uri");
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown ShapeLex session: ${sessionId}`);
    }
    const parsed = parseShapeLexUri(uri);
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

  listResources({ sessionId } = {}) {
    const sessions = sessionId ? [this.sessions.get(sessionId)].filter(Boolean) : [...this.sessions.values()];
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

  readResource({ uri }) {
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

  stats({ sessionId } = {}) {
    const sessions = sessionId ? [this.sessions.get(sessionId)].filter(Boolean) : [...this.sessions.values()];
    const sessionStats = sessions.map((session) => ({
      sessionId: session.id,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      activeDocuments: session.documents.size,
      activeHandles: session.spans.size,
      approxMemoryBytes: [...session.spans.values()].reduce((sum, span) => sum + Buffer.byteLength(span.text, "utf8"), 0)
    }));

    return {
      sessions: sessionStats,
      activeDocuments: sessionStats.reduce((sum, item) => sum + item.activeDocuments, 0),
      activeHandles: sessionStats.reduce((sum, item) => sum + item.activeHandles, 0),
      approxMemoryBytes: sessionStats.reduce((sum, item) => sum + item.approxMemoryBytes, 0)
    };
  }

  clear({ sessionId } = {}) {
    if (sessionId) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.clear();
    }

    return { cleared: true };
  }

  #session(sessionId) {
    const id = String(sessionId || DEFAULT_SESSION_ID);
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
        spanToDocument: new Map()
      };
      this.sessions.set(id, session);
    }

    session.lastAccessedAt = new Date().toISOString();
    return session;
  }

  #createDocument(session, { text, label, mode, messages }) {
    const documentId = `doc_${session.nextDocument++}`;
    const document = {
      id: documentId,
      uri: `sx://${session.id}/doc/${documentId}`,
      label,
      mode,
      text,
      checksum: shortHash(text, 24),
      createdAt: new Date().toISOString(),
      spans: [],
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
      document.spans.push({ text: sourceSpan.text, metadata });
    }

    const anchors = unique(document.spans.flatMap((span) => span.metadata.anchors)).slice(0, MAX_ANCHORS);
    const protectedTerms = unique(document.spans.flatMap((span) => span.metadata.protectedTerms));
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

function buildLevels(document, { anchors, protectedTerms, criticalExtracts, code, conversation }) {
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
      protectedTerms,
      fingerprints: unique(document.handles.flatMap((handle) => handle.fingerprints)).slice(0, MAX_ANCHORS)
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

function summarizeDocument(document, { anchors, code, conversation }) {
  if (document.mode === "code" && code) {
    return `${document.label}: code memory with ${code.imports.length} imports, ${code.symbols.length} symbols, ${code.errors.length} errors, and ${document.handles.length} expandable spans.`;
  }
  if (document.mode === "conversation" && conversation) {
    return `${document.label}: conversation memory with ${conversation.decisions.length} decisions, ${conversation.constraints.length} constraints, ${conversation.todos.length} todos, and ${conversation.negations.length} negations.`;
  }
  const topic = anchors.length > 0 ? anchors.slice(0, 5).join(", ") : "general text";
  return `${document.label}: compressed ${document.mode} memory about ${topic}, with ${document.handles.length} expandable spans.`;
}

function renderNavigableDocument(document) {
  return withInstruction([
    `${document.uri} ${document.mode} risk=${document.risk.level} expand=${document.risk.shouldExpand}`,
    `L0 ${document.levels[0].summary}`,
    `L2 ${document.levels[2].anchors.slice(0, 8).join(",") || "none"}`,
    `L3 critical=${document.levels[3].criticalExtracts.length}`,
    `L4 ${document.levels[4].handles.map((item) => item.uri).join(",")}`
  ].join("\n\n"));
}

function renderLevelSummary(document) {
  return `ShapeLex document ${document.uri}\nLevel 0: ${document.levels[0].summary}\nRisk: ${document.risk.level} (${document.risk.score}) mustExpand=${document.risk.mustExpand}`;
}

function resultPayload(sessionId, compressedText, handles, rawText) {
  const rawTokenEstimate = estimateTokens(rawText);
  const compressedTokenEstimate = estimateTokens(compressedText);

  return {
    sessionId,
    compressedText,
    handles,
    rawTokenEstimate,
    compressedTokenEstimate,
    savingsRatio: rawTokenEstimate === 0
      ? 0
      : Number((1 - compressedTokenEstimate / rawTokenEstimate).toFixed(4))
  };
}

function renderHandle(handle) {
  const anchors = handle.anchors.length > 0 ? handle.anchors.join("|") : "none";
  const protectedTerms = handle.protectedTerms.length > 0 ? ` protect=${handle.protectedTerms.join("|")}` : "";
  const fps = handle.fingerprints.slice(0, 4).join(",");
  return `[${handle.uri} label=${handle.label} role=${handle.role} chars=${handle.charLength} tok~${handle.tokenEstimate} anchors=${anchors}${protectedTerms} risk=${handle.risk.level} fp=${fps}]`;
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

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      continue;
    }
    const tokens = tokenize(trimmed);
    const reasons = [];
    if (tokens.some((token) => isProtectedToken(token))) reasons.push("protected-term");
    if (containsNumber(trimmed)) reasons.push("number");
    if (containsEntity(trimmed)) reasons.push("entity");
    if (containsCodeSignal(trimmed)) reasons.push("code-signal");
    if (containsDecisionSignal(trimmed)) reasons.push("decision");
    if (reasons.length > 0) {
      extracts.push({
        text: clampText(trimmed, 260),
        reasons: unique(reasons),
        tokenEstimate: estimateTokens(trimmed)
      });
    }
  }

  if (extracts.length === 0 && normalized.trim()) {
    extracts.push({
      text: clampText(normalized.trim(), 220),
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

function analyzeRisk(text, { mode, criticalExtracts = [], code, conversation, protectedTerms = [] } = {}) {
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

function analyzeCode(text, document) {
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

function analyzeConversation(messagesOrText, document) {
  const entries = Array.isArray(messagesOrText)
    ? messagesOrText.map((message, index) => ({
      role: String(message.role ?? "unknown"),
      index,
      content: String(message.content ?? "")
    }))
    : [{ role: "unknown", index: 0, content: String(messagesOrText ?? "") }];

  const memory = {
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

function nearestHandle(document, position) {
  if (!document.handles.length) {
    return document.uri;
  }
  const index = Math.max(0, Math.min(document.handles.length - 1, position - 1));
  return document.handles[index]?.uri ?? document.uri;
}

function scoreDocument(document, queryTokens) {
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

function parseShapeLexUri(uri) {
  const value = String(uri);
  let match = value.match(/^sx:\/\/[^/]+\/span\/(span_\d+)$/);
  if (match) return { kind: "span", id: match[1] };
  match = value.match(/^sx:\/\/[^/]+\/(span_\d+)$/);
  if (match) return { kind: "span", id: match[1] };
  match = value.match(/^sx:\/\/[^/]+\/doc\/(doc_\d+)$/);
  if (match) return { kind: "doc", id: match[1] };
  throw new Error(`Invalid ShapeLex URI: ${uri}`);
}

function parseResourceUri(uri) {
  const match = String(uri).match(/^sx:\/\/([^/]+)\/doc\/(doc_\d+)(?:\/level\/([0-4]))?$/);
  if (!match) {
    throw new Error(`Invalid ShapeLex resource URI: ${uri}`);
  }
  return {
    sessionId: match[1],
    documentId: match[2],
    level: match[3]
  };
}

function sanitizeResourcePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (payload.text && payload.spans) {
    return {
      id: payload.id,
      uri: payload.uri,
      label: payload.label,
      mode: payload.mode,
      checksum: payload.checksum,
      levels: payload.levels,
      risk: payload.risk,
      confidence: payload.confidence
    };
  }
  return payload;
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
