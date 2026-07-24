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
    assert.equal(shapelex.env.SHAPELEX_MAX_STORE_MB, "100");
    assert.match(shapelex.env.SHAPELEX_STORE_DIR, /^\.shapelex-/);
  }
});

test("package metadata is ready for public npm and GitHub", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.repository.type, "git");
  assert.equal(packageJson.repository.url, "git+https://github.com/AldoDior/shapelex.git");
  assert.equal(packageJson.bugs.url, "https://github.com/AldoDior/shapelex/issues");
  assert.equal(packageJson.publishConfig.access, "public");
  assert.ok(packageJson.files.includes("CHANGELOG.md"));
  assert.ok(packageJson.files.includes("CONTRIBUTING.md"));
});
