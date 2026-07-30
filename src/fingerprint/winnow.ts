import {
  hashString64,
  MASK_64,
  ROLLING_BASE_64,
  type HashableUnit
} from "./hash.js";
import type { HashedNgram } from "./types.js";

interface HashPair {
  high: number;
  low: number;
}

interface RollingUnitSource {
  length: number;
  valueAt(index: number): string;
  rawByteStartAt(index: number): number;
  rawByteEndAt(index: number): number;
}

const ASCII_UNIT_HASH_HIGH = new Uint32Array(128);
const ASCII_UNIT_HASH_LOW = new Uint32Array(128);
const ASCII_UNIT_HASH_PRESENT = new Uint8Array(128);
const ROLLING_BASE_PAIR = bigintToPair(ROLLING_BASE_64);

/**
 * Selects the rightmost minimum from every window in O(n). Repeated selection
 * of the same n-gram is emitted once.
 */
export function winnow(ngrams: readonly HashedNgram[], windowSize: number): HashedNgram[] {
  if (!Number.isSafeInteger(windowSize) || windowSize <= 0) {
    throw new RangeError("window size must be a positive safe integer");
  }
  if (ngrams.length === 0) {
    return [];
  }

  const effectiveWindow = Math.min(windowSize, ngrams.length);
  const deque: number[] = [];
  let dequeStart = 0;
  const selected: HashedNgram[] = [];
  let lastSelected = -1;

  for (let index = 0; index < ngrams.length; index += 1) {
    while (dequeStart < deque.length && deque[dequeStart]! <= index - effectiveWindow) {
      dequeStart += 1;
    }
    while (
      deque.length > dequeStart
      && ngrams[deque[deque.length - 1]!]!.hash >= ngrams[index]!.hash
    ) {
      deque.pop();
    }
    deque.push(index);

    if (index >= effectiveWindow - 1) {
      const minimumIndex = deque[dequeStart]!;
      if (minimumIndex !== lastSelected) {
        selected.push(ngrams[minimumIndex]!);
        lastSelected = minimumIndex;
      }
    }

    if (dequeStart > 1024 && dequeStart * 2 > deque.length) {
      deque.splice(0, dequeStart);
      dequeStart = 0;
    }
  }

  return selected;
}

/**
 * Fuses rolling n-gram construction with winnowing.
 *
 * Production fingerprint construction uses this path so it only retains a
 * ring of unit hashes, a window-sized monotonic deque, and the selected
 * fingerprints. It deliberately produces the same selections as
 * `winnow(rollingNgrams(units, ngramSize), windowSize)`.
 */
export function winnowRollingNgrams(
  units: readonly HashableUnit[],
  ngramSize: number,
  windowSize: number
): HashedNgram[] {
  return winnowRollingNgramsBounded(
    units,
    ngramSize,
    windowSize,
    Number.MAX_SAFE_INTEGER
  ).ngrams;
}

export interface BoundedWinnowResult {
  ngrams: HashedNgram[];
  complete: boolean;
}

/**
 * Applies the same fused scan while retaining at most `maxSelections`.
 * The complete stream is still examined so callers can report truncation
 * accurately without ever materializing the discarded n-grams.
 */
export function winnowRollingNgramsBounded(
  units: readonly HashableUnit[],
  ngramSize: number,
  windowSize: number,
  maxSelections: number
): BoundedWinnowResult {
  return winnowRollingSource(
    {
      length: units.length,
      valueAt: (index) => units[index]!.value,
      rawByteStartAt: (index) => units[index]!.rawByteStart,
      rawByteEndAt: (index) => units[index]!.rawByteEnd
    },
    ngramSize,
    windowSize,
    maxSelections
  );
}

/**
 * Fingerprints one-code-unit-per-position text while borrowing byte ranges
 * from an existing mapping. This is used by the canonical ASCII recall path
 * to avoid allocating a second million-object mapping for a 1 MiB document.
 */
