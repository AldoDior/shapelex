import assert from "node:assert/strict";
import test from "node:test";
import { runAgentAdoptionEval } from "../src/shapelex-agent-adoption-eval.js";

test("agent adoption simulation chooses ShapeLex without manual user invocation", async () => {
  const report = await runAgentAdoptionEval();

  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.agentDrivenContract, true);
  assert.equal(report.summary.shapeLexExpected, 5);
  assert.equal(report.summary.shapeLexChosen, 5);
  assert.equal(report.summary.suggestionsPassed, true);
  assert.ok(report.summary.averageEstimatedSavingsRatio > 0.2);
  assert.ok(report.decisions.some((decision) => decision.decision.usesShapeLex === false));
  assert.ok(report.decisions.some((decision) => decision.decision.suggestions.includes("full")));
  assert.ok(report.decisions.some((decision) => decision.decision.suggestions.includes("session-switch")));
  assert.ok(report.decisions.some((decision) => decision.decision.suggestions.includes("cleanup-preview")));
  assert.ok(report.decisions
    .filter((decision) => decision.expectedUsesShapeLex)
    .every((decision) => decision.decision.userNotice));
});
