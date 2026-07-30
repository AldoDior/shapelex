import process from "node:process";
import { runOfflineProtocolEvaluation } from "./protocol-ledger.js";

export async function runBenchmark() {
  return runOfflineProtocolEvaluation();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = await runBenchmark();
  console.log(JSON.stringify(report, null, 2));
  if (
    report.summary.aggregateReduction < 0.25
    || report.summary.medianReduction < 0.25
    || report.summary.requiredFactFidelity < 0.98
    || report.summary.regressions.length > 0
  ) {
    process.exitCode = 1;
  }
}