export function winnowMappedAsciiTextBounded(
  text: string,
  mappings: readonly HashableUnit[],
  ngramSize: number,
  windowSize: number,
  maxSelections: number
): BoundedWinnowResult {
  if (!/^[\x00-\x7f]*$/.test(text) || text.length !== mappings.length) {
    throw new TypeError("mapped ASCII text must align one-to-one with its mappings");
  }
  return winnowRollingSource(
    {
      length: text.length,
      valueAt: (index) => text[index]!,
      rawByteStartAt: (index) => mappings[index]!.rawByteStart,
      rawByteEndAt: (index) => mappings[index]!.rawByteEnd
    },
    ngramSize,
    windowSize,
    maxSelections
  );
}

/**
 * Fingerprints ASCII text whose normalized positions are identical to its
 * original UTF-8 byte offsets. This avoids constructing one mapping object per
 * character for canonical ASCII documents.
 */
export function winnowIdentityAsciiTextBounded(
  text: string,
  ngramSize: number,
  windowSize: number,
  maxSelections: number
): BoundedWinnowResult {
  if (!/^[\x00-\x7f]*$/.test(text)) {
    throw new TypeError("identity ASCII text must contain only ASCII characters");
  }
  return winnowRollingSource(
    {
      length: text.length,
      valueAt: (index) => text[index]!,
      rawByteStartAt: (index) => index,
      rawByteEndAt: (index) => index + 1
    },
    ngramSize,
    windowSize,
    maxSelections
  );
}

function winnowRollingSource(
  source: RollingUnitSource,
  ngramSize: number,
  windowSize: number,
  maxSelections: number
): BoundedWinnowResult {
  assertPositiveSafeInteger(ngramSize, "ngram size");
  assertPositiveSafeInteger(windowSize, "window size");
  assertNonNegativeSafeInteger(maxSelections, "maximum selections");
  if (source.length < ngramSize) {
    return { ngrams: [], complete: true };
  }

  const ngramCount = source.length - ngramSize + 1;
  const effectiveWindow = Math.min(windowSize, ngramCount);
  const unitHashCache = new Map<string, HashPair>();
  const unitHashRingHigh = new Uint32Array(ngramSize);
  const unitHashRingLow = new Uint32Array(ngramSize);
  let leadingPower: HashPair = { high: 0, low: 1 };
  let rollingHash: HashPair = { high: 0, low: 0 };

  for (let index = 1; index < ngramSize; index += 1) {
    leadingPower = multiply64(leadingPower, ROLLING_BASE_PAIR);
  }
  for (let index = 0; index < ngramSize; index += 1) {
    const unitHash = cachedUnitHash(source.valueAt(index), unitHashCache);
    unitHashRingHigh[index] = unitHash.high;
    unitHashRingLow[index] = unitHash.low;
    rollingHash = add64(multiply64(rollingHash, ROLLING_BASE_PAIR), unitHash);
  }

  const dequePositions = new Array<number>(effectiveWindow);
  const dequeHashHigh = new Uint32Array(effectiveWindow);
  const dequeHashLow = new Uint32Array(effectiveWindow);
  let dequeStart = 0;
  let dequeEnd = 0;
  const selected: HashedNgram[] = [];
  let lastSelected = -1;
  let complete = true;

  for (let position = 0; position < ngramCount; position += 1) {
    if (position > 0) {
      const ringIndex = (position - 1) % ngramSize;
      const outgoing = multiply64(
        {
          high: unitHashRingHigh[ringIndex]!,
          low: unitHashRingLow[ringIndex]!
        },
        leadingPower
      );
      const incoming = cachedUnitHash(
        source.valueAt(position + ngramSize - 1),
        unitHashCache
      );
      unitHashRingHigh[ringIndex] = incoming.high;
      unitHashRingLow[ringIndex] = incoming.low;
      rollingHash = subtract64(rollingHash, outgoing);
      rollingHash = add64(multiply64(rollingHash, ROLLING_BASE_PAIR), incoming);
    }

    while (
      dequeStart < dequeEnd
      && dequePositions[dequeStart % effectiveWindow]! <= position - effectiveWindow
    ) {
      dequeStart += 1;
    }
    while (
      dequeStart < dequeEnd
      && compare64(
        {
          high: dequeHashHigh[(dequeEnd - 1) % effectiveWindow]!,
          low: dequeHashLow[(dequeEnd - 1) % effectiveWindow]!
        },
        rollingHash
      ) >= 0
    ) {
      dequeEnd -= 1;
    }
    dequePositions[dequeEnd % effectiveWindow] = position;
    dequeHashHigh[dequeEnd % effectiveWindow] = rollingHash.high;
    dequeHashLow[dequeEnd % effectiveWindow] = rollingHash.low;
    dequeEnd += 1;

    if (position >= effectiveWindow - 1) {
      const minimumIndex = dequePositions[dequeStart % effectiveWindow]!;
      if (minimumIndex !== lastSelected) {
        if (selected.length < maxSelections) {
          selected.push(createNgram(
            source,
            minimumIndex,
            ngramSize,
            pairToBigint({
              high: dequeHashHigh[dequeStart % effectiveWindow]!,
              low: dequeHashLow[dequeStart % effectiveWindow]!
            })
          ));
        } else {
          complete = false;
        }
        lastSelected = minimumIndex;
      }
    }
  }

  return { ngrams: selected, complete };
}

