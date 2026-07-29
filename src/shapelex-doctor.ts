import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createJsonRpcHandler } from "./mcp-server.js";
import { ShapeLexEngine } from "./shapelex.js";
import { PACKAGE_VERSION } from "./version.js";

type Check = {
  name: string;
  ok: boolean;
  message: string;
};

const EXPECTED_LEAN_TOOLS = [
  "shapelex_compress_messages",
  "shapelex_compress_text",
  "shapelex_expand",
  "shapelex_context",
  "shapelex_memory_overview",
  "shapelex_clear",
  "shapelex_prune"
];

const MCP_CONFIGS = [
  { path: ".codex/config.toml", store: ".shapelex-codex" },
  { path: ".cursor/mcp.json", store: ".shapelex-cursor" },
  { path: ".mcp.json", store: ".shapelex-claude" }
];

export async function runDoctor({ cwd = process.cwd() } = {}) {
  const checks: Check[] = [];
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const sourceCheckout = samePath(cwd, packageRoot) && fs.existsSync(path.join(packageRoot, "src"));

  checks.push(checkNodeVersion());
  checks.push(checkPackageVersion(packageRoot));
  checks.push(checkFile(packageRoot, "bin/shapelex-mcp.js", "MCP executable exists"));
  checks.push(checkFile(packageRoot, "dist/src/mcp-server.js", "compiled MCP server exists"));
  if (sourceCheckout) {
    checks.push(checkGitignore(cwd));
    checks.push(...checkMcpConfigs(cwd));
  }
  checks.push(await checkLeanToolset());

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    version: PACKAGE_VERSION,
    mode: sourceCheckout ? "source-checkout" : "installed-package",
    platform: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version
    },
    checks,
    nextSteps: ok
      ? [
        sourceCheckout
          ? "Start the MCP server with node ./bin/shapelex-mcp.js, or use the included Codex/Cursor/Claude project configs."
          : "Start the installed MCP server with shapelex-mcp, or configure your client to run npx -y shapelex-mcp.",
        "ShapeLex defaults to the lean toolset. Set SHAPELEX_TOOLSET=full only when you need the compact inspect tool."
      ]
      : [
        "Run npm install, then npm run build, then npm run doctor.",
        "If a tool cannot find ShapeLex, prefer node ./bin/shapelex-mcp.js or npx -y shapelex-mcp over shell-specific launchers."
      ]
  };
}

export function renderDoctorReport(report: Awaited<ReturnType<typeof runDoctor>>) {
  const lines = [
    "ShapeLex doctor",
    `Version: ${report.version}`,
    `Mode: ${report.mode}`,
    `Platform: ${report.platform.os} ${report.platform.arch}`,
    `Node: ${report.platform.node}`,
    ""
  ];

  for (const check of report.checks) {
    lines.push(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.message}`);
  }

  lines.push("");
  lines.push(report.ok ? "Result: ready" : "Result: needs attention");
  lines.push("Next:");
  for (const step of report.nextSteps) {
    lines.push(`- ${step}`);
  }

  return lines.join("\n");
}

function checkNodeVersion(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "node-version",
    ok: major >= 22,
    message: major >= 22
      ? "Node.js is supported."
      : "Node.js 22 or newer is required."
  };
}

function checkPackageVersion(packageRoot: string): Check {
  const packagePath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return {
      name: "package-version",
      ok: false,
      message: "Package metadata is missing."
    };
  }
  const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const ok = manifest.version === PACKAGE_VERSION;
  return {
    name: "package-version",
    ok,
    message: ok
      ? `Package and runtime agree on ShapeLex ${PACKAGE_VERSION}.`
      : `Package version ${String(manifest.version)} does not match runtime ${PACKAGE_VERSION}.`
  };
}

function checkFile(cwd: string, relativePath: string, message: string): Check {
  const exists = fs.existsSync(path.join(cwd, relativePath));
  return {
    name: relativePath,
    ok: exists,
    message: exists ? message : `${relativePath} is missing. Run npm run build if this is a source checkout.`
  };
}

function checkGitignore(cwd: string): Check {
  const gitignorePath = path.join(cwd, ".gitignore");
  const text = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const missing = [".shapelex/", ".shapelex-codex/", ".shapelex-cursor/", ".shapelex-claude/"]
    .filter((entry) => !text.includes(entry));

  return {
    name: "private-store-ignore",
    ok: missing.length === 0,
    message: missing.length === 0
      ? "Local ShapeLex stores are ignored by git. ShapeLex also auto-adds .shapelex* store folders when it starts in a git repo."
      : `Missing gitignore entries: ${missing.join(", ")}`
  };
}

function checkMcpConfigs(cwd: string): Check[] {
  return MCP_CONFIGS.map((config) => {
    const filePath = path.join(cwd, config.path);
    if (!fs.existsSync(filePath)) {
      return {
        name: config.path,
        ok: false,
        message: "Config file is missing."
      };
    }

    const text = fs.readFileSync(filePath, "utf8");
    const ok = text.includes("SHAPELEX_TOOLSET")
      && text.includes("lean")
      && text.includes(config.store)
      && text.includes("SHAPELEX_MAX_STORE_MB");

    return {
      name: config.path,
      ok,
      message: ok
        ? "Config uses lean toolset and a private local store."
        : "Config should set SHAPELEX_TOOLSET=lean, SHAPELEX_MAX_STORE_MB, and a private .shapelex-* store."
    };
  });
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = fs.realpathSync.native(path.resolve(left));
  const resolvedRight = fs.realpathSync.native(path.resolve(right));
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

async function checkLeanToolset(): Promise<Check> {
  const handle = createJsonRpcHandler(new ShapeLexEngine({ persistent: false }));
  const response = await handle({ jsonrpc: "2.0", id: "doctor-tools", method: "tools/list" });
  const names = response.result.tools.map((tool) => tool.name);
  const ok = JSON.stringify(names) === JSON.stringify(EXPECTED_LEAN_TOOLS);

  return {
    name: "default-lean-toolset",
    ok,
    message: ok
      ? `Lean mode exposes ${names.length} core tools.`
      : `Unexpected lean tool list: ${names.join(", ")}`
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = await runDoctor();
  console.log(renderDoctorReport(report));
  process.exitCode = report.ok ? 0 : 1;
}
