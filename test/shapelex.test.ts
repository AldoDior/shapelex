import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ShapeLexEngine, charShape, estimateTokens, fingerprintTokens } from "../src/shapelex.js";
import { createEngineFromEnvironment, createJsonRpcHandler, handleJsonRpc } from "../src/mcp-server.js";

test("charShape is stable for identifiers and mixed case", () => {
  const shape = charShape("validateChargebackTransaction");

  assert.equal(shape.length, 29);
  assert.equal(shape.prefix, "val");
  assert.equal(shape.suffix, "ion");
  assert.equal(shape.mask, "L8UL9UL10");
  assert.match(shape.vc, /^CVC/);
});

test("fingerprints are deterministic", () => {
  const tokens = ["Validate", "chargeback", "transactions", "before", "settlement"];

  assert.deepEqual(fingerprintTokens(tokens), fingerprintTokens(tokens));
  assert.ok(fingerprintTokens(tokens).length > 0);
});

test("compressText creates expandable handles for long spans", () => {
  const engine = new ShapeLexEngine();
  const text = "Do not approve chargeback transactions before settlement. ".repeat(20);
  const compressed = engine.compressText({ sessionId: "s1", text, label: "demo" });

  assert.ok(compressed.handles.length > 0);
  assert.ok(compressed.compressedTokenEstimate < compressed.rawTokenEstimate);
  assert.ok(compressed.compressedText.includes("shapelex_expand"));

  const expanded = compressed.handles
    .map((handle) => engine.expand({ sessionId: "s1", handle: handle.uri }).text)
    .join(" ");
  assert.equal(expanded, text.trim());
});

test("model-facing compression omits server-only shapes and fingerprints", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({
    sessionId: "public-metadata",
    text: "Do not approve invoice 4815 before settlement. ".repeat(20)
  });

  assert.equal("shapes" in compressed.handles[0], false);
  assert.equal("fingerprints" in compressed.handles[0], false);
  assert.equal("fingerprints" in compressed.levels[2], false);
  assert.equal(compressed.compressedText.includes(" fp="), false);
});

test("critical extract previews disclose truncation and source offsets", () => {
  const engine = new ShapeLexEngine();
  const text = `Do not approve this operation before review because ${"detail ".repeat(80)}.`;
  const compressed = engine.compressText({ sessionId: "critical-preview", text });
  const extract = compressed.levels[3].criticalExtracts[0];

  assert.equal(extract.exact, false);
  assert.equal(extract.truncated, true);
  assert.equal(extract.sourceStart, 0);
  assert.equal(extract.sourceEnd, text.length);
  assert.ok(extract.text.endsWith("..."));
});

test("compressText skips compression when metadata would cost more tokens", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({ sessionId: "tiny", text: "Short exact note.", label: "tiny-note" });

  assert.equal(compressed.compressionSkipped, true);
  assert.equal(compressed.compressedText, "Short exact note.");
  assert.equal(compressed.savingsRatio, 0);
  assert.ok(compressed.handles.length > 0);
});

test("compressMessages preserves short latest message and compresses older long context", () => {
  const engine = new ShapeLexEngine();
  const messages = [
    { role: "user", content: "This is a long background note. ".repeat(60) },
    { role: "user", content: "What should we do next?" }
  ];
  const compressed = engine.compressMessages({ sessionId: "chat", messages });

  assert.ok(compressed.handles.length > 0);
  assert.ok(compressed.compressedText.includes("What should we do next?"));
  assert.ok(compressed.savingsRatio > 0);
});

test("clear removes active handles", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({ sessionId: "clearme", text: "Important context. ".repeat(40) });

  assert.ok(engine.stats({ sessionId: "clearme" }).activeHandles > 0);
  engine.clear({ sessionId: "clearme" });
  assert.throws(() => engine.expand({ sessionId: "clearme", handle: compressed.handles[0].uri }), /Unknown ShapeLex session/);
});

