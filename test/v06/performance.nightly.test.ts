import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  buildBoundedFingerprintDocument,
  scoreFingerprintMatch,
  verifyExactBytes
} from "../../src/fingerprint/index.js";
import { assertPerformanceBudget } from "./torture-contract.js";

const nightly = process.env.SHAPELEX_TEST_PROFILE === "nightly";
const oneMiB = (
  "Alpha record preserves ownership rationale evidence and rollback details. "
).repeat(20_000).slice(0, 1024 * 1024);

test("nightly: 1 MiB lexical fingerprint construction has a bounded p95", {
  skip: !nightly,
  timeout: 60_000
}, () => {
  const bounded = buildBoundedFingerprintDocument(oneMiB, 50_000);
  assert.equal(bounded.complete, false);
  assert.equal(
    bounded.document.tokenFingerprints.length
      + bounded.document.characterFingerprints.length,
    50_000
  );
  const durations = measure(
    30,
    () => buildBoundedFingerprintDocument(oneMiB, 50_000)
  );

  assertPerformanceBudget("1 MiB fingerprint construction", durations, 250);
});

test("nightly: warm fingerprint comparison remains below the query p95 target", {
  skip: !nightly,
  timeout: 60_000
}, () => {
  const query = buildBoundedFingerprintDocument(oneMiB, 4_096).document;
  const candidate = buildBoundedFingerprintDocument(
    `prefix context ${oneMiB}`,
    50_000
  ).document;
  const durations = measure(30, () => scoreFingerprintMatch(query, candidate));

  assertPerformanceBudget("warm fingerprint comparison", durations, 50);
});

test("nightly: 1 MiB byte and SHA verification remains below its p95 target", {
  skip: !nightly,
  timeout: 60_000
}, () => {
  const bytes = Buffer.from(oneMiB);
  const durations = measure(30, () => {
    assert.equal(verifyExactBytes(bytes, bytes), true);
  });

  assertPerformanceBudget("1 MiB exact verification", durations, 20);
});

function measure(iterations: number, operation: () => unknown): number[] {
  operation();
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    durations.push(performance.now() - started);
  }
  return durations;
}
