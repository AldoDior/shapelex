import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  buildBoundedFingerprintDocument,
  DEFAULT_INDEX_LIMITS,
  LazyFingerprintIndex
} from "../../src/fingerprint/index.js";
import { createJsonRpcHandler } from "../../src/mcp-server.js";
import { ShapeLexEngine } from "../../src/shapelex.js";

const nightly = process.env.SHAPELEX_TEST_PROFILE === "nightly";

test("nightly: repetitive 2M-character input respects index limits and reports degraded recall", {
  skip: !nightly,
  timeout: 60_000
}, () => {
  const repetitive = "repeat safe token ".repeat(117_648).slice(0, 2_000_000);
  const index = new LazyFingerprintIndex();
  index.registerDocument({ id: "repetitive", textProvider: () => repetitive });
  index.warmDocument("repetitive");
  const stats = index.stats();
  const result = index.search("repeat safe token ".repeat(2_000));

  assert.ok(stats.estimatedIndexBytes <= DEFAULT_INDEX_LIMITS.maxEstimatedBytes);
  assert.ok(
    stats.suppressedHashes > 0 || stats.evictions > 0,
    "a repetitive document must suppress postings or be evicted by the memory guard"
  );
  assert.ok(result.diagnostics.queryFingerprints <= DEFAULT_INDEX_LIMITS.maxQueryFingerprints);
  assert.equal(result.diagnostics.searchComplete, false);
  assert.ok(
    result.diagnostics.limitsHit.includes("document_fingerprint_limit")
      || result.diagnostics.limitsHit.includes("query_fingerprint_limit")
      || result.diagnostics.limitsHit.includes("memory_limit")
      || result.diagnostics.suppressedHashes > 0
  );
});

test("nightly: a 2M-character single token remains processable", {
  skip: !nightly,
  timeout: 60_000
}, () => {
  const bounded = buildBoundedFingerprintDocument("a".repeat(2_000_000), 50_000);
  const fingerprint = bounded.document;

  assert.equal(fingerprint.tokens.length, 1);
  assert.equal(fingerprint.tokens[0]!.rawByteEnd, 2_000_000);
  assert.equal(fingerprint.tokenFingerprints.length, 0);
  assert.equal(fingerprint.characterFingerprints.length, 50_000);
  assert.equal(bounded.complete, false);
});

test("nightly: more than 2M input characters are rejected at the public engine boundary", {
  skip: !nightly
}, () => {
  const engine = new ShapeLexEngine({ persistent: false });
  assert.throws(
    () => engine.compressText({
      sessionId: "oversized-nightly",
      text: "x".repeat(2_000_001)
    }),
    /2000000/
  );
});

test("nightly: 10,000 lazy registrations stay cold and bounded", {
  skip: !nightly,
  timeout: 30_000
}, () => {
  const index = new LazyFingerprintIndex();
  const started = performance.now();
  for (let documentId = 0; documentId < 10_000; documentId += 1) {
    index.registerDocument({
      id: `manifest-${documentId}`,
      textProvider: () => `Document ${documentId} remains cold until an explicit query.`
    });
  }
  const durationMs = performance.now() - started;
  const stats = index.stats();

  assert.equal(stats.registeredDocuments, 10_000);
  assert.equal(stats.warmDocuments, 0);
  assert.equal(stats.coldDocuments, 10_000);
  assert.equal(stats.estimatedIndexBytes, 0);
  assert.ok(durationMs < 1_000, `10,000 registrations took ${durationMs}ms`);
});

test("nightly: 10,000 malformed JSON-RPC requests do not poison server health", {
  skip: !nightly,
  timeout: 30_000
}, async () => {
  const handler = createJsonRpcHandler(new ShapeLexEngine({ persistent: false }));
  for (let requestId = 0; requestId < 10_000; requestId += 1) {
    const response = await handler(
      requestId % 2 === 0
        ? null
        : { jsonrpc: "2.0", id: requestId }
    );
    assert.equal(response.error.code, -32600);
  }
  const ping = await handler({ jsonrpc: "2.0", id: "health", method: "ping" });
  assert.deepEqual(ping.result, {});
});

test("nightly: eight processes complete 1,000 transactional writes without lost ids", {
  skip: !nightly,
  timeout: 20 * 60_000
}, async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-processes-"));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const workerPath = path.resolve("dist/test/v06/store-concurrency-worker.js");
  const operationsPerWorker = Number(process.env.SHAPELEX_CONCURRENCY_OPERATIONS ?? "125");
  assert.ok(Number.isSafeInteger(operationsPerWorker) && operationsPerWorker > 0);
  const workers = Array.from({ length: 8 }, (_, worker) => runWorker([
    workerPath,
    workspaceRoot,
    storageDir,
    String(worker),
    String(operationsPerWorker)
  ]));

  await Promise.all(workers);
  const storePath = path.join(storageDir, "shapelex-store.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const documents = store.sessions
    .find((session: any) => session.id === "multiprocess")
    ?.documents ?? [];
  const expectedDocuments = 8 * operationsPerWorker;
  assert.equal(documents.length, expectedDocuments);
  assert.equal(new Set(documents.map((document: any) => document.id)).size, expectedDocuments);
  assert.equal(fs.existsSync(`${storePath}.lock`), false);
  assert.equal(fs.readdirSync(storageDir).some((name) => name.endsWith(".tmp")), false);
});

function runWorker(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ShapeLex concurrency worker exited ${code}: ${stderr.slice(-2_000)}`));
      }
    });
  });
}