test("persistent storage restores expandable handles across engine instances", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-store-"));
  const first = new ShapeLexEngine({ storageDir });
  const text = Array.from({ length: 12 }, () => "Do not rotate credential 123 without approval.").join(" ");
  const compressed = first.compressText({ sessionId: "persist", text, label: "persistent-demo" });
  first.flush();

  const second = new ShapeLexEngine({ storageDir });
  const expanded = second.expand({ sessionId: "persist", handle: compressed.handles[0].uri });

  assert.equal(expanded.text, text.trim());
  assert.equal(second.stats({ sessionId: "persist" }).activeHandles, compressed.handles.length);
});

test("file-backed compression expands exact workspace content without storing a full duplicate", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-file-workspace-"));
  const storageDir = path.join(workspaceRoot, ".shapelex");
  const sourceDir = path.join(workspaceRoot, "src");
  const sourcePath = path.join(sourceDir, "policy.ts");
  const text = [
    "export function canApprove(total: number) {",
    "  // Historical explanation with unicode: acción segura.",
    "  return total <= 4815;",
    "}",
    "",
    "Neutral background context. ".repeat(50)
  ].join("\r\n");
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(sourcePath, text, "utf8");

  const first = new ShapeLexEngine({ storageDir, workspaceRoot });
  const compressed = first.compressFile({
    sessionId: "file-backed",
    sourcePath: "src/policy.ts"
  });

  assert.equal(compressed.source.kind, "file");
  assert.equal(compressed.source.relativePath, "src/policy.ts");
  assert.equal(compressed.mode, "code");
  assert.equal(first.expand({ sessionId: "file-backed", handle: compressed.uri }).text, text);
  assert.equal(first.stats({ sessionId: "file-backed" }).approxMemoryBytes, 0);
  assert.equal(
    first.stats({ sessionId: "file-backed" }).referencedSourceBytes,
    Buffer.byteLength(text, "utf8")
  );

  const persistedStore = fs.readFileSync(path.join(storageDir, "shapelex-store.json"), "utf8");
  assert.equal(persistedStore.includes(text), false);
  assert.equal(persistedStore.includes("\n"), false);

  const second = new ShapeLexEngine({ storageDir, workspaceRoot });
  assert.equal(second.expand({ sessionId: "file-backed", handle: compressed.uri }).text, text);
  const restoredLevel4 = second.retrieve({
    sessionId: "file-backed",
    uri: compressed.uri,
    level: 4
  });
  assert.equal(restoredLevel4.levels["4"].handles.length, compressed.handles.length);
  const restoredSpan = second.expand({
    sessionId: "file-backed",
    handle: compressed.handles[0].uri
  });
  assert.equal(restoredSpan.metadata.label, "src/policy.ts");
  assert.ok(text.includes(restoredSpan.text));
});

test("file-backed expansion rejects changed sources", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-file-change-"));
  const sourcePath = path.join(workspaceRoot, "policy.txt");
  fs.writeFileSync(sourcePath, "Do not approve invoice 4815 before settlement. ".repeat(20));
  const engine = new ShapeLexEngine({ workspaceRoot });
  const compressed = engine.compressFile({
    sessionId: "file-change",
    sourcePath: "policy.txt"
  });

  fs.appendFileSync(sourcePath, "\nChanged after registration.");

  assert.throws(
    () => engine.expand({ sessionId: "file-change", handle: compressed.uri }),
    /source file changed after registration/
  );
  assert.throws(
    () => engine.expand({ sessionId: "file-change", handle: compressed.handles[0].uri }),
    /source file changed after registration/
  );
});

test("file-backed compression rejects paths outside the workspace", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-file-boundary-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-file-outside-"));
  const outsidePath = path.join(outsideRoot, "private.txt");
  fs.writeFileSync(outsidePath, "Private text outside the configured workspace.");
  const engine = new ShapeLexEngine({ workspaceRoot });

  assert.throws(
    () => engine.compressFile({ sessionId: "boundary", sourcePath: outsidePath }),
    /must stay inside the configured workspace root/
  );
});

