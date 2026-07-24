import assert from "node:assert/strict";
import test from "node:test";
import { runSmokeEval } from "../src/shapelex-smoke-eval.js";

test("smoke eval preserves coding decision while reducing prompt tokens", async () => {
  const report = await runSmokeEval();

  assert.equal(report.comparison.sameDecision, true);
  assert.equal(report.shapeLex.factCoverage.coverage, 1);
  assert.ok(report.shapeLex.tokenEstimate < report.raw.tokenEstimate);
  assert.equal(report.comparison.passed, true);
});
