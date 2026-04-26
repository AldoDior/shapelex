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