test("file-backed compression rejects non-UTF-8 files", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-file-encoding-"));
  fs.writeFileSync(path.join(workspaceRoot, "binary.dat"), Buffer.from([0xff, 0xfe, 0xfd]));
  const engine = new ShapeLexEngine({ workspaceRoot });

  assert.throws(
    () => engine.compressFile({ sessionId: "encoding", sourcePath: "binary.dat" }),
    /valid UTF-8 text file/
  );
});

test("stats report persistence strategy and configurable store limit", () => {
  const engine = new ShapeLexEngine({ storageDir: "local-store", maxStoreBytes: 2 * 1024 * 1024 });
  const stats = engine.stats();

  assert.equal(stats.persistence.enabled, true);
  assert.equal(stats.persistence.maxStoreBytes, 2 * 1024 * 1024);
  assert.equal(stats.persistence.strategy, "single-json-file");
});

test("memory-only MCP mode creates no store or gitignore entry", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-memory-only-"));
  const engine = createEngineFromEnvironment({
    SHAPELEX_PERSIST: "0",
    SHAPELEX_STORE_DIR: ".shapelex-should-not-exist"
  }, workspaceRoot);

  engine.compressText({
    sessionId: "volatile",
    text: "Long in-memory context that should never create a local store file. ".repeat(20)
  });
  const stats = engine.stats({ sessionId: "volatile" });

  assert.equal(stats.persistence.enabled, false);
  assert.equal(stats.persistence.strategy, "memory-only");
  assert.equal(stats.persistence.storePath, undefined);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".shapelex-should-not-exist")), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".gitignore")), false);
});

test("usage telemetry is cumulative, explicit about estimates, and persistent", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-usage-"));
  const first = new ShapeLexEngine({ storageDir });
  first.compressText({ sessionId: "usage", text: "Historical context. ".repeat(80) });
  first.compressText({ sessionId: "usage", text: "Short exact note." });

  const firstStats = first.stats({ sessionId: "usage" });
  assert.equal(firstStats.tokenAccounting.estimator, "shapelex-heuristic-v1");
  assert.equal(firstStats.tokenAccounting.exact, false);
  assert.equal(firstStats.tokenAccounting.usage.operations, 2);
  assert.equal(firstStats.tokenAccounting.usage.skippedOperations, 1);

  const second = new ShapeLexEngine({ storageDir });
  const restored = second.stats({ sessionId: "usage" });
  assert.equal(restored.tokenAccounting.usage.operations, 2);
  assert.ok(restored.tokenAccounting.usage.rawTokens > restored.tokenAccounting.usage.compressedTokens);
});

test("persistent writes enforce the configured store limit and clean temporary files", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-limit-"));
  const engine = new ShapeLexEngine({ storageDir, maxStoreBytes: 1024 * 1024 });
  const text = "Do not persist this oversized payload 12345. ".repeat(18_000);

  assert.throws(
    () => engine.compressText({ sessionId: "oversized", text }),
    /would exceed the configured maximum size/
  );
  assert.equal(
    fs.readdirSync(storageDir).some((name) => name.endsWith(".tmp")),
    false
  );
  assert.equal(engine.stats({ sessionId: "oversized" }).activeDocuments, 0);
  assert.equal(engine.stats({ sessionId: "oversized" }).activeHandles, 0);
});

test("persistent storage protects ShapeLex stores in gitignore", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-gitignore-"));
  fs.mkdirSync(path.join(repoDir, ".git"));
  fs.writeFileSync(path.join(repoDir, ".gitignore"), "node_modules/\n");

  const engine = new ShapeLexEngine({ storageDir: path.join(repoDir, ".shapelex-cursor") });
  const gitignore = fs.readFileSync(path.join(repoDir, ".gitignore"), "utf8");
  const stats = engine.stats();

  assert.match(gitignore, /# ShapeLex local memory/);
  assert.match(gitignore, /^\.shapelex-cursor\/$/m);
  assert.equal(stats.persistence.gitignoreProtection.enabled, true);
  assert.equal(stats.persistence.gitignoreProtection.changed, true);

  new ShapeLexEngine({ storageDir: path.join(repoDir, ".shapelex-cursor") });
  const secondGitignore = fs.readFileSync(path.join(repoDir, ".gitignore"), "utf8");
  assert.equal(secondGitignore.match(/^\.shapelex-cursor\/$/gm)?.length, 1);
});

