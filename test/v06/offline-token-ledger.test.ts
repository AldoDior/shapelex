import assert from "node:assert/strict";
import test from "node:test";
import { runOfflineProtocolEvaluation } from "./offline-token-ledger.js";

test("offline multi-turn protocol ledger passes savings and fidelity release gates", async () => {
  const report = await runOfflineProtocolEvaluation();

  assert.equal(report.entries.length, 12);
  assert.ok(report.methodology.schemaTokensPerTurn > 0);
  assert.ok(report.summary.aggregateReduction >= 0.25);
  assert.ok(report.summary.medianReduction >= 0.25);
  assert.equal(report.summary.requiredFactFidelity, 1);
  assert.deepEqual(report.summary.regressions, []);
});

