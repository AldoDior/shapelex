import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createEnvironmentHttpInvoker,
  runProviderAB,
  type ProviderABCase
} from "./provider-ab.js";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: npm run eval:provider -- <cases.json> [report.json]");
}

const cases = readCases(inputPath);
const maxRequests = positiveInteger(
  process.env.SHAPELEX_PROVIDER_MAX_REQUESTS ?? "30",
  "SHAPELEX_PROVIDER_MAX_REQUESTS"
);
const maxInputTokensPerRequest = positiveInteger(
  process.env.SHAPELEX_PROVIDER_MAX_INPUT_TOKENS ?? "100000",
  "SHAPELEX_PROVIDER_MAX_INPUT_TOKENS"
);
const results = await runProviderAB(cases, {
  invoke: createEnvironmentHttpInvoker(),
  maxRequests,
  maxInputTokensPerRequest
});
const report = JSON.stringify({
  generatedAt: new Date().toISOString(),
  cases: cases.length,
  requests: results.length,
  results
}, null, 2);
const outputPath = process.argv[3];
if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), report, { encoding: "utf8", mode: 0o600 });
} else {
  process.stdout.write(`${report}\n`);
}

function readCases(filePath: string): ProviderABCase[] {
  const value: unknown = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  if (!Array.isArray(value)) {
    throw new TypeError("Provider evaluation input must be a JSON array.");
  }
  return value as ProviderABCase[];
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return parsed;
}
