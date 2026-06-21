import assert from "node:assert/strict";
import test from "node:test";
import { ShapeLexEngine, charShape, fingerprintTokens } from "../src/shapelex.js";
import { handleJsonRpc } from "../src/mcp-server.js";

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
