import assert from "node:assert/strict";
import test from "node:test";
import { assertPerformanceBudget } from "./torture-contract.js";

test("performance gates require enough samples and enforce p95 rather than a single run", () => {
  assert.throws(
    () => assertPerformanceBudget("query", Array(29).fill(1), 10),
    /at least 30/
  );
  assert.doesNotThrow(
    () => assertPerformanceBudget("query", Array(30).fill(9), 10)
  );
  assert.throws(
    () => assertPerformanceBudget("query", [...Array(28).fill(1), 11, 12], 10),
    /exceeded/
  );
});

