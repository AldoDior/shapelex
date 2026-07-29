import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  buildFingerprintDocument,
  classifyFingerprintMatch,
  sha256Hex,
  verifyExactBytes
} from "../../src/fingerprint/index.js";
import { getPropertyProfile, propertyFailureContext } from "./property-profile.js";

const profile = getPropertyProfile();
const propertyOptions = {
  numRuns: profile.numRuns,
  seed: profile.seed,
  verbose: true as const
};

test(`fingerprints are deterministic (${propertyFailureContext(profile)})`, () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 2_000 }), (value) => {
      const first = buildFingerprintDocument(value);
      const second = buildFingerprintDocument(value);
      assert.deepEqual(first, second);
      assert.equal(first.sha256, sha256Hex(value));
    }),
    propertyOptions
  );
});

test(`fingerprint documents serialize without losing fixed-width hashes (${propertyFailureContext(profile)})`, () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 2_000 }), (value) => {
      const document = buildFingerprintDocument(value);
      const serialized = JSON.stringify(document);
      const restored = JSON.parse(serialized) as typeof document;
      assert.deepEqual(restored, document);
      for (const fingerprint of [
        ...restored.tokenFingerprints,
        ...restored.characterFingerprints
      ]) {
        assert.match(fingerprint.hash, /^[a-f0-9]{16}$/u);
      }
    }),
    propertyOptions
  );
});

test(`a long shared token region survives prefix insertion (${propertyFailureContext(profile)})`, () => {
  const safeWord = fc.stringMatching(/^[a-z]{3,12}$/u);
  fc.assert(
    fc.property(
      fc.uniqueArray(safeWord, { minLength: 30, maxLength: 80 }),
      fc.uniqueArray(safeWord, { minLength: 12, maxLength: 20 }),
      (sharedWords, prefixWords) => {
        const shared = sharedWords.join(" ");
        const prefixed = `${prefixWords.join(" ")} ${shared}`;
        const original = buildFingerprintDocument(shared);
        const moved = buildFingerprintDocument(prefixed);
        const movedHashes = new Set(moved.tokenFingerprints.map((item) => item.hash));
        assert.ok(
          original.tokenFingerprints.some((item) => movedHashes.has(item.hash)),
          "the winnowing guarantee should preserve an anchor in a sufficiently long shared region"
        );
      }
    ),
    propertyOptions
  );
});

test(`protected negation and operator changes are never exact or strong-related (${propertyFailureContext(profile)})`, () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (limit) => {
      const source = [
        `Delete records only when count >= ${limit}.`,
        "Preserve the audit history and notify the responsible operator.",
        "This instruction is mandatory during every production incident."
      ].join("\n");
      const changed = [
        `Do not delete records when count < ${limit}.`,
        "Preserve the audit history and notify the responsible operator.",
        "This instruction is mandatory during every production incident."
      ].join("\n");
      const result = classifyFingerprintMatch(source, changed);
      assert.notEqual(result.matchKind, "exact");
      assert.notEqual(result.matchKind, "strong_related");
      assert.equal(result.exact, false);
      assert.equal(result.mustExpand, true);
      assert.equal(result.criticalDiff, true);
    }),
    propertyOptions
  );
});

test(`candidate hashes never establish exactness without equal bytes (${propertyFailureContext(profile)})`, () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 1_000 }),
      fc.string({ minLength: 1, maxLength: 1_000 }),
      (left, suffix) => {
        const right = `${left}${suffix}`;
        assert.equal(verifyExactBytes(left, right, sha256Hex(left)), false);
        const result = classifyFingerprintMatch(left, right);
        assert.equal(result.exact, false);
        assert.ok(Number.isFinite(result.score));
        assert.ok(result.score >= 0 && result.score <= 1);
      }
    ),
    propertyOptions
  );
});

