import { tokenizeStrict } from "./tokenize.js";
import type {
  CriticalDifference,
  CriticalElement,
  StrictToken
} from "./types.js";

const NEGATIONS = new Set([
  "no", "not", "never", "without", "cannot", "dont",
  "neither", "nor", "nunca", "jamás", "jamas", "sin", "tampoco", "ni"
]);
const BOOLEANS_AND_NULL = new Set([
  "true", "false", "null", "undefined", "verdadero", "falso", "nulo"
]);
const DESTRUCTIVE = new Set([
  "delete", "remove", "drop", "reset", "destroy", "erase", "purge", "truncate",
  "overwrite", "revoke", "deny", "block", "borrar", "eliminar", "destruir",
  "reiniciar", "purgar", "truncar", "sobrescribir", "revocar", "rechazar",
  "bloquear", "borra", "borre", "borrad", "elimina", "elimine", "eliminad",
  "destruye", "destruya", "reinicia", "reinicie", "purga", "purgue", "trunca",
  "trunque", "sobrescribe", "sobrescriba", "revoca", "revoque", "rechaza",
  "rechace", "bloquea", "bloquee"
]);
const IMPERATIVE = new Set([
  "must", "should", "shall", "required", "only", "always", "avoid", "allow",
  "approve", "commit", "push", "merge", "deploy", "execute", "run", "write",
  "debe", "debes", "deberá", "debera", "solo", "solamente", "siempre",
  "evita", "evitar", "permite", "permitir", "aprobar", "guardar", "ejecutar",
  "haz", "haga", "hagan", "permita", "aprueba", "apruebe", "guarda", "guarde",
  "ejecuta", "ejecute", "escribe", "escriba"
]);
const CRITICAL_OPERATORS = new Set([
  "=", "==", "===", "!=", "!==", "<", "<=", ">", ">=", "&&", "||", "!",
  "+", "-", "*", "/", "%", "+=", "-=", "*=", "/=", "??", "=>", ":=", "&",
  "|", "^", "~", "++", "--", "<<", ">>", ">>>", "**", "**=", "%=", "&=", "|=",
  "^=", "<<=", ">>=", ">>>=", "??=", "&&=", "||="
]);
const DATE_PATTERN = /^\d{1,4}[-/]\d{1,2}(?:[-/]\d{1,4})?$/u;
const TIME_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/u;
const NUMBER_PATTERN = /^\p{N}+$/u;

export function extractCriticalElements(input: string): CriticalElement[] {
  const tokens = tokenizeStrict(input);
  const elements: CriticalElement[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const contraction = collectNegativeContraction(tokens, index);
    if (contraction) {
      elements.push({ category: "negation", value: contraction.value });
      index = contraction.endIndex;
      continue;
    }

    const dateTime = collectDateTime(tokens, index);
    if (dateTime) {
      elements.push({ category: "date-time", value: dateTime.value });
      index = dateTime.endIndex;
      continue;
    }

    const token = tokens[index]!;
    const lower = token.value.toLowerCase();
    if (NEGATIONS.has(lower)) {
      elements.push({ category: "negation", value: lower });
    } else if (BOOLEANS_AND_NULL.has(lower)) {
      elements.push({ category: "boolean-null", value: lower });
    } else if (DESTRUCTIVE.has(lower)) {
      elements.push({ category: "destructive", value: lower });
    } else if (IMPERATIVE.has(lower)) {
      elements.push({ category: "imperative", value: lower });
    } else if (NUMBER_PATTERN.test(token.value)) {
      elements.push({ category: "number", value: token.value });
    } else if (CRITICAL_OPERATORS.has(token.value)) {
      elements.push({ category: "operator", value: token.value });
    }
  }

  return elements;
}

function collectNegativeContraction(
  tokens: readonly StrictToken[],
  start: number
): { value: string; endIndex: number } | undefined {
  const word = tokens[start]!;
  const apostrophe = tokens[start + 1];
  const suffix = tokens[start + 2];
  if (
    word.kind !== "word"
    || word.value.length < 3
    || !word.value.toLowerCase().endsWith("n")
    || (apostrophe?.value !== "'" && apostrophe?.value !== "\u2019")
    || suffix?.value.toLowerCase() !== "t"
    || word.normalizedEnd !== apostrophe.normalizedStart
    || apostrophe.normalizedEnd !== suffix.normalizedStart
  ) {
    return undefined;
  }
  return {
    value: `${word.value.toLowerCase()}'t`,
    endIndex: start + 2
  };
}

export function detectCriticalDifference(query: string, candidate: string): CriticalDifference {
  const queryElements = extractCriticalElements(query);
  const candidateElements = extractCriticalElements(candidate);
  const queryCounts = countElements(queryElements);
  const candidateCounts = countElements(candidateElements);

  return {
    different: !sameElements(queryElements, candidateElements),
    query: queryElements,
    candidate: candidateElements,
    added: subtractElements(candidateCounts, queryCounts),
    removed: subtractElements(queryCounts, candidateCounts)
  };
}

function collectDateTime(
  tokens: readonly StrictToken[],
  start: number
): { value: string; endIndex: number } | undefined {
  for (const width of [5, 3]) {
    const selected = tokens.slice(start, start + width);
    const value = selected.map((token) => token.value).join("");
    if (DATE_PATTERN.test(value) || TIME_PATTERN.test(value)) {
      const previous = tokens[start - 1];
      const last = selected[selected.length - 1]!;
      const next = tokens[start + width];
      if (
        (
          previous
          && previous.normalizedEnd === selected[0]!.normalizedStart
          && isDateTimeSeparator(previous.value)
        )
        || (
          next
          && last.normalizedEnd === next.normalizedStart
          && isDateTimeSeparator(next.value)
        )
      ) {
        continue;
      }
      return { value, endIndex: start + selected.length - 1 };
    }
  }
  return undefined;
}

function isDateTimeSeparator(value: string): boolean {
  return value === "-" || value === "/" || value === ":";
}

function sameElements(left: readonly CriticalElement[], right: readonly CriticalElement[]): boolean {
  return (
    left.length === right.length
    && left.every((item, index) => elementKey(item) === elementKey(right[index]!))
  );
}

function countElements(elements: readonly CriticalElement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const element of elements) {
    const key = elementKey(element);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function subtractElements(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>
): CriticalElement[] {
  const result: CriticalElement[] = [];
  for (const [key, count] of left) {
    const difference = count - (right.get(key) ?? 0);
    for (let index = 0; index < difference; index += 1) {
      const separator = key.indexOf("\0");
      result.push({
        category: key.slice(0, separator) as CriticalElement["category"],
        value: key.slice(separator + 1)
      });
    }
  }
  return result;
}

function elementKey(element: CriticalElement): string {
  return `${element.category}\0${element.value}`;
}
