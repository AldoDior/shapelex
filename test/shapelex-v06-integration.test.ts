import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonRpcHandler } from "../src/mcp-server.js";
import { ShapeLexEngine } from "../src/shapelex.js";

const exactParagraph = [
  "Before deployment, preserve backup 4815 and verify the rollback owner.",
  "Do not reset production caches until the signed approval arrives.",
  "Record the release date, comparison threshold <= 17, and final checksum."
].join(" ");

test("v0.6 exact duplicates keep separate handles while sharing one persisted source", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-source-"));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const engine = new ShapeLexEngine({ workspaceRoot, storageDir });

  const first = engine.compressText({
    sessionId: "dedup",
    label: "first",
    text: exactParagraph
  });
  const second = engine.compressText({
    sessionId: "dedup",
    label: "second",
    text: exactParagraph
  });

  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.matchKind, "exact");
  assert.notEqual(first.uri, second.uri);
  assert.equal(engine.expand({ sessionId: "dedup", handle: first.uri }).text, exactParagraph);
  assert.equal(engine.expand({ sessionId: "dedup", handle: second.uri }).text, exactParagraph);

  const store = JSON.parse(fs.readFileSync(path.join(storageDir, "shapelex-store.json"), "utf8"));
  assert.equal(store.version, 2);
  assert.equal(store.sources.length, 1);
  assert.equal(store.sources[0].text, exactParagraph);
  assert.equal(store.sessions[0].documents.some((document: any) => "text" in document), false);
  assert.equal(store.sessions[0].spans.some((span: any) => "text" in span), false);
});

test("v0.6 byte-identical file registrations report exact source deduplication", (context) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-file-dedup-"));
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(workspaceRoot, "source.txt"), exactParagraph, "utf8");
  const engine = new ShapeLexEngine({ workspaceRoot, persistent: false });

  const first = engine.compressFile({ sessionId: "file-dedup", sourcePath: "source.txt" });
  const second = engine.compressFile({ sessionId: "file-dedup", sourcePath: "source.txt" });

  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(second.matchKind, "exact");
  assert.notEqual(first.uri, second.uri);
});

test("v0.6 search warms lazily and byte-verifies an exact expandable span", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({
    sessionId: "fingerprint-search",
    text: `${exactParagraph}\n\n${"Neutral supporting context with unique vocabulary. ".repeat(12)}`
  });
  const exactSpan = engine.expand({
    sessionId: "fingerprint-search",
    handle: compressed.handles[0].uri
  }).text;

  assert.equal(engine.stats({ sessionId: "fingerprint-search" }).fingerprintIndex.warmDocuments, 0);
  const search = engine.search({
    sessionId: "fingerprint-search",
    query: exactSpan
  });

  assert.equal(search.results[0].matchKind, "exact");
  assert.equal(search.results[0].exact, true);
  assert.equal(
    engine.expand({
      sessionId: "fingerprint-search",
      handle: search.results[0].uri
    }).text,
    exactSpan
  );
  assert.ok(engine.stats({ sessionId: "fingerprint-search" }).fingerprintIndex.warmDocuments > 0);
});

test("v0.6 stale file searches are incomplete and never return cached keyword facts", (context) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-stale-search-"));
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const sourcePath = path.join(workspaceRoot, "policy.txt");
  fs.writeFileSync(sourcePath, exactParagraph, "utf8");
  const engine = new ShapeLexEngine({ workspaceRoot, persistent: false });
  engine.compressFile({ sessionId: "stale-search", sourcePath: "policy.txt" });
  fs.writeFileSync(sourcePath, exactParagraph.replace("4815", "9999"), "utf8");

  const result = engine.search({
    sessionId: "stale-search",
    query: exactParagraph
  });

  assert.equal(result.searchComplete, false);
  assert.ok(result.diagnostics.staleDocuments.length > 0);
  assert.equal(result.results.length, 0);
});

