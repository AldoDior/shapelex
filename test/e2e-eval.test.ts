import assert from "node:assert/strict";
import test from "node:test";
import { runE2EEval } from "../src/shapelex-e2e-eval.js";

test("e2e eval preserves generated-code quality while reducing prompt tokens", async () => {
  const report = await runE2EEval();

  assert.equal(report.summary.passed, true);
  assert.ok(report.summary.totalShapeLexPromptTokens < report.summary.totalRawPromptTokens);
  assert.equal(report.summary.averageShapeLexQuality, report.summary.averageRawQuality);
  assert.ok(report.results.every((result) => result.shapeLex.factCoverage.coverage === 1));
});
