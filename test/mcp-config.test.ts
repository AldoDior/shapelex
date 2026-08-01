import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const configPaths = [
  ".cursor/mcp.json",
  ".mcp.json"
];

test("shared MCP configs use lean ShapeLex toolset and private local stores", () => {
  for (const configPath of configPaths) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const shapelex = config.mcpServers?.shapelex;

    assert.equal(shapelex.command, "node");
    assert.deepEqual(shapelex.args, ["./bin/shapelex-mcp.js"]);
    assert.equal(shapelex.env.SHAPELEX_TOOLSET, "lean");
    assert.equal(shapelex.env.SHAPELEX_RESPONSE_MODE, "content-only");
    assert.equal(shapelex.env.SHAPELEX_MAX_STORE_MB, "100");
    assert.match(shapelex.env.SHAPELEX_STORE_DIR, /^\.shapelex-/);
  }
});

test("package metadata is ready for public npm and GitHub", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const requiredRuntimeFiles = [
    "dist/src/mcp-server.d.ts",
    "dist/src/mcp-server.js",
    "dist/src/shapelex-doctor.d.ts",
    "dist/src/shapelex-doctor.js",
    "dist/src/shapelex.d.ts",
    "dist/src/shapelex.js"
  ];

  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.repository.type, "git");
  assert.equal(packageJson.repository.url, "git+https://github.com/AldoDior/shapelex.git");
  assert.equal(packageJson.bugs.url, "https://github.com/AldoDior/shapelex/issues");
  assert.equal(packageJson.publishConfig.access, "public");
  assert.ok(packageJson.files.includes("CHANGELOG.md"));
  assert.ok(packageJson.files.includes("CONTRIBUTING.md"));
  for (const runtimeFile of requiredRuntimeFiles) {
    assert.ok(packageJson.files.includes(runtimeFile), runtimeFile);
  }
  assert.equal(packageJson.files.includes("dist/src/**/*.d.ts"), false);
  assert.equal(packageJson.files.includes("dist/src/**/*.js"), false);
});

test("agent instructions make ShapeLex agent-driven while keeping manual fallback", () => {
  const docs = [
    "docs/AGENT_INSTRUCTIONS.md",
    "docs/AGENT_SETUP_PROMPT.md",
    "docs/cursor-rule.md",
    "skills/shapelex-memory/SKILL.md",
    "README.md",
    "docs/USAGE.md",
    "docs/USAGE.es.md"
  ];

  for (const docPath of docs) {
    const text = fs.readFileSync(docPath, "utf8");
    assert.match(text, /agent-driven|guiado por el agente|proactivamente|proactively/i, docPath);
  }

  const agentInstructions = fs.readFileSync("docs/AGENT_INSTRUCTIONS.md", "utf8");
  assert.match(agentInstructions, /do not wait/i);
  assert.match(agentInstructions, /Manual commands/i);
  assert.match(agentInstructions, /Recommend lean mode/i);
  assert.match(agentInstructions, /Suggest full mode/i);
  assert.match(agentInstructions, /Suggest a new readable `sessionId`/i);
  assert.match(agentInstructions, /preview cleanup first/i);
  assert.match(agentInstructions, /No esperes/i);
  assert.match(agentInstructions, /comandos manuales/i);
  assert.match(agentInstructions, /Recomienda el modo lean/i);
  assert.match(agentInstructions, /Sugiere el modo full/i);
  assert.match(agentInstructions, /pide permiso antes de borrar memoria/i);
});
