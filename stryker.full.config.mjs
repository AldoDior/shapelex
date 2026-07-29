import focusedConfig from "./stryker.config.mjs";

/** @type {import("@stryker-mutator/api/core").StrykerOptions} */
const config = {
  ...focusedConfig,
  mutate: [
    "src/fingerprint/critical-diff.ts",
    "src/fingerprint/exact.ts",
    "src/fingerprint/lazy-index.ts",
    "src/fingerprint/matcher.ts",
    "src/storage/store-v2.ts"
  ],
  htmlReporter: {
    fileName: "coverage/v06/mutation-full.html"
  },
  thresholds: {
    ...focusedConfig.thresholds,
    break: null
  },
  concurrency: 4
};

export default config;