test("persistent storage does not auto-ignore non ShapeLex folder names", () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-gitignore-safe-"));
  fs.mkdirSync(path.join(repoDir, ".git"));

  const engine = new ShapeLexEngine({ storageDir: path.join(repoDir, "src") });

  assert.equal(fs.existsSync(path.join(repoDir, ".gitignore")), false);
  assert.equal(engine.stats().persistence.gitignoreProtection.enabled, false);
  assert.equal(engine.stats().persistence.gitignoreProtection.reason, "non-shapelex-store-dir");
});

test("persistent clear removes sessions from the store", () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-clear-"));
  const first = new ShapeLexEngine({ storageDir });
  first.compressText({ sessionId: "clear-persist", text: "Important local memory. ".repeat(20) });
  first.clear({ sessionId: "clear-persist" });

  const second = new ShapeLexEngine({ storageDir });
  assert.equal(second.stats({ sessionId: "clear-persist" }).activeHandles, 0);
});

test("prune previews and removes old sessions without clearing recent work", () => {
  const engine = new ShapeLexEngine();
  engine.compressText({ sessionId: "old-project", text: "Old project context. ".repeat(30) });
  engine.compressText({ sessionId: "new-project", text: "New project context. ".repeat(30) });

  const oldSession = engine.sessions.get("old-project");
  oldSession.lastAccessedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const preview = engine.prune({ olderThanDays: 14, dryRun: true });
  assert.deepEqual(preview.removedSessions, ["old-project"]);
  assert.equal(engine.stats().activeDocuments, 2);

  const pruned = engine.prune({ olderThanDays: 14 });
  assert.deepEqual(pruned.removedSessions, ["old-project"]);
  assert.equal(engine.stats().activeDocuments, 1);
  assert.equal(engine.stats({ sessionId: "new-project" }).activeDocuments, 1);
});

test("prune can keep only the newest sessions", () => {
  const engine = new ShapeLexEngine();
  engine.compressText({ sessionId: "project-a", text: "A context. ".repeat(30) });
  engine.compressText({ sessionId: "project-b", text: "B context. ".repeat(30) });
  engine.compressText({ sessionId: "project-c", text: "C context. ".repeat(30) });

  engine.sessions.get("project-a").lastAccessedAt = new Date(Date.now() - 3_000).toISOString();
  engine.sessions.get("project-b").lastAccessedAt = new Date(Date.now() - 2_000).toISOString();
  engine.sessions.get("project-c").lastAccessedAt = new Date(Date.now() - 1_000).toISOString();

  const pruned = engine.prune({ maxSessions: 2 });
  assert.deepEqual(pruned.removedSessions, ["project-a"]);
  assert.equal(engine.stats().sessions.length, 2);
});

test("memoryOverview explains current session and cleanup suggestions", () => {
  const engine = new ShapeLexEngine();
  engine.compressText({ sessionId: "inventory-app", text: "Inventory project context. ".repeat(30), label: "inventory-notes" });

  const overview = engine.memoryOverview({ sessionId: "inventory-app" });

  assert.equal(overview.currentSessionId, "inventory-app");
  assert.match(overview.plainEnglish, /inventory-app/);
  assert.equal(overview.sessions[0].isCurrent, true);
  assert.ok(overview.sessions[0].labels.includes("inventory-notes"));
  assert.ok(overview.cleanupExamples.previewOldSessions.dryRun);
});

