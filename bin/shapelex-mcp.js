#!/usr/bin/env node

try {
  if (process.argv.includes("--doctor")) {
    const { renderDoctorReport, runDoctor } = await import("../dist/src/shapelex-doctor.js");
    const report = await runDoctor();
    console.log(renderDoctorReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } else {
    const { startMcpServer } = await import("../dist/src/mcp-server.js");
    startMcpServer();
  }
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    console.error("ShapeLex is not built yet. Run `npm install` and `npm run build`, then start ShapeLex again.");
    process.exit(1);
  }
  throw error;
}
