import process from "node:process";
import { ShapeLexEngine } from "../../src/shapelex.js";

const [workspaceRoot, storageDir, workerId, operationCountText] = process.argv.slice(2);
const operationCount = Number(operationCountText);
if (!workspaceRoot || !storageDir || !workerId || !Number.isSafeInteger(operationCount)) {
  throw new Error("Invalid ShapeLex concurrency worker arguments");
}

const engine = new ShapeLexEngine({ workspaceRoot, storageDir });
for (let operation = 0; operation < operationCount; operation += 1) {
  const text = [
    `Worker ${workerId} operation ${operation} preserves exact source ownership.`,
    "Do not delete backup 4815 before approval and checksum verification."
  ].join(" ");
  let attempts = 0;
  while (true) {
    try {
      engine.compressText({
        sessionId: "multiprocess",
        label: `${workerId}-${operation}`,
        text
      });
      break;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      attempts += 1;
      if (!["STORE_BUSY", "STORE_REVISION_CONFLICT"].includes(code) || attempts >= 100) {
        throw error;
      }
    }
  }
}