test("MCP tools/list and tools/call expose compression", async () => {
  const list = await handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(list.result.tools.some((tool) => tool.name === "shapelex_compress_text"), true);
  assert.equal(list.result.tools.some((tool) => tool.name === "shapelex_search"), false);

  const call = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: {
        sessionId: "mcp",
        text: "Do not approve chargeback transactions before settlement. ".repeat(20)
      }
    }
  });

  assert.equal(call.result.structuredContent.sessionId, "mcp");
  assert.ok(call.result.structuredContent.handles.length > 0);
  assert.equal("levels" in call.result.structuredContent, false);
  assert.equal("anchors" in call.result.structuredContent.handles[0], false);
  assert.equal(call.result.content[0].text, call.result.structuredContent.compressedText);
  assert.equal(call.result.content[0].text.includes("\"shapes\""), false);
});

test("MCP compression response stays smaller than the long raw input", async () => {
  const engine = new ShapeLexEngine();
  const handle = createJsonRpcHandler(engine);
  const text = "Do not approve invoice 4815 before settlement. ".repeat(100);
  const response = await handle({
    jsonrpc: "2.0",
    id: 200,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: { sessionId: "response-budget", text }
    }
  });

  assert.ok(estimateTokens(JSON.stringify(response)) < estimateTokens(text));
});

test("MCP compression accepts workspace files without a separate tool schema", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-mcp-file-"));
  const sourcePath = path.join(workspaceRoot, "notes.md");
  const text = "Do not publish release 4815 before approval. ".repeat(30);
  fs.writeFileSync(sourcePath, text);
  const handle = createJsonRpcHandler(new ShapeLexEngine({ workspaceRoot }));

  const compressed = await handle({
    jsonrpc: "2.0",
    id: 201,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: {
        sessionId: "mcp-file",
        sourcePath: "notes.md"
      }
    }
  });

  assert.equal(compressed.result.structuredContent.source.kind, "file");
  assert.equal(compressed.result.structuredContent.source.relativePath, "notes.md");

  const expanded = await handle({
    jsonrpc: "2.0",
    id: 202,
    method: "tools/call",
    params: {
      name: "shapelex_expand",
      arguments: {
        sessionId: "mcp-file",
        handle: compressed.result.structuredContent.uri
      }
    }
  });

  assert.equal(expanded.result.content[0].text, text);
  assert.equal("text" in expanded.result.structuredContent, false);
});

test("MCP initialize instructs agents to use ShapeLex proactively", async () => {
  const initialized = await handleJsonRpc({ jsonrpc: "2.0", id: 40, method: "initialize", params: {} });
  const instructions = initialized.result.instructions;

  assert.match(instructions, /agent-driven/);
  assert.match(instructions, /proactively/);
  assert.match(instructions, /do not wait/);
  assert.match(instructions, /Briefly tell/);
  assert.match(instructions, /Recommend lean mode/);
  assert.match(instructions, /Suggest a new readable sessionId/);
  assert.match(instructions, /Suggest cleanup/);
  assert.match(instructions, /ask before destructive cleanup/);
  assert.match(instructions, /Expand sx:\/\/ handles/);
});

test("MCP default toolset is lean", async () => {
  const engine = new ShapeLexEngine();
  const handleDefaultJsonRpc = createJsonRpcHandler(engine);
  const list = await handleDefaultJsonRpc({ jsonrpc: "2.0", id: 30, method: "tools/list" });
  const names = list.result.tools.map((tool) => tool.name);

  assert.deepEqual(names, [
    "shapelex_compress_messages",
    "shapelex_compress_text",
    "shapelex_expand",
    "shapelex_context",
    "shapelex_memory_overview",
    "shapelex_clear",
    "shapelex_prune"
  ]);
});

test("MCP lean toolset exposes only the core low-overhead tools", async () => {
  const engine = new ShapeLexEngine();
  const handleLeanJsonRpc = createJsonRpcHandler(engine, { toolset: "lean" });
  const list = await handleLeanJsonRpc({ jsonrpc: "2.0", id: 31, method: "tools/list" });
  const names = list.result.tools.map((tool) => tool.name);

  assert.deepEqual(names, [
    "shapelex_compress_messages",
    "shapelex_compress_text",
    "shapelex_expand",
    "shapelex_context",
    "shapelex_memory_overview",
    "shapelex_clear",
    "shapelex_prune"
  ]);
});

