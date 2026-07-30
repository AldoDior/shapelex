import { sha256Hex } from "./exact.js";
import { hashToHex, type HashableUnit } from "./hash.js";
import {
  normalizeCanonicalAsciiRecallText,
  normalizeRecall,
  normalizeStrict
} from "./normalize.js";
import { tokenizeStrict } from "./tokenize.js";
import {
  LEXICAL_PROFILE,
  type Fingerprint,
  type FingerprintChannel,
  type FingerprintDocument,
  type HashedNgram
} from "./types.js";
import {
  winnowRollingNgrams,
  winnowRollingNgramsBounded,
  winnowIdentityAsciiTextBounded,
  winnowMappedAsciiTextBounded,
  type BoundedWinnowResult
} from "./winnow.js";

export interface BoundedFingerprintDocument {
  document: FingerprintDocument;
  complete: boolean;
}

export function buildFingerprintDocument(input: string | Uint8Array): FingerprintDocument {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const text = typeof input === "string" ? bytes.toString("utf8") : decodeUtf8(bytes);
  return buildDocument(bytes, text);
}

/**
 * Builds the same lexical-v1 document while retaining at most `limit`
 * fingerprints across both channels. The split matches the index's existing
 * deterministic token-first balancing policy.
 */
export function buildBoundedFingerprintDocument(
  input: string | Uint8Array,
  limit: number
): BoundedFingerprintDocument {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("fingerprint limit must be a non-negative safe integer");
  }
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const text = typeof input === "string" ? bytes.toString("utf8") : decodeUtf8(bytes);
  return buildDocumentBounded(bytes, text, limit);
}

function buildDocument(bytes: Buffer, text: string): FingerprintDocument {
  const identityRecallText = canonicalAsciiIdentityRecallText(text);
  if (identityRecallText !== undefined) {
    const tokens = tokenizeStrict(text);
    return createDocument(
      bytes,
      text,
      tokens,
      identityRecallText,
      winnowRollingNgrams(
        tokens,
        LEXICAL_PROFILE.tokenNgramSize,
        LEXICAL_PROFILE.tokenWindowSize
      ),
      winnowIdentityAsciiTextBounded(
        identityRecallText,
        LEXICAL_PROFILE.characterNgramSize,
        LEXICAL_PROFILE.characterWindowSize,
        Number.MAX_SAFE_INTEGER
      ).ngrams
    );
  }

  const strict = normalizeStrict(text);
  const canonicalRecallText = normalizeCanonicalAsciiRecallText(strict);
  const recall = canonicalRecallText === undefined ? normalizeRecall(strict) : undefined;
  const tokens = tokenizeStrict(strict);
  const characterNgrams = canonicalRecallText === undefined
    ? winnowRollingNgrams(
      recall!.units as readonly HashableUnit[],
      LEXICAL_PROFILE.characterNgramSize,
      LEXICAL_PROFILE.characterWindowSize
    )
    : winnowMappedAsciiTextBounded(
      canonicalRecallText,
      strict.units,
      LEXICAL_PROFILE.characterNgramSize,
      LEXICAL_PROFILE.characterWindowSize,
      Number.MAX_SAFE_INTEGER
    ).ngrams;

  return {
    profile: LEXICAL_PROFILE.id,
    rawByteLength: bytes.length,
    sha256: sha256Hex(bytes),
    strictText: strict.text,
    strictTokenValues: tokens.map((token) => token.value),
    tokens,
    recallText: canonicalRecallText ?? recall!.text,
    tokenFingerprints: toFingerprints(
      winnowRollingNgrams(
        tokens,
        LEXICAL_PROFILE.tokenNgramSize,
        LEXICAL_PROFILE.tokenWindowSize
      ),
      "token"
    ),
    characterFingerprints: toFingerprints(
      characterNgrams,
      "character"
    )
  };
}

