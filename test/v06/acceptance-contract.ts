import assert from "node:assert/strict";
import test from "node:test";
import { createAcceptanceCorpus, type AcceptancePair, type ExpectedMatchKind } from "./corpus.js";
import { assertFiniteUnitScore, evaluateAccuracy, type PairPrediction } from "./metrics.js";

export interface AcceptanceMatch {
  matchKind: ExpectedMatchKind | "keyword";
  score: number;
  exact: boolean;
  mustExpand: boolean;
  criticalDiff: boolean;
}

export interface FingerprintAcceptanceAdapter {
  classify(source: string, candidate: string): Promise<AcceptanceMatch> | AcceptanceMatch;
}

/**
 * Integration owns the adapter. Keeping this contract separate lets the corpus
 * and quality gates remain stable while internal fingerprint modules evolve.
 */
export function registerFingerprintAcceptanceScenarios(
  adapter: FingerprintAcceptanceAdapter
): void {
  const corpus = createAcceptanceCorpus();

  test("Given byte-identical text, when it is matched, then only verified bytes are exact", async () => {
    const exactCases = corpus.filter((item) => item.expected === "exact");
    for (const item of exactCases) {
      const result = await adapter.classify(item.source, item.candidate);
      assert.equal(result.matchKind, "exact", item.id);
      assert.equal(result.exact, true, item.id);
      assertFiniteUnitScore(`${item.id}.score`, result.score);
    }
  });

  test("Given a protected-token mutation, when it is matched, then it cannot be safely reused", async () => {
    const criticalCases = corpus.filter((item) => item.criticalDifference);
    for (const item of criticalCases) {
      const result = await adapter.classify(item.source, item.candidate);
      assert.notEqual(result.matchKind, "exact", item.id);
      assert.notEqual(result.matchKind, "strong_related", item.id);
      assert.equal(result.exact, false, item.id);
      assert.equal(result.mustExpand, true, item.id);
      assert.equal(result.criticalDiff, true, item.id);
    }
  });

  test("Given the labeled acceptance corpus, when all pairs are evaluated, then release accuracy gates pass", async () => {
    const predictions: PairPrediction[] = [];

    for (const item of corpus) {
      const result = await adapter.classify(item.source, item.candidate);
      assertFiniteUnitScore(`${item.id}.score`, result.score);
      predictions.push({
        id: item.id,
        actual: result.matchKind
      });
    }

    assertReleaseAccuracy(evaluateAccuracy(corpus, predictions));
  });
}

function assertReleaseAccuracy(metrics: ReturnType<typeof evaluateAccuracy>): void {
  assert.equal(metrics.cases >= 300, true);
  assert.equal(metrics.exactFalsePositives, 0);
  assert.equal(metrics.exactPrecision, 1);
  assert.equal(metrics.exactRecall, 1);
  assert.equal(metrics.criticalSafetyRate, 1);
  assert.ok(metrics.strongRelatedPrecision >= 0.98);
  assert.ok(metrics.unrelatedStrongPromotionRate < 0.01);
}

export function findCorpusCase(
  corpus: readonly AcceptancePair[],
  id: string
): AcceptancePair {
  const found = corpus.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown acceptance case: ${id}`);
  }
  return found;
}