test("MCP full toolset stays compact with one inspect tool", async () => {
  const engine = new ShapeLexEngine();
  const handleFullJsonRpc = createJsonRpcHandler(engine, { toolset: "full" });
  const list = await handleFullJsonRpc({ jsonrpc: "2.0", id: 33, method: "tools/list" });
  const names = list.result.tools.map((tool) => tool.name);
  const schemaTokens = estimateTokens(JSON.stringify(list.result.tools));

  assert.deepEqual(names, [
    "shapelex_compress_messages",
    "shapelex_compress_text",
    "shapelex_expand",
    "shapelex_context",
    "shapelex_inspect",
    "shapelex_memory_overview",
    "shapelex_clear",
    "shapelex_prune"
  ]);
  assert.ok(schemaTokens <= 900);
});

test("MCP full inspect tool searches lower-level memory", async () => {
  const engine = new ShapeLexEngine();
  const handleFullJsonRpc = createJsonRpcHandler(engine, { toolset: "full" });

  await handleFullJsonRpc({
    jsonrpc: "2.0",
    id: 34,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: {
        sessionId: "full-inspect",
        text: "Searchable ShapeLex full-mode context about invoice approval. ".repeat(20)
      }
    }
  });

  const found = await handleFullJsonRpc({
    jsonrpc: "2.0",
    id: 35,
    method: "tools/call",
    params: {
      name: "shapelex_inspect",
      arguments: {
        action: "search",
        sessionId: "full-inspect",
        query: "invoice approval"
      }
    }
  });

  assert.equal(found.result.structuredContent.results.length, 1);
});

test("MCP lean toolset rejects hidden full-tool calls", async () => {
  const engine = new ShapeLexEngine();
  const handleLeanJsonRpc = createJsonRpcHandler(engine, { toolset: "lean" });
  const response = await handleLeanJsonRpc({
    jsonrpc: "2.0",
    id: 32,
    method: "tools/call",
    params: {
      name: "shapelex_stats",
      arguments: {}
    }
  });

  assert.match(response.error.message, /not available/);
});

test("MCP memory overview explains sessions", async () => {
  await handleJsonRpc({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: {
        sessionId: "overview-session",
        text: "Readable memory overview context. ".repeat(20)
      }
    }
  });

  const overview = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: {
      name: "shapelex_memory_overview",
      arguments: {
        sessionId: "overview-session"
      }
    }
  });

  assert.equal(overview.result.structuredContent.currentSessionId, "overview-session");
  assert.match(overview.result.structuredContent.plainEnglish, /overview-session/);
});

test("compress creates navigable levels with risk assessment", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compress({
    sessionId: "nav",
    mode: "text",
    label: "policy",
    text: "Do not delete invoice 123 before approval. Keep the audit trail for 7 years. ".repeat(8)
  });

  assert.equal(compressed.mode, "text");
  assert.ok(compressed.uri.startsWith("sx://nav/doc/doc_"));
  assert.ok(compressed.levels[0].summary.includes("policy"));
  assert.ok(compressed.levels[2].protectedTerms.includes("not"));
  assert.ok(compressed.levels[3].criticalExtracts.length > 0);
  assert.equal(compressed.risk.shouldExpand, true);
});

test("search and retrieve navigate compressed memory", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({
    sessionId: "search",
    label: "ops",
    text: "The deployment plan says never reset production cache before backup. Ticket OPS-123 owns rollback."
  });

  const found = engine.search({ sessionId: "search", query: "rollback OPS-123" });
  assert.equal(found.results.length, 1);

  const retrieved = engine.retrieve({ sessionId: "search", uri: compressed.uri, level: 3 });
  assert.ok(retrieved.levels[3].criticalExtracts.some((item) => item.text.includes("OPS-123")));
});

