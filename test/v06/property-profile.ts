import process from "node:process";

export interface PropertyProfile {
  numRuns: number;
  seed: number;
  nightly: boolean;
}

const DEFAULT_PR_RUNS = 250;
const DEFAULT_NIGHTLY_RUNS = 10_000;
const DEFAULT_SEED = 2_026_072_8;
const MAX_RUNS = 100_000;

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function getPropertyProfile(
  environment: NodeJS.ProcessEnv = process.env
): PropertyProfile {
  const nightly = environment.SHAPELEX_TORTURE === "1";
  return {
    numRuns: readBoundedInteger(
      environment,
      "SHAPELEX_PROPERTY_RUNS",
      nightly ? DEFAULT_NIGHTLY_RUNS : DEFAULT_PR_RUNS,
      MAX_RUNS
    ),
    seed: readBoundedInteger(
      environment,
      "SHAPELEX_PROPERTY_SEED",
      DEFAULT_SEED,
      0x7fff_ffff
    ),
    nightly
  };
}

export function propertyFailureContext(profile: PropertyProfile): string {
  return `fast-check seed=${profile.seed}, numRuns=${profile.numRuns}`;
}

