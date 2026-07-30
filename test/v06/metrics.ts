import type { AcceptancePair, ExpectedMatchKind } from "./corpus.js";

export interface PairPrediction {
  id: string;
  actual: ExpectedMatchKind | "keyword";
  rank?: number;
}

export interface AccuracyMetrics {
  cases: number;
  exactFalsePositives: number;
  exactPrecision: number;
  exactRecall: number;
  strongRelatedPrecision: number;
  recallAt5: number;
  unrelatedStrongPromotionRate: number;
  criticalSafetyRate: number;
}

export interface TokenLedgerEntry {
  id: string;
  rawPromptTokens: number;
  toolSchemaTokens: number;
  requestTokens: number;
  responseTokens: number;
  expansionTokens: number;
  requiredFacts: readonly string[];
  recoveredFacts: readonly string[];
}

export interface TokenLedgerSummary {
  cases: number;
  aggregateReduction: number;
  medianReduction: number;
  requiredFactFidelity: number;
  regressions: string[];
  rawTokens: number;
  shapeLexTokens: number;
}

export interface RetrievalRun {
  queryId: string;
  relevantIds: readonly string[];
  rankedIds: readonly string[];
}

function safeRatio(numerator: number, denominator: number, emptyValue = 1): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(clampScore(percentileValue) * sorted.length) - 1;
  return sorted[Math.max(0, rank)]!;
}

export function evaluateAccuracy(
  corpus: readonly AcceptancePair[],
  predictions: readonly PairPrediction[]
): AccuracyMetrics {
  const predictedById = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  if (predictedById.size !== corpus.length) {
    throw new Error(`Expected ${corpus.length} unique predictions, received ${predictedById.size}.`);
  }

  let expectedExact = 0;
  let predictedExact = 0;
  let trueExact = 0;
  let exactFalsePositives = 0;
  let predictedStrong = 0;
  let trueStrong = 0;
  let eligibleRecall = 0;
  let retrievedAt5 = 0;
  let unrelated = 0;
  let unrelatedPromoted = 0;
  let critical = 0;
  let criticalSafe = 0;

  for (const item of corpus) {
    const prediction = predictedById.get(item.id);
    if (!prediction) {
      throw new Error(`Missing prediction for ${item.id}.`);
    }

    if (item.expected === "exact") {
      expectedExact += 1;
    }
    if (prediction.actual === "exact") {
      predictedExact += 1;
      if (item.expected === "exact") {
        trueExact += 1;
      } else {
        exactFalsePositives += 1;
      }
    }
    if (prediction.actual === "strong_related") {
      predictedStrong += 1;
      if (item.expected === "strong_related" || item.expected === "related_reordered") {
        trueStrong += 1;
      }
    }
    if (item.expected === "exact" || item.expected === "strong_related") {
      eligibleRecall += 1;
      if ((prediction.rank ?? Number.POSITIVE_INFINITY) <= 5) {
        retrievedAt5 += 1;
      }
    }
    if (item.expected === "unrelated") {
      unrelated += 1;
      if (prediction.actual === "strong_related" || prediction.actual === "exact") {
        unrelatedPromoted += 1;
      }
    }
    if (item.criticalDifference) {
      critical += 1;
      if (prediction.actual !== "exact" && prediction.actual !== "strong_related") {
        criticalSafe += 1;
      }
    }
  }

  return {
    cases: corpus.length,
    exactFalsePositives,
    exactPrecision: safeRatio(trueExact, predictedExact),
    exactRecall: safeRatio(trueExact, expectedExact),
    strongRelatedPrecision: safeRatio(trueStrong, predictedStrong),
    recallAt5: safeRatio(retrievedAt5, eligibleRecall),
    unrelatedStrongPromotionRate: safeRatio(unrelatedPromoted, unrelated, 0),
    criticalSafetyRate: safeRatio(criticalSafe, critical)
  };
}

export function summarizeTokenLedger(entries: readonly TokenLedgerEntry[]): TokenLedgerSummary {
  const reductions: number[] = [];
  const regressions: string[] = [];
  let rawTokens = 0;
  let shapeLexTokens = 0;
  let requiredFacts = 0;
  let recoveredFacts = 0;

  for (const entry of entries) {
    const total = entry.toolSchemaTokens
      + entry.requestTokens
      + entry.responseTokens
      + entry.expansionTokens;
    rawTokens += entry.rawPromptTokens;
    shapeLexTokens += total;
    reductions.push(safeRatio(entry.rawPromptTokens - total, entry.rawPromptTokens, 0));
    if (total > entry.rawPromptTokens) {
      regressions.push(entry.id);
    }

    const recovered = new Set(entry.recoveredFacts);
    requiredFacts += entry.requiredFacts.length;
    recoveredFacts += entry.requiredFacts.filter((fact) => recovered.has(fact)).length;
  }

  return {
    cases: entries.length,
    aggregateReduction: safeRatio(rawTokens - shapeLexTokens, rawTokens, 0),
    medianReduction: percentile(reductions, 0.5),
    requiredFactFidelity: safeRatio(recoveredFacts, requiredFacts),
    regressions,
    rawTokens,
    shapeLexTokens
  };
}

export function recallAtK(runs: readonly RetrievalRun[], k: number): number {
  if (!Number.isSafeInteger(k) || k < 1) {
    throw new RangeError("k must be a positive safe integer.");
  }
  let recovered = 0;
  for (const run of runs) {
    const relevant = new Set(run.relevantIds);
    if (run.rankedIds.slice(0, k).some((id) => relevant.has(id))) {
      recovered += 1;
    }
  }
  return safeRatio(recovered, runs.length);
}

export function assertFiniteUnitScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number in [0, 1], received ${value}.`);
  }
}
