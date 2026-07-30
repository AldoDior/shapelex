import assert from "node:assert/strict";
import test from "node:test";
import { percentile } from "./metrics.js";

export interface TortureIndexStats {
  retainedFingerprints: number;
  estimatedIndexBytes: number;
  suppressedHashes: number;
  searchComplete: boolean;
}

export interface TortureAdapter {
  indexText(text: string): Promise<TortureIndexStats>;
  query(text: string): Promise<TortureIndexStats>;
  runMalformedJsonRpc(lines: readonly string[]): Promise<{ errors: number; healthy: boolean }>;
}

/**
 * The lazy-index integration suite supplies this adapter. These scenarios stay
 * out of the default unit suite until that boundary is available.
 */
export function registerTortureScenarios(adapter: TortureAdapter): void {
  test("Given two million characters, indexing stays within hard memory and posting limits", async () => {
    const stats = await adapter.indexText("repeat safe token ".repeat(117_647).slice(0, 2_000_000));
    assert.ok(stats.retainedFingerprints <= 50_000);
    assert.ok(stats.estimatedIndexBytes <= 64 * 1024 * 1024);
    assert.ok(stats.suppressedHashes > 0);
  });

  test("Given a low-entropy query, degraded recall is reported explicitly", async () => {
    const stats = await adapter.query("repeat ".repeat(10_000));
    assert.equal(stats.searchComplete, false);
    assert.ok(stats.suppressedHashes > 0);
  });

  test("Given 10,000 malformed requests, the server rejects all and remains healthy", async () => {
    const malformed = Array.from({ length: 10_000 }, (_, index) => (
      index % 2 === 0 ? "{" : `{"jsonrpc":"2.0","id":${index}}`
    ));
    const result = await adapter.runMalformedJsonRpc(malformed);
    assert.equal(result.errors, malformed.length);
    assert.equal(result.healthy, true);
  });
}

export function assertPerformanceBudget(
  name: string,
  durationsMs: readonly number[],
  maximumP95Ms: number
): void {
  if (durationsMs.length < 30) {
    throw new Error(`${name} requires at least 30 measured runs.`);
  }
  const p95 = percentile(durationsMs, 0.95);
  assert.ok(p95 <= maximumP95Ms, `${name} p95 ${p95}ms exceeded ${maximumP95Ms}ms`);
}

