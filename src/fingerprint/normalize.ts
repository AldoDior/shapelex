import type { NormalizedText, NormalizedUnit } from "./types.js";

const MARK_PATTERN = /^\p{M}$/u;
const HANGUL_JAMO_PATTERN = /^[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]$/u;
const ASCII_TEXT_PATTERN = /^[\x00-\x7f]*$/;

/**
 * Applies the strict lexical-v1 normalization while retaining conservative
 * ranges into the original UTF-8 bytes. A composed output scalar maps to the
 * complete source cluster that produced it.
 */
export function normalizeStrict(input: string): NormalizedText {
  assertText(input);
  if (ASCII_TEXT_PATTERN.test(input)) {
    return normalizeStrictAscii(input);
  }
  const units: NormalizedUnit[] = [];
  let normalizedText = "";
  let utf16Offset = 0;
  let byteOffset = 0;
  const normalizationCache = new Map<string, string>();

  while (utf16Offset < input.length) {
    const value = scalarAt(input, utf16Offset);
    const scalarByteLength = utf8ScalarLength(value);
    if (value === "\r") {
      const hasLineFeed = input[utf16Offset + 1] === "\n";
      const byteEnd = byteOffset + scalarByteLength + (hasLineFeed ? 1 : 0);
      appendMappedValue(units, "\n", byteOffset, byteEnd, normalizedText.length);
      normalizedText += "\n";
      utf16Offset += hasLineFeed ? 2 : 1;
      byteOffset = byteEnd;
      continue;
    }

    const clusterStart = byteOffset;
    let cluster = value;
    utf16Offset += value.length;
    byteOffset += scalarByteLength;
    while (
      utf16Offset < input.length
      && (
        MARK_PATTERN.test(scalarAt(input, utf16Offset))
        || (
          HANGUL_JAMO_PATTERN.test(value)
          && HANGUL_JAMO_PATTERN.test(scalarAt(input, utf16Offset))
        )
      )
    ) {
      const nextValue = scalarAt(input, utf16Offset);
      cluster += nextValue;
      utf16Offset += nextValue.length;
      byteOffset += utf8ScalarLength(nextValue);
    }

    let normalizedCluster = normalizationCache.get(cluster);
    if (normalizedCluster === undefined) {
      normalizedCluster = cluster.normalize("NFC");
      normalizationCache.set(cluster, normalizedCluster);
    }
    appendMappedValue(units, normalizedCluster, clusterStart, byteOffset, normalizedText.length);
    normalizedText += normalizedCluster;
  }

  // Defensive fallback for normalization interactions outside common Unicode
  // canonical clusters. Exactness never depends on this mapping.
  const expected = input.replace(/\r\n?/g, "\n").normalize("NFC");
  if (normalizedText !== expected) {
    return mapWholeNormalizedText(expected, Buffer.byteLength(input, "utf8"));
  }

  return {
    text: normalizedText,
    units,
    rawByteLength: Buffer.byteLength(input, "utf8")
  };
}

/**
 * Produces the recall-only character channel: lowercase NFC text with stable
 * newlines and collapsed whitespace. Every output scalar keeps its source
 * byte range.
 */
export function normalizeRecall(input: string | NormalizedText): NormalizedText {
  const strict = typeof input === "string" ? normalizeStrict(input) : input;
  if (ASCII_TEXT_PATTERN.test(strict.text)) {
    return normalizeRecallAscii(strict);
  }
  const units: NormalizedUnit[] = [];
  let text = "";
  let pendingWhitespace: NormalizedUnit | undefined;
  const transformCache = new Map<string, { whitespace: boolean; lowered: string }>();

  for (const unit of strict.units) {
    let transform = transformCache.get(unit.value);
    if (!transform) {
      transform = {
        whitespace: /^\s+$/u.test(unit.value),
        lowered: unit.value.toLowerCase().normalize("NFC")
      };
      transformCache.set(unit.value, transform);
    }
    if (transform.whitespace) {
      if (text.length > 0) {
        pendingWhitespace = pendingWhitespace
          ? { ...pendingWhitespace, rawByteEnd: unit.rawByteEnd }
          : unit;
      }
      continue;
    }

    if (pendingWhitespace) {
      appendMappedValue(
        units,
        " ",
        pendingWhitespace.rawByteStart,
        pendingWhitespace.rawByteEnd,
        text.length
      );
      text += " ";
      pendingWhitespace = undefined;
    }

    const lowered = transform.lowered;
    appendMappedValue(units, lowered, unit.rawByteStart, unit.rawByteEnd, text.length);
    text += lowered;
  }

  return { text, units, rawByteLength: strict.rawByteLength };
}

/**
 * Returns the recall text without allocating a second unit-object graph when
 * ASCII input already has one non-edge whitespace scalar between terms.
 * In that case every recall position maps one-to-one to the strict unit at the
 * same position.
 */
