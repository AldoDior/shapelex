export const LEXICAL_PROFILE = Object.freeze({
  id: "lexical-v1",
  tokenNgramSize: 5,
  tokenWindowSize: 8,
  characterNgramSize: 4,
  characterWindowSize: 24
} as const);

export type FingerprintChannel = "token" | "character";

export type StrictTokenKind =
  | "word"
  | "number"
  | "operator"
  | "punctuation";

export interface SourceRange {
  normalizedStart: number;
  normalizedEnd: number;
  rawByteStart: number;
  rawByteEnd: number;
}

export interface NormalizedUnit extends SourceRange {
  value: string;
}

export interface NormalizedText {
  text: string;
  units: NormalizedUnit[];
  rawByteLength: number;
}

export interface StrictToken extends SourceRange {
  value: string;
  kind: StrictTokenKind;
}

export interface HashedNgram {
  hash: bigint;
  position: number;
  endPosition: number;
  rawByteStart: number;
  rawByteEnd: number;
}

export interface Fingerprint {
  profile: typeof LEXICAL_PROFILE.id;
  channel: FingerprintChannel;
  hash: string;
  position: number;
  endPosition: number;
  rawByteStart: number;
  rawByteEnd: number;
}

export interface FingerprintDocument {
  profile: typeof LEXICAL_PROFILE.id;
  rawByteLength: number;
  sha256: string;
  strictText: string;
  strictTokenValues: string[];
  tokens: StrictToken[];
  recallText: string;
  tokenFingerprints: Fingerprint[];
  characterFingerprints: Fingerprint[];
}

export type MatchKind =
  | "exact"
  | "normalized_equal"
  | "strong_related"
  | "related_reordered"
  | "related"
  | "keyword"
  | "unrelated";

export interface CriticalElement {
  category:
    | "negation"
    | "number"
    | "date-time"
    | "operator"
    | "boolean-null"
    | "destructive"
    | "imperative";
  value: string;
}

export interface CriticalDifference {
  different: boolean;
  query: CriticalElement[];
  candidate: CriticalElement[];
  added: CriticalElement[];
  removed: CriticalElement[];
}

export interface MatchThresholds {
  strongTokenContainment: number;
  strongCharacterJaccard: number;
  strongAlignmentDominance: number;
  strongMinimumVotes: number;
  relatedTokenContainment: number;
  relatedCharacterJaccard: number;
}

export interface MatchMetrics {
  tokenContainment: number;
  characterJaccard: number;
  alignmentDominance: number;
  usefulVotes: number;
  alignmentPeaks: number;
}

export interface MatchResult {
  matchKind: MatchKind;
  score: number;
  exact: boolean;
  mustExpand: boolean;
  criticalDiff: boolean;
  metrics: MatchMetrics;
  criticalDifference: CriticalDifference;
}

