import assert from "node:assert/strict";
import test from "node:test";
import { getPropertyProfile, propertyFailureContext } from "./property-profile.js";

test("property profile uses deterministic pull-request defaults", () => {
  const profile = getPropertyProfile({});
  assert.deepEqual(profile, {
    numRuns: 250,
    seed: 20_260_728,
    nightly: false
  });
  assert.equal(propertyFailureContext(profile), "fast-check seed=20260728, numRuns=250");
});

test("property profile enables 10,000-run nightly torture without an explicit run count", () => {
  assert.deepEqual(getPropertyProfile({ SHAPELEX_TORTURE: "1" }), {
    numRuns: 10_000,
    seed: 20_260_728,
    nightly: true
  });
});

test("property profile validates replay settings before a long run starts", () => {
  assert.throws(
    () => getPropertyProfile({ SHAPELEX_PROPERTY_RUNS: "0" }),
    /SHAPELEX_PROPERTY_RUNS/
  );
  assert.throws(
    () => getPropertyProfile({ SHAPELEX_PROPERTY_SEED: "not-an-integer" }),
    /SHAPELEX_PROPERTY_SEED/
  );
  assert.deepEqual(
    getPropertyProfile({
      SHAPELEX_PROPERTY_RUNS: "1000",
      SHAPELEX_PROPERTY_SEED: "42"
    }),
    { numRuns: 1000, seed: 42, nightly: false }
  );
});

