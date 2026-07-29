import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderDoctorReport, runDoctor } from "../src/shapelex-doctor.js";

test("doctor validates cross-platform setup requirements", async () => {
  const report = await runDoctor();
  const rendered = renderDoctorReport(report);

  assert.equal(report.ok, true);
  assert.equal(report.version, "0.6.0");
  assert.equal(report.mode, "source-checkout");
  assert.match(rendered, /ShapeLex doctor/);
  assert.match(rendered, /Version: 0\.6\.0/);
  assert.ok(report.checks.some((check) => check.name === "node-version" && check.ok));
  assert.ok(report.checks.some((check) => check.name === "default-lean-toolset" && check.ok));
  assert.ok(report.checks.some((check) => check.name === ".cursor/mcp.json" && check.ok));
  assert.ok(report.checks.some((check) => check.name === ".mcp.json" && check.ok));
});

test("doctor validates an installed package without requiring project config files", async (context) => {
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-doctor-consumer-"));
  context.after(() => fs.rmSync(consumerRoot, { recursive: true, force: true }));

  const report = await runDoctor({ cwd: consumerRoot });

  assert.equal(report.ok, true);
  assert.equal(report.mode, "installed-package");
  assert.ok(report.checks.some((check) => check.name === "package-version" && check.ok));
  assert.equal(report.checks.some((check) => check.name === ".cursor/mcp.json"), false);
});
