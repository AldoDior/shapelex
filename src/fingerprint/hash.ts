import type { HashedNgram, SourceRange } from "./types.js";

export const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
export const ROLLING_BASE_64 = 0x9e3779b185ebca87n;

export interface HashableUnit extends SourceRange {
  value: string;
}

/** FNV-1a over UTF-8 bytes, constrained to an unsigned 64-bit value. */
export function hashString64(value: string): bigint {
  if (typeof value !== "string") {
    throw new TypeError("hash input must be a string");
  }
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

export function hashToHex(hash: bigint): string {
  return (hash & MASK_64).toString(16).padStart(16, "0");
}

/**
 * Creates rolling n-gram hashes in O(n). Unit hashes are mixed with a fixed
 * odd base modulo 2^64.
 */
export function rollingNgrams(units: readonly HashableUnit[], size: number): HashedNgram[] {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError("ngram size must be a positive safe integer");
  }
  if (units.length < size) {
    return [];
  }

  const hashCache = new Map<string, bigint>();
  const unitHashes = units.map((unit) => {
    const cached = hashCache.get(unit.value);
    if (cached !== undefined) {
      return cached;
    }
    const hash = hashString64(unit.value);
    hashCache.set(unit.value, hash);
    return hash;
  });
  let leadingPower = 1n;
  for (let index = 1; index < size; index += 1) {
    leadingPower = (leadingPower * ROLLING_BASE_64) & MASK_64;
  }

  let hash = 0n;
  for (let index = 0; index < size; index += 1) {
    hash = ((hash * ROLLING_BASE_64) + unitHashes[index]!) & MASK_64;
  }

  const ngrams: HashedNgram[] = [createNgram(units, 0, size, hash)];
  for (let position = 1; position <= units.length - size; position += 1) {
    const outgoing = (unitHashes[position - 1]! * leadingPower) & MASK_64;
    hash = (hash - outgoing) & MASK_64;
    hash = ((hash * ROLLING_BASE_64) + unitHashes[position + size - 1]!) & MASK_64;
    ngrams.push(createNgram(units, position, size, hash));
  }
  return ngrams;
}

export function referenceNgramHash(values: readonly string[]): bigint {
  let hash = 0n;
  for (const value of values) {
    hash = ((hash * ROLLING_BASE_64) + hashString64(value)) & MASK_64;
  }
  return hash;
}

function createNgram(
  units: readonly HashableUnit[],
  position: number,
  size: number,
  hash: bigint
): HashedNgram {
  const first = units[position]!;
  const last = units[position + size - 1]!;
  return {
    hash,
    position,
    endPosition: position + size,
    rawByteStart: first.rawByteStart,
    rawByteEnd: last.rawByteEnd
  };
}
