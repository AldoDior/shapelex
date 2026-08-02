import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJsonRpcHandler, startMcpServer } from "../src/mcp-server.js";
import { ShapeLexEngine } from "../src/shapelex.js";
import { PACKAGE_VERSION } from "../src/version.js";

test("importing the MCP module does not create a persistent user store", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-import-"));
  const moduleUrl = pathToFileURL(path.resolve("dist/src/mcp-server.js")).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl)})`],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SHAPELEX_STORE_DIR: ".shapelex-import-test"
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".shapelex-import-test")), false);
});

test("MCP initialization reports the package version and honest resource capabilities", async () => {
  const handle = createJsonRpcHandler(new ShapeLexEngine());
  const response = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  });

  assert.equal(response.result.serverInfo.version, PACKAGE_VERSION);
  assert.equal(response.result.capabilities.resources.listChanged, false);
});

test("MCP maps invalid requests, unknown methods, and invalid parameters to standard JSON-RPC codes", async () => {
  const handle = createJsonRpcHandler(new ShapeLexEngine());

  const invalidRequest = await handle({ jsonrpc: "1.0", id: 1, method: "ping" });
  const missingMethod = await handle({ jsonrpc: "2.0", id: 2, method: "does/not/exist" });
  const invalidParams = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: []
  });

  assert.equal(invalidRequest.error.code, -32600);
  assert.equal(missingMethod.error.code, -32601);
  assert.equal(invalidParams.error.code, -32602);
});

test("MCP notifications do not produce responses", async () => {
  const handle = createJsonRpcHandler(new ShapeLexEngine());

  assert.equal(await handle({
    jsonrpc: "2.0",
    method: "notifications/initialized"
  }), undefined);
  assert.equal(await handle({
    jsonrpc: "2.0",
    method: "ping"
  }), undefined);
});

test("MCP runtime validation enforces schema enums, additional properties, and oneOf", async () => {
  const handle = createJsonRpcHandler(new ShapeLexEngine());
  const calls = [
    { text: "hello", sourcePath: "also.txt" },
    { text: "hello", unknown: true },
    { text: "hello", mode: "invalid" }
  ];

  for (const [index, args] of calls.entries()) {
    const response = await handle({
      jsonrpc: "2.0",
      id: index,
      method: "tools/call",
      params: {
        name: "shapelex_compress_text",
        arguments: args
      }
    });
    assert.equal(response.error.code, -32602);
  }

  const unavailableTool = await handle({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "shapelex_missing",
      arguments: {}
    }
  });
  assert.equal(unavailableTool.error.code, -32602);
});

test("MCP reports changed file-backed sources with the typed stale-source code", async (context) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-mcp-stale-"));
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const sourcePath = path.join(workspaceRoot, "source.txt");
  fs.writeFileSync(sourcePath, "The approved release number is 42 and must not change.", "utf8");
  const handle = createJsonRpcHandler(new ShapeLexEngine({ workspaceRoot }), {
    responseMode: "compatible"
  });

  const compressed = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "shapelex_compress_text",
      arguments: { sourcePath: "source.txt" }
    }
  });
  fs.writeFileSync(sourcePath, "The approved release number is 43 and must not change.", "utf8");

  const expanded = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "shapelex_expand",
      arguments: { handle: compressed.result.structuredContent.uri }
    }
  });

  assert.equal(expanded.error.code, -32002);
  assert.equal(expanded.error.message, "ShapeLex exact source is stale or unavailable.");
});

test("MCP stdio rejects oversized lines with bounded buffering and remains healthy", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputText = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    outputText += chunk;
  });
  const server = startMcpServer({
    input,
    output,
    maxLineCharacters: 64,
    targetEngine: new ShapeLexEngine({ persistent: false })
  });

  input.write(`${"x".repeat(128)}\n`);
  input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
  await server.closed;

  const responses = outputText.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(responses[0].error.code, -32600);
  assert.deepEqual(responses[1].result, {});
});
