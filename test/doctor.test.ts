import assert from "node:assert/strict";
import test from "node:test";
import { renderDoctorReport, runDoctor } from "../src/shapelex-doctor.js";

test("doctor validates cross-platform setup requirements", async () => {
  const report = await runDoctor();
  const rendered = renderDoctorReport(report);

  assert.equal(report.ok, true);
  assert.match(rendered, /ShapeLex doctor/);
  assert.ok(report.checks.some((check) => check.name === "node-version" && check.ok));
  assert.ok(report.checks.some((check) => check.name === "default-lean-toolset" && check.ok));
  assert.ok(report.checks.some((check) => check.name === ".cursor/mcp.json" && check.ok));
  assert.ok(report.checks.some((check) => check.name === ".mcp.json" && check.ok));
});
