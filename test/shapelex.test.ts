import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ShapeLexEngine, charShape, fingerprintTokens } from "../src/shapelex.js";
import { createJsonRpcHandler, handleJsonRpc } from "../src/mcp-server.js";

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

test("stats report persistence strategy and configurable store limit", () => {
  const engine = new ShapeLexEngine({ storageDir: "local-store", maxStoreBytes: 2 * 1024 * 1024 });
  const stats = engine.stats();

  assert.equal(stats.persistence.enabled, true);
  assert.equal(stats.persistence.maxStoreBytes, 2 * 1024 * 1024);
  assert.equal(stats.persistence.strategy, "single-json-file");
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
      name: "shapelex_compress",
      arguments: {
        sessionId: "resources",
        mode: "text",
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