test("v0.6 exact relocated windows become persistent expandable span handles", (context) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-window-span-"));
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const engine = new ShapeLexEngine({ workspaceRoot, storageDir });
  const firstParagraph = [
    "Introductory evidence explains ownership and recovery preparation.",
    "The exact boundary begins with alpha beta gamma delta echo."
  ].join(" ");
  const secondParagraph = [
    "Foxtrot golf hotel india juliet continues the exact boundary.",
    "Closing evidence records the complete audit history."
  ].join(" ");
  const text = `${firstParagraph}\n\n${secondParagraph}`;
  const query = [
    "alpha beta gamma delta echo.",
    "",
    "Foxtrot golf hotel india juliet"
  ].join("\n");
  const compressed = engine.compressText({ sessionId: "window-span", text });
  assert.ok(
    compressed.handles.every((handle: any) => (
      engine.expand({ sessionId: "window-span", handle: handle.uri }).text !== query
    ))
  );

  const search = engine.search({ sessionId: "window-span", query });
  const exact = search.results.find((result: any) => result.exact);

  assert.ok(exact);
  assert.match(exact.uri, /^sx:\/\/window-span\/span\/span_\d+$/);
  assert.equal(engine.expand({ sessionId: "window-span", handle: exact.uri }).text, query);
  const reloaded = new ShapeLexEngine({ workspaceRoot, storageDir });
  assert.equal(reloaded.expand({ sessionId: "window-span", handle: exact.uri }).text, query);
});

test("v0.6 rejects workspace symlinks that resolve outside the workspace", (context) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-symlink-"));
  context.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const workspaceRoot = path.join(parent, "workspace");
  fs.mkdirSync(workspaceRoot);
  const outsidePath = path.join(parent, "private.txt");
  fs.writeFileSync(outsidePath, exactParagraph, "utf8");
  const linkPath = path.join(workspaceRoot, "escape.txt");
  try {
    fs.symlinkSync(outsidePath, linkPath, "file");
  } catch (error: any) {
    if (["EACCES", "EPERM"].includes(error?.code)) {
      context.skip("This platform does not permit creating test symlinks.");
      return;
    }
    throw error;
  }
  const engine = new ShapeLexEngine({ workspaceRoot, persistent: false });

  assert.throws(
    () => engine.compressFile({ sourcePath: "escape.txt" }),
    /must stay inside the configured workspace root/
  );
});

test("v0.6 critical changes remain advisory and require expansion", () => {
  const engine = new ShapeLexEngine();
  engine.compressText({
    sessionId: "critical-match",
    text: exactParagraph
  });

  const changed = exactParagraph
    .replace("Do not reset", "Reset")
    .replace("<= 17", "< 71");
  const search = engine.search({ sessionId: "critical-match", query: changed });
  const match = search.results[0];

  assert.notEqual(match.matchKind, "exact");
  assert.notEqual(match.matchKind, "strong_related");
  assert.equal(match.mustExpand, true);
  assert.equal(match.criticalDiff, true);
});

test("v0.6 rejects an empty session id instead of treating it as clear-all", () => {
  const engine = new ShapeLexEngine({ persistent: false });
  engine.compressText({ sessionId: "one", text: `${exactParagraph} one` });
  engine.compressText({ sessionId: "two", text: `${exactParagraph} two` });

  assert.throws(
    () => engine.clear({ sessionId: "" }),
    /sessionId must be 1-80 characters/
  );
  assert.equal(engine.stats().activeDocuments, 2);
});

test("v0.6 rejects oversized message collections before joining them", () => {
  const engine = new ShapeLexEngine({ persistent: false });
  const messages = [
    { role: "user", content: "a".repeat(1_100_000) },
    { role: "assistant", content: "b".repeat(1_100_000) }
  ];

  assert.throws(
    () => engine.compressMessages({ messages }),
    /messages must be 2000000 characters or fewer in total/
  );
  assert.equal(engine.stats().activeDocuments, 0);
});

test("v0.6 concurrent engine instances refresh revisions before allocating ids", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-revision-"));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const first = new ShapeLexEngine({ workspaceRoot, storageDir });
  const second = new ShapeLexEngine({ workspaceRoot, storageDir });

  const firstResult = first.compressText({
    sessionId: "shared",
    text: `${exactParagraph} First writer.`
  });
  const secondResult = second.compressText({
    sessionId: "shared",
    text: `${exactParagraph} Second writer.`
  });

  assert.equal(firstResult.documentId, "doc_1");
  assert.equal(secondResult.documentId, "doc_2");
  const restored = new ShapeLexEngine({ workspaceRoot, storageDir });
  assert.equal(restored.stats({ sessionId: "shared" }).activeDocuments, 2);
});

