import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DISALLOWED_TRACKED_PREFIXES = [
  ".npm-cache/",
  ".shapelex/",
  ".shapelex-codex/",
  ".shapelex-cursor/",
  ".shapelex-claude/",
  ".shapelex-evals/",
  ".stryker-tmp/",
  "coverage/",
  "dist/",
  "node_modules/"
];

const DISALLOWED_TRACKED_FILES = [
  ".env",
  ".env.local",
  ".npmrc"
];

const DISALLOWED_TRACKED_SUFFIXES = [
  ".log",
  ".tgz"
];

const REQUIRED_PACKAGE_FILES = [
  "bin/",
  "docs/",
  "dist/src/fingerprint/*.d.ts",
  "dist/src/fingerprint/*.js",
  "dist/src/mcp-server.d.ts",
  "dist/src/mcp-server.js",
  "dist/src/shapelex-doctor.d.ts",
  "dist/src/shapelex-doctor.js",
  "dist/src/shapelex.d.ts",
  "dist/src/shapelex.js",
  "dist/src/storage/*.d.ts",
  "dist/src/storage/*.js",
  "dist/src/version.d.ts",
  "dist/src/version.js",
  "skills/",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md"
];

const DISALLOWED_PACKAGE_FILES = [
  "dist/src/**/*.d.ts",
  "dist/src/**/*.js",
  "dist/src/release-lint.d.ts",
  "dist/src/release-lint.js",
  "dist/src/run-tests.d.ts",
  "dist/src/run-tests.js",
  "dist/src/shapelex-agent-adoption-eval.d.ts",
  "dist/src/shapelex-agent-adoption-eval.js",
  "dist/src/shapelex-benchmark.d.ts",
  "dist/src/shapelex-benchmark.js",
  "dist/src/shapelex-e2e-eval.d.ts",
  "dist/src/shapelex-e2e-eval.js",
  "dist/src/shapelex-provider-ab-eval.d.ts",
  "dist/src/shapelex-provider-ab-eval.js",
  "dist/src/provider-ab.d.ts",
  "dist/src/provider-ab.js",
  "dist/src/protocol-ledger.d.ts",
  "dist/src/protocol-ledger.js",
  "dist/src/shapelex-smoke-eval.d.ts",
  "dist/src/shapelex-smoke-eval.js"
];

const SECRET_OR_LOCAL_PATTERNS = [
  { name: "GitHub classic token", pattern: /ghp_[A-Za-z0-9_]{20,}/ },
  { name: "GitHub fine-grained token", pattern: /github_pat_[A-Za-z0-9_]+/ },
  { name: "npm access token", pattern: /npm_[A-Za-z0-9]{20,}/ },
  { name: "OpenAI-style API key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private key block", pattern: /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/ },
  { name: "personal Windows user path", pattern: /C:\\Users\\[A-Za-z0-9._-]+/i },
  { name: "personal AppData path", pattern: /AppData\\(?:Local|Roaming)/i },
  {
    name: "workspace drive path",
    pattern: /[A-Z]:\\(?:Users\\|[^\\\r\n]+\\(?:Desktop|Documents|Downloads|Escritorio|Documentos)\\)/i
  }
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs", ".css", ".js", ".json", ".md", ".mjs", ".toml", ".ts", ".txt", ".yaml", ".yml"
]);

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }
)
  .split(/\r?\n/)
  .filter(Boolean)
  .sort();

const failures: string[] = [];

checkTrackedFiles();
checkPackageMetadata();
checkTextFiles();

if (failures.length > 0) {
  console.error("ShapeLex release lint failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ShapeLex release lint passed (${repositoryFiles.length} repository files checked).`);

function checkTrackedFiles() {
  for (const file of repositoryFiles) {
    const normalized = file.replace(/\\/g, "/");
    if (DISALLOWED_TRACKED_FILES.includes(normalized)) {
      failures.push(`Do not track local or credential-bearing file: ${file}`);
    }
    if (DISALLOWED_TRACKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
      failures.push(`Do not track generated artifact: ${file}`);
    }
    if (DISALLOWED_TRACKED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      failures.push(`Do not track generated/private path: ${file}`);
    }
    if (normalized.startsWith("research/") && normalized !== "research/README.md") {
      failures.push(`Do not track private research notes: ${file}`);
    }
  }
}

function checkPackageMetadata() {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!packageJson.files.includes(required)) {
      failures.push(`package.json files allowlist is missing ${required}`);
    }
  }
  for (const disallowed of DISALLOWED_PACKAGE_FILES) {
    if (packageJson.files.includes(disallowed)) {
      failures.push(`package.json files allowlist must not ship development file or glob ${disallowed}`);
    }
  }
  if (packageJson.repository?.url !== "git+https://github.com/AldoDior/shapelex.git") {
    failures.push("package.json repository URL should use the canonical public repo URL.");
  }
  if (packageJson.bugs?.url !== "https://github.com/AldoDior/shapelex/issues") {
    failures.push("package.json bugs URL should use the canonical public repo URL.");
  }
}

function checkTextFiles() {
  for (const file of repositoryFiles) {
    if (!TEXT_FILE_EXTENSIONS.has(path.extname(file))) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);

    for (const item of SECRET_OR_LOCAL_PATTERNS) {
      if (item.pattern.test(text)) {
        failures.push(`${item.name} found in ${file}`);
      }
    }

    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        failures.push(`Trailing whitespace in ${file}:${index + 1}`);
      }
    });
  }
}
