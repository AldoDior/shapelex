import { classifyFingerprintMatch } from "../../src/fingerprint/index.js";
import { registerFingerprintAcceptanceScenarios } from "./acceptance-contract.js";

registerFingerprintAcceptanceScenarios({
  classify(source, candidate) {
    return classifyFingerprintMatch(source, candidate);
  }
});

