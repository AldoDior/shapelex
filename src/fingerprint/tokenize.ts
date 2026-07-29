import { normalizeStrict } from "./normalize.js";
import type {
  NormalizedText,
  NormalizedUnit,
  StrictToken,
  StrictTokenKind
} from "./types.js";

const WORD_SCALAR_PATTERN = /^[\p{L}\p{M}\p{N}_$]$/u;
const NUMBER_START_PATTERN = /^\p{N}$/u;
const WHITESPACE_PATTERN = /^\s$/u;
const MULTI_CHARACTER_OPERATORS = [
  ">>>=", "===", "!==", "**=", "<<=", ">>=", "??=", "&&=", "||=", "&=", "|=", "^=", "=>",
  "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "**", ">>>", "<<", ">>", "::", ":=", "<>", "->", "|>", "..."
];
const OPERATOR_SCALARS = new Set(Array.from("+-*/%=&|!<>?:~^"));
const ASCII_TEXT_PATTERN = /^[\x00-\x7f]*$/;
const ASCII_WITHOUT_CARRIAGE_RETURN_PATTERN = /^[\x00-\x0c\x0e-\x7f]*$/;
const OPERATORS_BY_FIRST = groupOperatorsByFirstScalar();

export function tokenizeStrict(input: string | NormalizedText): StrictToken[] {
  if (
    typeof input === "string"
    && ASCII_WITHOUT_CARRIAGE_RETURN_PATTERN.test(input)
  ) {
    return tokenizeAsciiText(input, createIdentityToken);
  }
  const normalized = typeof input === "string" ? normalizeStrict(input) : input;
  if (ASCII_TEXT_PATTERN.test(normalized.text)) {
    return tokenizeAscii(normalized);
  }
  const tokens: StrictToken[] = [];
  const units = normalized.units;

  for (let index = 0; index < units.length;) {
    const unit = units[index]!;
    if (WHITESPACE_PATTERN.test(unit.value)) {
      index += 1;
      continue;
    }

    if (WORD_SCALAR_PATTERN.test(unit.value)) {
      const kind: StrictTokenKind = NUMBER_START_PATTERN.test(unit.value) ? "number" : "word";
      let end = index + 1;
      while (end < units.length && WORD_SCALAR_PATTERN.test(units[end]!.value)) {
        end += 1;
      }
      tokens.push(createToken(normalized, index, end, kind));
      index = end;
      continue;
    }

    const operatorLength = matchOperatorLength(units, index);
    if (operatorLength > 0) {
      tokens.push(createToken(normalized, index, index + operatorLength, "operator"));
      index += operatorLength;
      continue;
    }

    tokens.push(createToken(normalized, index, index + 1, "punctuation"));
    index += 1;
  }

  return tokens;
}

function tokenizeAscii(normalized: NormalizedText): StrictToken[] {
  return tokenizeAsciiText(
    normalized.text,
    (text, start, end, kind) => createToken(normalized, start, end, kind)
  );
}

function tokenizeAsciiText(
  text: string,
  create: (
    text: string,
    start: number,
    end: number,
    kind: StrictTokenKind
  ) => StrictToken
): StrictToken[] {
  const tokens: StrictToken[] = [];

  for (let index = 0; index < text.length;) {
    const code = text.charCodeAt(index);
    if (isAsciiWhitespace(code)) {
      index += 1;
      continue;
    }

    if (isAsciiWordScalar(code)) {
      const kind: StrictTokenKind = isAsciiNumber(code) ? "number" : "word";
      let end = index + 1;
      while (end < text.length && isAsciiWordScalar(text.charCodeAt(end))) {
        end += 1;
      }
      tokens.push(create(text, index, end, kind));
      index = end;
      continue;
    }

    const operatorLength = matchAsciiOperatorLength(text, index);
    if (operatorLength > 0) {
      tokens.push(create(text, index, index + operatorLength, "operator"));
      index += operatorLength;
      continue;
    }

    tokens.push(create(text, index, index + 1, "punctuation"));
    index += 1;
  }

  return tokens;
}

function createIdentityToken(
  text: string,
  start: number,
  end: number,
  kind: StrictTokenKind
): StrictToken {
  return {
    value: text.slice(start, end),
    kind,
    normalizedStart: start,
    normalizedEnd: end,
    rawByteStart: start,
    rawByteEnd: end
  };
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

function isAsciiNumber(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isAsciiWordScalar(code: number): boolean {
  return isAsciiNumber(code)
    || (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || code === 0x5f
    || code === 0x24;
}

function matchAsciiOperatorLength(text: string, start: number): number {
  const value = text[start]!;
  const operators = OPERATORS_BY_FIRST.get(value);
  if (operators) {
    for (const operator of operators) {
      if (text.startsWith(operator, start)) {
        return operator.length;
      }
    }
  }
  return OPERATOR_SCALARS.has(value) ? 1 : 0;
}

function groupOperatorsByFirstScalar(): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const operator of MULTI_CHARACTER_OPERATORS) {
    const first = operator[0]!;
    const operators = grouped.get(first);
    if (operators) {
      operators.push(operator);
    } else {
      grouped.set(first, [operator]);
    }
  }
  return grouped;
}

function matchOperatorLength(units: NormalizedUnit[], start: number): number {
  if (!OPERATOR_SCALARS.has(units[start]!.value) && units[start]!.value !== ".") {
    return 0;
  }
  for (const operator of MULTI_CHARACTER_OPERATORS) {
    const scalars = Array.from(operator);
    if (scalars.every((value, offset) => units[start + offset]?.value === value)) {
      return scalars.length;
    }
  }
  return OPERATOR_SCALARS.has(units[start]!.value) ? 1 : 0;
}

function createToken(
  normalized: NormalizedText,
  start: number,
  end: number,
  kind: StrictTokenKind
): StrictToken {
  const first = normalized.units[start]!;
  const last = normalized.units[end - 1]!;
  return {
    value: normalized.text.slice(first.normalizedStart, last.normalizedEnd),
    kind,
    normalizedStart: first.normalizedStart,
    normalizedEnd: last.normalizedEnd,
    rawByteStart: first.rawByteStart,
    rawByteEnd: last.rawByteEnd
  };
}
