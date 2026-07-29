import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../src/shapelex-benchmark.js";

test("benchmark protocol ledger reports net token reduction and fact recovery", async () => {
  const report = await runBenchmark();

  assert.equal(report.summary.cases, 12);
  assert.ok(report.summary.aggregateReduction >= 0.25);
  assert.ok(report.summary.medianReduction >= 0.25);
  assert.ok(report.summary.requiredFactFidelity >= 0.98);
  assert.deepEqual(report.summary.regressions, []);
  assert.equal(report.entries.length, 12);
});
