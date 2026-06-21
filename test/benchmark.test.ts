import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/shapelex-benchmark.js";

test("benchmark reports measurable token reduction and fact recovery", () => {
  const report = runBenchmark();

  assert.equal(report.summary.cases, 3);
  assert.ok(report.summary.averageV2FactRecall >= report.summary.averageLegacyLikeFactRecall);
  assert.ok(report.summary.averageCompressLatencyMs >= 0);
  assert.ok(report.results.every((item) => item.shapeLexV2.shouldExpand));
  assert.ok(report.results.some((item) => item.shapeLexV2.tokenReductionRatio > 1));
});