function buildDocumentBounded(
  bytes: Buffer,
  text: string,
  limit: number
): BoundedFingerprintDocument {
  const identityRecallText = canonicalAsciiIdentityRecallText(text);
  if (identityRecallText !== undefined) {
    return buildPreparedDocumentBounded(
      bytes,
      text,
      tokenizeStrict(text),
      identityRecallText,
      limit,
      (budget) => winnowIdentityAsciiTextBounded(
        identityRecallText,
        LEXICAL_PROFILE.characterNgramSize,
        LEXICAL_PROFILE.characterWindowSize,
        budget
      )
    );
  }

  const strict = normalizeStrict(text);
  const canonicalRecallText = normalizeCanonicalAsciiRecallText(strict);
  const recall = canonicalRecallText === undefined ? normalizeRecall(strict) : undefined;
  const tokens = tokenizeStrict(strict);
  return buildPreparedDocumentBounded(
    bytes,
    strict.text,
    tokens,
    canonicalRecallText ?? recall!.text,
    limit,
    (budget) => canonicalRecallText === undefined
      ? boundedNgrams(
        recall!.units as readonly HashableUnit[],
        LEXICAL_PROFILE.characterNgramSize,
        LEXICAL_PROFILE.characterWindowSize,
        budget
      )
      : winnowMappedAsciiTextBounded(
        canonicalRecallText,
        strict.units,
        LEXICAL_PROFILE.characterNgramSize,
        LEXICAL_PROFILE.characterWindowSize,
        budget
      )
  );
}

function buildPreparedDocumentBounded(
  bytes: Buffer,
  strictText: string,
  tokens: FingerprintDocument["tokens"],
  recallText: string,
  limit: number,
  buildCharacterNgrams: (budget: number) => BoundedWinnowResult
): BoundedFingerprintDocument {
  const initialTokenBudget = Math.ceil(limit / 2);
  let tokenNgrams = boundedNgrams(
    tokens,
    LEXICAL_PROFILE.tokenNgramSize,
    LEXICAL_PROFILE.tokenWindowSize,
    initialTokenBudget
  );
  const characterBudget = tokenNgrams.complete
    ? limit - tokenNgrams.ngrams.length
    : Math.floor(limit / 2);
  const characterNgrams = buildCharacterNgrams(characterBudget);

  if (
    !tokenNgrams.complete
    && characterNgrams.complete
    && characterNgrams.ngrams.length < characterBudget
  ) {
    tokenNgrams = boundedNgrams(
      tokens,
      LEXICAL_PROFILE.tokenNgramSize,
      LEXICAL_PROFILE.tokenWindowSize,
      limit - characterNgrams.ngrams.length
    );
  }

  return {
    document: createDocument(
      bytes,
      strictText,
      tokens,
      recallText,
      tokenNgrams.ngrams,
      characterNgrams.ngrams
    ),
    complete: tokenNgrams.complete && characterNgrams.complete
  };
}

function canonicalAsciiIdentityRecallText(text: string): string | undefined {
  if (
    !/^[\x00-\x0c\x0e-\x7f]*$/.test(text)
    || /^\s|\s$|\s{2,}/.test(text)
  ) {
    return undefined;
  }
  return text.replace(/\s/g, " ").toLowerCase();
}

function boundedNgrams(
  units: readonly HashableUnit[],
  ngramSize: number,
  windowSize: number,
  limit: number
): BoundedWinnowResult {
  return winnowRollingNgramsBounded(units, ngramSize, windowSize, limit);
}

function createDocument(
  bytes: Buffer,
  strictText: string,
  tokens: FingerprintDocument["tokens"],
  recallText: string,
  tokenNgrams: readonly HashedNgram[],
  characterNgrams: readonly HashedNgram[]
): FingerprintDocument {
  return {
    profile: LEXICAL_PROFILE.id,
    rawByteLength: bytes.length,
    sha256: sha256Hex(bytes),
    strictText,
    strictTokenValues: tokens.map((token) => token.value),
    tokens,
    recallText,
    tokenFingerprints: toFingerprints(tokenNgrams, "token"),
    characterFingerprints: toFingerprints(characterNgrams, "character")
  };
}

function toFingerprints(
  ngrams: readonly HashedNgram[],
  channel: FingerprintChannel
): Fingerprint[] {
  return ngrams.map((ngram) => ({
    profile: LEXICAL_PROFILE.id,
    channel,
    hash: hashToHex(ngram.hash),
    position: ngram.position,
    endPosition: ngram.endPosition,
    rawByteStart: ngram.rawByteStart,
    rawByteEnd: ngram.rawByteEnd
  }));
}

function decodeUtf8(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new TypeError("fingerprint input must be valid UTF-8");
  }
  return text;
}
