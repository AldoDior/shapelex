/** @type {import("@stryker-mutator/api/core").StrykerOptions} */
const config = {
  mutate: [
    "src/fingerprint/critical-diff.ts",
    "src/fingerprint/exact.ts",
    "src/fingerprint/matcher.ts:63-125",
    "src/shapelex.ts:1291-1315",
    "src/storage/store-v2.ts:335-388",
    "src/storage/store-v2.ts:429-533",
    "src/storage/store-v2.ts:629-712",
    "src/storage/store-v2.ts:714-782",
    "src/storage/store-v2.ts:797-832"
  ],
  testRunner: "command",
  buildCommand: "npm run build",
  commandRunner: {
    command: "node --test dist/test/fingerprint-*.test.js dist/test/shapelex.test.js dist/test/shapelex-v06-integration.test.js dist/test/store-v2*.test.js"
  },
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: {
    fileName: "coverage/v06/mutation.html"
  },
  thresholds: {
    high: 90,
    low: 85,
    break: 85
  },
  timeoutMS: 20_000,
  concurrency: 2,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always"
};

export default config;