export function normalizeCanonicalAsciiRecallText(
  strict: NormalizedText
): string | undefined {
  if (
    !ASCII_TEXT_PATTERN.test(strict.text)
    || /^\s|\s$|\s{2,}/.test(strict.text)
  ) {
    return undefined;
  }
  return strict.text.replace(/\s/g, " ").toLowerCase();
}

function normalizeStrictAscii(input: string): NormalizedText {
  if (!input.includes("\r")) {
    const units = new Array<NormalizedUnit>(input.length);
    for (let offset = 0; offset < input.length; offset += 1) {
      units[offset] = {
        value: input[offset]!,
        normalizedStart: offset,
        normalizedEnd: offset + 1,
        rawByteStart: offset,
        rawByteEnd: offset + 1
      };
    }
    return { text: input, units, rawByteLength: input.length };
  }

  const units: NormalizedUnit[] = [];
  let text = "";
  let normalizedOffset = 0;
  for (let rawOffset = 0; rawOffset < input.length;) {
    const value = input[rawOffset]!;
    const isCarriageReturn = value === "\r";
    const rawLength = isCarriageReturn && input[rawOffset + 1] === "\n" ? 2 : 1;
    const normalizedValue = isCarriageReturn ? "\n" : value;
    units.push({
      value: normalizedValue,
      normalizedStart: normalizedOffset,
      normalizedEnd: normalizedOffset + 1,
      rawByteStart: rawOffset,
      rawByteEnd: rawOffset + rawLength
    });
    text += normalizedValue;
    normalizedOffset += 1;
    rawOffset += rawLength;
  }
  return { text, units, rawByteLength: input.length };
}

function normalizeRecallAscii(strict: NormalizedText): NormalizedText {
  const units: NormalizedUnit[] = [];
  let text = "";
  let pendingWhitespaceStart = -1;
  let pendingWhitespaceEnd = -1;

  for (const unit of strict.units) {
    const code = unit.value.charCodeAt(0);
    if (isAsciiWhitespace(code)) {
      if (text.length > 0) {
        if (pendingWhitespaceStart < 0) {
          pendingWhitespaceStart = unit.rawByteStart;
        }
        pendingWhitespaceEnd = unit.rawByteEnd;
      }
      continue;
    }

    if (pendingWhitespaceStart >= 0) {
      units.push({
        value: " ",
        normalizedStart: text.length,
        normalizedEnd: text.length + 1,
        rawByteStart: pendingWhitespaceStart,
        rawByteEnd: pendingWhitespaceEnd
      });
      text += " ";
      pendingWhitespaceStart = -1;
      pendingWhitespaceEnd = -1;
    }

    const lowered = code >= 0x41 && code <= 0x5a
      ? String.fromCharCode(code + 0x20)
      : unit.value;
    units.push({
      value: lowered,
      normalizedStart: text.length,
      normalizedEnd: text.length + 1,
      rawByteStart: unit.rawByteStart,
      rawByteEnd: unit.rawByteEnd
    });
    text += lowered;
  }

  return { text, units, rawByteLength: strict.rawByteLength };
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

function appendMappedValue(
  units: NormalizedUnit[],
  value: string,
  rawByteStart: number,
  rawByteEnd: number,
  initialNormalizedOffset: number
): void {
  let normalizedOffset = initialNormalizedOffset;
  for (const scalar of value) {
    units.push({
      value: scalar,
      normalizedStart: normalizedOffset,
      normalizedEnd: normalizedOffset + scalar.length,
      rawByteStart,
      rawByteEnd
    });
    normalizedOffset += scalar.length;
  }
}

/* c8 ignore next -- defensive fallback for future Unicode normalization changes */
function mapWholeNormalizedText(text: string, rawByteLength: number): NormalizedText {
  const units: NormalizedUnit[] = [];
  let normalizedOffset = 0;
  for (const value of text) {
    units.push({
      value,
      normalizedStart: normalizedOffset,
      normalizedEnd: normalizedOffset + value.length,
      rawByteStart: 0,
      rawByteEnd: rawByteLength
    });
    normalizedOffset += value.length;
  }
  return { text, units, rawByteLength };
}

function assertText(input: string): void {
  if (typeof input !== "string") {
    throw new TypeError("text must be a string");
  }
}

function scalarAt(input: string, utf16Offset: number): string {
  const codePoint = input.codePointAt(utf16Offset);
  if (codePoint === undefined) {
    throw new RangeError("UTF-16 offset is outside the input");
  }
  return String.fromCodePoint(codePoint);
}

function utf8ScalarLength(value: string): number {
  const firstCodeUnit = value.charCodeAt(0);
  if (value.length === 1 && firstCodeUnit <= 0x7f) {
    return 1;
  }
  return Buffer.byteLength(value, "utf8");
}
