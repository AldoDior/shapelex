export {
  extractCriticalElements,
  detectCriticalDifference
} from "./critical-diff.js";
export { sha256Hex, verifyExactBytes } from "./exact.js";
export {
  hashString64,
  hashToHex,
  referenceNgramHash,
  rollingNgrams,
  type HashableUnit
} from "./hash.js";
export {
  classifyFingerprintDocuments,
  classifyFingerprintMatch,
  DEFAULT_MATCH_THRESHOLDS,
  isKeywordFallback,
  scoreFingerprintMatch
} from "./matcher.js";
export {
  DEFAULT_INDEX_LIMITS,
  LazyFingerprintIndex,
  type FingerprintIndexLimits,
  type FingerprintIndexMatch,
  type FingerprintIndexStats,
  type FingerprintMatchAlignment,
  type FingerprintMatchWindow,
  type FingerprintRegistration,
  type FingerprintSearchDiagnostics,
  type FingerprintSearchResult,
  type FingerprintText,
  type FingerprintTextProvider
} from "./lazy-index.js";
export { normalizeRecall, normalizeStrict } from "./normalize.js";
export {
  buildBoundedFingerprintDocument,
  buildFingerprintDocument,
  type BoundedFingerprintDocument
} from "./profile.js";
export { tokenizeStrict } from "./tokenize.js";
export {
  LEXICAL_PROFILE,
  type CriticalDifference,
  type CriticalElement,
  type Fingerprint,
  type FingerprintChannel,
  type FingerprintDocument,
  type HashedNgram,
  type MatchKind,
  type MatchMetrics,
  type MatchResult,
  type MatchThresholds,
  type NormalizedText,
  type NormalizedUnit,
  type SourceRange,
  type StrictToken,
  type StrictTokenKind
} from "./types.js";
export {
  winnow,
  winnowRollingNgrams,
  winnowRollingNgramsBounded,
  type BoundedWinnowResult
} from "./winnow.js";