function cachedUnitHash(value: string, cache: Map<string, HashPair>): HashPair {
  if (value.length === 1) {
    const code = value.charCodeAt(0);
    if (code <= 0x7f) {
      if (ASCII_UNIT_HASH_PRESENT[code] !== 0) {
        return {
          high: ASCII_UNIT_HASH_HIGH[code]!,
          low: ASCII_UNIT_HASH_LOW[code]!
        };
      }
      const asciiHash = bigintToPair(hashString64(value));
      ASCII_UNIT_HASH_HIGH[code] = asciiHash.high;
      ASCII_UNIT_HASH_LOW[code] = asciiHash.low;
      ASCII_UNIT_HASH_PRESENT[code] = 1;
      return asciiHash;
    }
  }
  const cached = cache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const hash = bigintToPair(hashString64(value));
  cache.set(value, hash);
  return hash;
}

function add64(left: HashPair, right: HashPair): HashPair {
  const low = (left.low + right.low) >>> 0;
  const carry = low < left.low ? 1 : 0;
  return {
    high: (left.high + right.high + carry) >>> 0,
    low
  };
}

function subtract64(left: HashPair, right: HashPair): HashPair {
  const low = (left.low - right.low) >>> 0;
  const borrow = left.low < right.low ? 1 : 0;
  return {
    high: (left.high - right.high - borrow) >>> 0,
    low
  };
}

function multiply64(left: HashPair, right: HashPair): HashPair {
  const lowProduct = multiply32(left.low, right.low);
  return {
    high: (
      lowProduct.high
      + Math.imul(left.high, right.low)
      + Math.imul(left.low, right.high)
    ) >>> 0,
    low: lowProduct.low
  };
}

function multiply32(left: number, right: number): HashPair {
  const leftLow = left & 0xffff;
  const leftHigh = left >>> 16;
  const rightLow = right & 0xffff;
  const rightHigh = right >>> 16;
  const lowProduct = leftLow * rightLow;
  const middle = (
    Math.floor(lowProduct / 0x10000)
    + leftHigh * rightLow
    + leftLow * rightHigh
  );

  return {
    high: (leftHigh * rightHigh + Math.floor(middle / 0x10000)) >>> 0,
    low: (((middle & 0xffff) << 16) | (lowProduct & 0xffff)) >>> 0
  };
}

function compare64(left: HashPair, right: HashPair): number {
  if (left.high !== right.high) {
    return left.high < right.high ? -1 : 1;
  }
  if (left.low === right.low) {
    return 0;
  }
  return left.low < right.low ? -1 : 1;
}

function bigintToPair(value: bigint): HashPair {
  const unsigned = value & MASK_64;
  return {
    high: Number((unsigned >> 32n) & 0xffff_ffffn),
    low: Number(unsigned & 0xffff_ffffn)
  };
}

function pairToBigint(value: HashPair): bigint {
  return (BigInt(value.high) << 32n) | BigInt(value.low);
}

function createNgram(
  source: RollingUnitSource,
  position: number,
  size: number,
  hash: bigint
): HashedNgram {
  return {
    hash,
    position,
    endPosition: position + size,
    rawByteStart: source.rawByteStartAt(position),
    rawByteEnd: source.rawByteEndAt(position + size - 1)
  };
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
