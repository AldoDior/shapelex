import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const testDir = path.resolve("dist/test");
const profile = process.env.SHAPELEX_TEST_PROFILE ?? "default";
const testFiles = collectTestFiles(testDir)
  .filter((file) => profile === "nightly" || !file.endsWith(".nightly.test.js"))
  .sort();

if (testFiles.length === 0) {
  console.error(`No compiled test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

process.exitCode = result.status ?? 1;

function collectTestFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTestFiles(target);
    }
    return entry.isFile() && entry.name.endsWith(".test.js") ? [target] : [];
  });
}
