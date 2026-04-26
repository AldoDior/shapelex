import crypto from "node:crypto";

const DEFAULT_SESSION_ID = "default";
const LONG_SPAN_CHARS = 240;
const RECENT_MESSAGE_CHARS = 900;
const MAX_ANCHORS = 8;
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "are", "was", "were", "you", "your", "about", "into", "onto", "before",
  "after", "then", "than", "they", "them", "their", "there", "here", "what",
  "when", "where", "which", "while", "also", "como", "para", "pero", "porque",
  "esta", "este", "estos", "estas", "con", "del", "las", "los", "una", "unos"
]);
const PROTECTED_WORDS = new Set([
  "not", "no", "never", "without", "must", "should", "shall", "cannot", "can't",
  "do", "don't", "dont", "avoid", "only", "always", "before", "after", "unless",
  "except", "if", "else", "throw", "return", "delete", "remove", "drop", "reset",
  "approve", "deny", "allow", "block"
]);

export class ShapeLexEngine {
  constructor() {
    this.sessions = new Map();
  }

  compressText({ sessionId = DEFAULT_SESSION_ID, text, label = "text", mode = "message" }) {
    assertString(text, "text");
    const session = this.#session(sessionId);
    const spans = splitIntoSpans(text);
    const handles = [];
    const compressedParts = [];

    for (const span of spans) {
      if (shouldCompressSpan(span.text)) {
        const handle = this.#storeSpan(session, {
          text: span.text,
          label,
          role: mode,
          index: handles.length,
          mode
        });
        handles.push(handle);
        compressedParts.push(renderHandle(handle));
      } else {
        compressedParts.push(span.text.trim());
      }
    }

    const compressedText = withInstruction(compactJoin(compressedParts));
    return resultPayload(session.id, compressedText, handles, text);
  }

  compressMessages({ sessionId = DEFAULT_SESSION_ID, messages, budgetTokens }) {
    if (!Array.isArray(messages)) {
      throw new TypeError("messages must be an array");
    }

    const session = this.#session(sessionId);
    const handles = [];
    const rawText = messages.map((message) => `${message.role ?? "unknown"}: ${message.content ?? ""}`).join("\n\n");
    const compressedMessages = messages.map((message, index) => {
      const role = String(message.role ?? "unknown");
      const content = String(message.content ?? "");
      const isLatest = index === messages.length - 1;
      const threshold = isLatest ? RECENT_MESSAGE_CHARS : LONG_SPAN_CHARS;

      if (content.length <= threshold && !shouldCompressSpan(content)) {
        return `[${role}#${index}] ${content.trim()}`;
      }

      const chunks = splitIntoSpans(content);
      const rendered = chunks.map((chunk) => {
        if (chunk.text.length < threshold && isLatest) {
          return chunk.text.trim();
        }
        if (!shouldCompressSpan(chunk.text) && chunk.text.length < LONG_SPAN_CHARS) {
          return chunk.text.trim();
        }

        const handle = this.#storeSpan(session, {
          text: chunk.text,
          label: `message_${index}`,
          role,
          index,
          mode: "message"
        });
        handles.push(handle);
        return renderHandle(handle);
      });

      return `[${role}#${index}] ${compactJoin(rendered)}`;
    });

    const compressedText = withInstruction(compactJoin(compressedMessages));
    const payload = resultPayload(session.id, compressedText, handles, rawText);

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

    const spanId = parseHandle(handle);
    const span = session.spans.get(spanId);
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

  stats({ sessionId } = {}) {
    const sessions = sessionId ? [this.sessions.get(sessionId)].filter(Boolean) : [...this.sessions.values()];
    const sessionStats = sessions.map((session) => ({
      sessionId: session.id,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      activeHandles: session.spans.size,
      approxMemoryBytes: [...session.spans.values()].reduce((sum, span) => sum + Buffer.byteLength(span.text, "utf8"), 0)
    }));

    return {
      sessions: sessionStats,
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
        spans: new Map()
      };
      this.sessions.set(id, session);
    }

    session.lastAccessedAt = new Date().toISOString();
    return session;
  }

  #storeSpan(session, span) {
    const spanId = `span_${session.nextSpan++}`;
    const analysis = analyzeSpan(span.text);
    const uri = `sx://${session.id}/${spanId}`;
    const metadata = {
      spanId,
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
      fingerprints: analysis.fingerprints
    };

    session.spans.set(spanId, {
      text: span.text,
      metadata
    });

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
    protectedTerms: [...new Set(protectedTerms)],
    shapes,
    fingerprints
  };
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
  return `[${handle.uri} label=${handle.label} role=${handle.role} chars=${handle.charLength} tok~${handle.tokenEstimate} anchors=${anchors}${protectedTerms} fp=${fps}]`;
}

function withInstruction(text) {
  return [
    "ShapeLex compressed context. Use shapelex_expand for any sx:// handle when exact wording, negation, numbers, code, or user intent matters.",
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

function shouldCompressSpan(text) {
  const tokenEstimate = estimateTokens(text);
  return text.length >= LONG_SPAN_CHARS || tokenEstimate >= 60;
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

  return score + Math.max(0, 3 - index * 0.05);
}

function isProtectedToken(token) {
  const lower = token.toLowerCase();
  return PROTECTED_WORDS.has(lower)
    || /^!?=|[<>]=?$/.test(token)
    || /^\d{1,4}([/-]\d{1,2}){1,2}$/.test(token)
    || /^\d+(?:\.\d+)?$/.test(token);
}

function localSignature(token) {
  const shape = charShape(token);
  return `${shape.prefix}:${shape.suffix}:${shape.length}:${shape.vc}`;
}

function shortHash(value, hexChars = 16) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, hexChars);
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

function parseHandle(handle) {
  const match = String(handle).match(/^sx:\/\/[^/]+\/(span_\d+)$/);
  if (!match) {
    throw new Error(`Invalid ShapeLex handle: ${handle}`);
  }
  return match[1];
}

function assertString(value, name) {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
}