test("v0.6 clear retries a revision conflict without losing another process commit", (context) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-clear-race-"));
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const clearingEngine = new ShapeLexEngine({ workspaceRoot, storageDir });
  clearingEngine.compressText({ sessionId: "remove-me", text: `${exactParagraph} remove` });
  const concurrentEngine = new ShapeLexEngine({ workspaceRoot, storageDir });
  const coordinator = clearingEngine.storeCoordinator!;
  const transact = coordinator.transact.bind(coordinator);
  let injectedCommit = false;
  coordinator.transact = ((mutator: any, options: any) => {
    if (!injectedCommit) {
      injectedCommit = true;
      concurrentEngine.compressText({
        sessionId: "keep-me",
        text: `${exactParagraph} concurrent`
      });
    }
    return transact(mutator, options);
  }) as typeof coordinator.transact;

  clearingEngine.clear({ sessionId: "remove-me" });

  const reloaded = new ShapeLexEngine({ workspaceRoot, storageDir });
  assert.equal(reloaded.stats({ sessionId: "remove-me" }).activeDocuments, 0);
  assert.equal(reloaded.stats({ sessionId: "keep-me" }).activeDocuments, 1);
});

test("v0.6 migrates a v1 text store without changing exact sx handles", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-v06-migrate-"));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  fs.mkdirSync(storageDir);
  const checksum = crypto.createHash("sha256").update(exactParagraph).digest("hex").slice(0, 24);
  fs.writeFileSync(path.join(storageDir, "shapelex-store.json"), JSON.stringify({
    version: 1,
    savedAt: new Date(0).toISOString(),
    sessions: [{
      id: "legacy",
      createdAt: new Date(0).toISOString(),
      lastAccessedAt: new Date(0).toISOString(),
      nextSpan: 2,
      nextDocument: 2,
      documents: [{
        id: "doc_1",
        uri: "sx://legacy/doc/doc_1",
        label: "legacy",
        mode: "text",
        text: exactParagraph,
        checksum,
        createdAt: new Date(0).toISOString(),
        risk: { level: "low", mustExpand: false, shouldExpand: false, reasons: [] },
        confidence: 1,
        levels: {}
      }],
      spans: [{
        text: exactParagraph,
        metadata: {
          spanId: "span_1",
          documentId: "doc_1",
          uri: "sx://legacy/span/span_1",
          label: "legacy",
          role: "text",
          index: 0,
          mode: "text",
          charLength: exactParagraph.length,
          checksum,
          tokenEstimate: 30,
          anchors: ["deployment", "rollback"],
          protectedTerms: ["not"],
          risk: { level: "low", mustExpand: false, shouldExpand: false, reasons: [] }
        }
      }],
      usageEvents: []
    }]
  }), "utf8");

  const engine = new ShapeLexEngine({ workspaceRoot, storageDir });
  assert.equal(engine.expand({
    sessionId: "legacy",
    handle: "sx://legacy/doc/doc_1"
  }).text, exactParagraph);
  assert.equal(engine.expand({
    sessionId: "legacy",
    handle: "sx://legacy/span/span_1"
  }).text, exactParagraph);

  engine.flush();
  const migrated = JSON.parse(fs.readFileSync(path.join(storageDir, "shapelex-store.json"), "utf8"));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sessions[0].documents[0].uri, "sx://legacy/doc/doc_1");
  assert.equal(migrated.sessions[0].spans[0].metadata.uri, undefined);
  assert.equal(migrated.sources[0].sha256.length, 64);
});

test("MCP v0.6 exposes compact deduplication and fingerprint context metadata", async () => {
  const engine = new ShapeLexEngine();
  const handle = createJsonRpcHandler(engine, {
    toolset: "lean",
    responseMode: "compatible"
  });
  const input = {
    sessionId: "mcp-v06",
    text: exactParagraph
  };
  await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "shapelex_compress_text", arguments: input }
  });
  const duplicate = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "shapelex_compress_text", arguments: input }
  });
  const context = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "shapelex_context",
      arguments: { sessionId: "mcp-v06", query: exactParagraph }
    }
  });

  assert.equal(duplicate.result.structuredContent.deduplicated, true);
  assert.equal(duplicate.result.structuredContent.matchKind, "exact");
  assert.equal(context.result.structuredContent.results[0].match.matchKind, "exact");
  assert.equal(typeof context.result.structuredContent.searchComplete, "boolean");
});
