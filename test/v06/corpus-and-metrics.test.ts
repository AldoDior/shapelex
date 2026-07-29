import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptanceCorpusDigest,
  createAcceptanceCorpus,
  type ExpectedMatchKind
} from "./corpus.js";
import {
  assertFiniteUnitScore,
  evaluateAccuracy,
  percentile,
  recallAtK,
  summarizeTokenLedger
} from "./metrics.js";

test("acceptance corpus is deterministic, balanced, and contains at least 300 labeled pairs", () => {
  const corpus = createAcceptanceCorpus();
  const counts = new Map<ExpectedMatchKind, number>();

  for (const item of corpus) {
    counts.set(item.expected, (counts.get(item.expected) ?? 0) + 1);
  }

  assert.equal(corpus.length, 360);
  assert.equal(new Set(corpus.map((item) => item.id)).size, corpus.length);
  assert.deepEqual([...counts.values()], [60, 60, 60, 60, 60, 60]);
  assert.equal(
    acceptanceCorpusDigest(corpus),
    "e7bb0e8a2e31548fe6a5a2c2721fffe23217f495cb740f061803f6fcf30a1530"
  );
});

test("accuracy metrics enforce exactness, critical safety, and retrieval quality separately", () => {
  const corpus = createAcceptanceCorpus();
  const predictions = corpus.map((item) => ({
    id: item.id,
    actual: item.expected,
    rank: item.expected === "exact" || item.expected === "strong_related" ? 1 : undefined
  }));

  const metrics = evaluateAccuracy(corpus, predictions);
  assert.equal(metrics.exactFalsePositives, 0);
  assert.equal(metrics.exactPrecision, 1);
  assert.equal(metrics.exactRecall, 1);
  assert.equal(metrics.strongRelatedPrecision, 1);
  assert.equal(metrics.recallAt5, 1);
  assert.equal(metrics.unrelatedStrongPromotionRate, 0);
  assert.equal(metrics.criticalSafetyRate, 1);
});

test("token ledger includes every protocol cost and identifies regressions", () => {
  const summary = summarizeTokenLedger([
    {
      id: "saving",
      rawPromptTokens: 1_000,
      toolSchemaTokens: 100,
      requestTokens: 50,
      responseTokens: 250,
      expansionTokens: 100,
      requiredFacts: ["date", "limit"],
      recoveredFacts: ["date", "limit"]
    },
    {
      id: "regression",
      rawPromptTokens: 100,
      toolSchemaTokens: 50,
      requestTokens: 30,
      responseTokens: 40,
      expansionTokens: 10,
      requiredFacts: ["operator"],
      recoveredFacts: []
    }
  ]);

  assert.deepEqual(summary.regressions, ["regression"]);
  assert.equal(summary.rawTokens, 1_100);
  assert.equal(summary.shapeLexTokens, 630);
  assert.equal(summary.requiredFactFidelity, 2 / 3);
  assert.equal(summary.aggregateReduction, 470 / 1_100);
  assert.equal(summary.medianReduction, -0.3);
});

test("percentiles and score validation handle boundaries deterministically", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([9, 1, 3, 7, 5], 0.5), 5);
  assert.equal(percentile([9, 1, 3, 7, 5], 0.95), 9);
  assert.doesNotThrow(() => assertFiniteUnitScore("score", 0));
  assert.doesNotThrow(() => assertFiniteUnitScore("score", 1));
  assert.throws(() => assertFiniteUnitScore("score", Number.NaN), /finite number/);
  assert.throws(() => assertFiniteUnitScore("score", 1.01), /finite number/);
});

test("Recall@K is computed from ranked results rather than assigned by labels", () => {
  const runs = [
    { queryId: "q1", relevantIds: ["a"], rankedIds: ["x", "a", "y"] },
    { queryId: "q2", relevantIds: ["b"], rankedIds: ["x", "y", "b"] },
    { queryId: "q3", relevantIds: ["c"], rankedIds: ["c", "x", "y"] }
  ];
  assert.equal(recallAtK(runs, 1), 1 / 3);
  assert.equal(recallAtK(runs, 2), 2 / 3);
  assert.equal(recallAtK(runs, 3), 1);
  assert.throws(() => recallAtK(runs, 0), /positive safe integer/);
});