test("context returns compact task-ready memory in one call", () => {
  const engine = new ShapeLexEngine();
  engine.compressText({
    sessionId: "context",
    mode: "code",
    label: "checkout.ts",
    text: [
      "File: src/checkout.ts",
      "Existing public function name must be validateCheckout.",
      "Requirement: Do not approve invoices over 5000 without manager approval.",
      "Requirement: Preserve retryCount when validation fails.",
      "Requirement: Return error code MANAGER_APPROVAL_REQUIRED.",
      "Constraint: Keep existing idempotencyKey behavior."
    ].join("\n")
  });

  const context = engine.context({
    sessionId: "context",
    query: "validateCheckout manager approval retryCount idempotencyKey",
    mode: "code"
  });

  assert.match(context.contextText, /validateCheckout/);
  assert.match(context.contextText, /MANAGER_APPROVAL_REQUIRED/);
  assert.match(context.contextText, /Expand if exactness matters/);
  assert.ok(context.tokenEstimate > 0);
});

test("code mode extracts imports symbols references and errors", () => {
  const engine = new ShapeLexEngine();
  const code = `
import fs from "node:fs";

export class RepoReader {
  readFile(path) {
    if (!path) throw new Error("missing path");
    return fs.readFileSync(path, "utf8");
  }
}
`;
  const compressed = engine.compressText({ sessionId: "code", mode: "code", label: "repo-reader.js", text: code });

  assert.equal(compressed.code.imports.length, 1);
  assert.ok(compressed.code.symbols.some((symbol) => symbol.name === "RepoReader"));
  assert.ok(compressed.code.symbols.some((symbol) => symbol.name === "readFile"));
  assert.ok(compressed.code.errors.length > 0);
  assert.equal(compressed.risk.shouldExpand, true);
});

test("conversation mode preserves decisions constraints todos and changes", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressMessages({
    sessionId: "chat-memory",
    messages: [
      { role: "user", content: "Decidimos que ShapeLex no debe reconstruir todo desde texto comprimido." },
      { role: "assistant", content: "Pendiente: implementar search y risk assessment." },
      { role: "user", content: "Cambio de opinion: mejor no persistir nada todavia." }
    ]
  });

  assert.equal(compressed.conversation.decisions.length, 1);
  assert.ok(compressed.conversation.constraints.length >= 1);
  assert.ok(compressed.conversation.todos.length >= 1);
  assert.equal(compressed.conversation.changesOfMind.length, 1);
});

test("MCP resources expose ShapeLex documents and levels", async () => {
  const call = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: {
        sessionId: "resources",
        label: "resource-demo",
        text: "Never approve payment batch 42 without dual approval."
      }
    }
  });

  const listed = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 11,
    method: "resources/list",
    params: { sessionId: "resources" }
  });

  assert.ok(listed.result.resources.some((resource) => resource.uri === call.result.structuredContent.uri));

  const read = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 12,
    method: "resources/read",
    params: { uri: `${call.result.structuredContent.uri}/level/3` }
  });

  assert.ok(read.result.contents[0].text.includes("dual approval"));
});

test("session ids and sx handles are validated", () => {
  const engine = new ShapeLexEngine();
  const compressed = engine.compressText({
    sessionId: "safe-session",
    text: "Never rotate credential 123 without approval.".repeat(20)
  });

  assert.throws(
    () => engine.compressText({ sessionId: "../bad", text: "unsafe" }),
    /sessionId must/
  );
  assert.throws(
    () => engine.expand({ sessionId: "other-session", handle: compressed.handles[0].uri }),
    /Unknown ShapeLex session|session mismatch/
  );
  assert.throws(
    () => engine.retrieve({ sessionId: "safe-session", uri: compressed.uri, level: 9 }),
    /level must/
  );
});

test("MCP tools/call validates tool arguments", async () => {
  const missingName = await handleJsonRpc({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      arguments: {}
    }
  });

  assert.match(missingName.error.message, /params.name/);
});
