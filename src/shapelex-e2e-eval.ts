import { createJsonRpcHandler } from "./mcp-server.js";
import { estimateTokens, ShapeLexEngine } from "./shapelex.js";

type Scenario = {
  name: string;
  sessionId: string;
  task: string;
  context: string;
  query: string;
  requiredFacts: Array<{ name: string; pattern: RegExp }>;
  generateCode: (prompt: string) => string;
  qualityChecks: Array<{ name: string; check: (code: string) => boolean }>;
};

const scenarios: Scenario[] = [
  {
    name: "checkout-validation",
    sessionId: "e2e-checkout-validation",
    task: "Implement the checkout validation helper from the provided project context.",
    context: [
      "File: src/checkout.ts",
      "Existing public function name must be validateCheckout.",
      "Current behavior: validateInvoice(input, policy) must run before chargeCard.",
      "Requirement: Do not approve invoices over 5000 without manager approval.",
      "Requirement: Preserve retryCount when validation fails.",
      "Requirement: Return error code MANAGER_APPROVAL_REQUIRED.",
      "Requirement: Never call chargeCard before validation succeeds.",
      "Constraint: Keep existing idempotencyKey behavior.",
      "Test failure: expected MANAGER_APPROVAL_REQUIRED for invoice total 6500 and managerApproved=false.",
      noisyText("Legacy checkout operational note", 90),
      noisyText("Tax calculation is unrelated to this task", 45)
    ].join("\n"),
    query: "validateCheckout manager approval retryCount chargeCard idempotencyKey",
    requiredFacts: [
      { name: "function name", pattern: /validateCheckout/i },
      { name: "manager approval threshold", pattern: /over 5000 without manager approval/i },
      { name: "retry count preservation", pattern: /preserve retryCount when validation fails/i },
      { name: "error code", pattern: /MANAGER_APPROVAL_REQUIRED/i },
      { name: "charge after validation", pattern: /never call chargeCard before validation succeeds/i },
      { name: "idempotency key", pattern: /idempotencyKey/i }
    ],
    generateCode: generateCheckoutCode,
    qualityChecks: [
      { name: "exports validateCheckout", check: (code) => /function validateCheckout/.test(code) },
      { name: "uses manager approval threshold", check: (code) => /total > 5000/.test(code) },
      { name: "uses required error code", check: (code) => /MANAGER_APPROVAL_REQUIRED/.test(code) },
      { name: "preserves retryCount", check: (code) => /retryCount: input\.retryCount/.test(code) },
      { name: "keeps idempotencyKey", check: (code) => /idempotencyKey: input\.idempotencyKey/.test(code) },
      { name: "charges only after validation", check: (code) => code.indexOf("validateInvoice") < code.indexOf("chargeCard") }
    ]
  },
  {
    name: "rate-limit-policy",
    sessionId: "e2e-rate-limit-policy",
    task: "Implement a rate limit policy helper from the provided project context.",
    context: [
      "File: src/rate-limit.ts",
      "Existing public function name must be applyRateLimitPolicy.",
      "Requirement: Free users get 100 requests per hour.",
      "Requirement: Pro users get 1000 requests per hour.",
      "Requirement: Enterprise users get 10000 requests per hour.",
      "Requirement: Unknown plans must use the free limit.",
      "Requirement: Never reduce admin users below 5000 requests per hour.",
      "Constraint: Return an object with limit, windowSeconds, and reason.",
      "Constraint: windowSeconds must be 3600.",
      noisyText("Old billing migration note", 70),
      noisyText("Dashboard chart colors are unrelated", 55)
    ].join("\n"),
    query: "applyRateLimitPolicy free pro enterprise admin windowSeconds",
    requiredFacts: [
      { name: "function name", pattern: /applyRateLimitPolicy/i },
      { name: "free limit", pattern: /free users get 100 requests per hour/i },
      { name: "pro limit", pattern: /pro users get 1000 requests per hour/i },
      { name: "enterprise limit", pattern: /enterprise users get 10000 requests per hour/i },
      { name: "admin floor", pattern: /never reduce admin users below 5000/i },
      { name: "window seconds", pattern: /windowSeconds must be 3600/i }
    ],
    generateCode: generateRateLimitCode,
    qualityChecks: [
      { name: "exports applyRateLimitPolicy", check: (code) => /function applyRateLimitPolicy/.test(code) },
      { name: "sets free limit", check: (code) => /free: 100/.test(code) },
      { name: "sets pro limit", check: (code) => /pro: 1000/.test(code) },
      { name: "sets enterprise limit", check: (code) => /enterprise: 10000/.test(code) },
      { name: "uses admin floor", check: (code) => /Math\.max\(limit, 5000\)/.test(code) },
      { name: "returns 3600 window", check: (code) => /windowSeconds: 3600/.test(code) }
    ]
  },
  {
    name: "migration-plan-parser",
    sessionId: "e2e-migration-plan-parser",
    task: "Implement a migration plan parser from the provided project context.",
    context: [
      "File: src/migration-plan.ts",
      "Existing public function name must be parseMigrationPlan.",
      "Requirement: Lines beginning with TODO become todos.",
      "Requirement: Lines beginning with BLOCKED become blockers.",
      "Requirement: Lines beginning with DONE become completed.",
      "Requirement: Ignore blank lines and comment lines beginning with #.",
      "Requirement: Preserve original line numbers in every returned item.",
      "Constraint: Return { todos, blockers, completed }.",
      "Constraint: Do not throw on unknown prefixes; ignore them.",
      noisyText("Historical migration meeting notes", 85),
      noisyText("Deprecated command output unrelated to parser", 50)
    ].join("\n"),
    query: "parseMigrationPlan TODO BLOCKED DONE line numbers ignore comments",
    requiredFacts: [
      { name: "function name", pattern: /parseMigrationPlan/i },
      { name: "todos", pattern: /TODO become todos/i },
      { name: "blockers", pattern: /BLOCKED become blockers/i },
      { name: "completed", pattern: /DONE become completed/i },
      { name: "line numbers", pattern: /Preserve original line numbers/i },
      { name: "ignore unknown", pattern: /Do not throw on unknown prefixes/i }
    ],
    generateCode: generateMigrationParserCode,
    qualityChecks: [
      { name: "exports parseMigrationPlan", check: (code) => /function parseMigrationPlan/.test(code) },
      { name: "tracks todos", check: (code) => /todos\.push/.test(code) },
      { name: "tracks blockers", check: (code) => /blockers\.push/.test(code) },
      { name: "tracks completed", check: (code) => /completed\.push/.test(code) },
      { name: "preserves line numbers", check: (code) => /lineNumber: index \+ 1/.test(code) },
      { name: "ignores comments", check: (code) => /trimmed\.startsWith\("#"\)/.test(code) }
    ]
  }
];

export async function runE2EEval() {
  const handleJsonRpc = createJsonRpcHandler(new ShapeLexEngine());
  const fullToolSchemaTokens = await toolSchemaTokens("full");
  const results = [];

  for (const scenario of scenarios) {
    await callTool(handleJsonRpc, "shapelex_clear", { sessionId: scenario.sessionId });
    const rawPrompt = renderRawPrompt(scenario);
    const compressed = await callTool(handleJsonRpc, "shapelex_compress_text", {
      sessionId: scenario.sessionId,
      label: scenario.name,
      mode: "code",
      text: scenario.context
    });
    const context = await callTool(handleJsonRpc, "shapelex_context", {
      sessionId: scenario.sessionId,
      query: scenario.query,
      mode: "code"
    });
    const shapeLexPrompt = renderShapeLexPrompt(scenario, compressed, context);

    const rawCode = scenario.generateCode(rawPrompt);
    const shapeLexCode = scenario.generateCode(shapeLexPrompt);
    const rawQuality = qualityScore(rawCode, scenario);
    const shapeLexQuality = qualityScore(shapeLexCode, scenario);
    const rawTokens = estimateTokens(rawPrompt);
    const shapeLexTokens = estimateTokens(shapeLexPrompt);

    results.push({
      scenario: scenario.name,
      raw: {
        promptTokens: rawTokens,
        factCoverage: factCoverage(rawPrompt, scenario),
        quality: rawQuality,
        code: rawCode
      },
      shapeLex: {
        promptTokens: shapeLexTokens,
        compressionSkipped: compressed.compressionSkipped,
        factCoverage: factCoverage(shapeLexPrompt, scenario),
        quality: shapeLexQuality,
        code: shapeLexCode
      },
      comparison: {
        tokenDelta: rawTokens - shapeLexTokens,
        savingsRatio: tokenSavings(rawTokens, shapeLexTokens),
        fullModeLoadedTokens: shapeLexTokens + fullToolSchemaTokens,
        fullModeLoadedSavingsRatio: tokenSavings(rawTokens, shapeLexTokens + fullToolSchemaTokens),
        sameQualityScore: rawQuality.score === shapeLexQuality.score,
        shapeLexQualityMatchesRaw: shapeLexQuality.score >= rawQuality.score,
        passed: shapeLexTokens < rawTokens
          && shapeLexTokens + fullToolSchemaTokens < rawTokens
          && shapeLexQuality.score >= rawQuality.score
          && factCoverage(shapeLexPrompt, scenario).coverage === 1
      }
    });
  }

  const passed = results.every((result) => result.comparison.passed);
  return {
    type: "shapelex-e2e-ai-workflow-simulation",
    note: "This simulates the two-agent workflow without calling a live model. It compares prompt size, retained facts, and generated code quality checks.",
    summary: {
      scenarios: results.length,
      passed,
      totalRawPromptTokens: sum(results.map((result) => result.raw.promptTokens)),
      totalShapeLexPromptTokens: sum(results.map((result) => result.shapeLex.promptTokens)),
      fullToolSchemaTokens,
      totalFullModeLoadedTokens: sum(results.map((result) => result.comparison.fullModeLoadedTokens)),
      totalTokenDelta: sum(results.map((result) => result.comparison.tokenDelta)),
      averageSavingsRatio: average(results.map((result) => result.comparison.savingsRatio)),
      averageFullModeLoadedSavingsRatio: average(results.map((result) => result.comparison.fullModeLoadedSavingsRatio)),
      averageRawQuality: average(results.map((result) => result.raw.quality.score)),
      averageShapeLexQuality: average(results.map((result) => result.shapeLex.quality.score))
    },
    results
  };
}

async function toolSchemaTokens(toolset: "lean" | "full") {
  const handleJsonRpc = createJsonRpcHandler(new ShapeLexEngine({ persistent: false }), { toolset });
  const list = await handleJsonRpc({ jsonrpc: "2.0", id: `schema-${toolset}`, method: "tools/list" });
  return estimateTokens(JSON.stringify(list.result.tools));
}

function renderRawPrompt(scenario: Scenario) {
  return [
    "You are in a brand new coding session without ShapeLex.",
    scenario.task,
    "Use the full project context below.",
    scenario.context
  ].join("\n\n");
}

function renderShapeLexPrompt(scenario: Scenario, compressed: any, context: any) {
  return [
    "You are in a brand new coding session using ShapeLex.",
    scenario.task,
    "Use the compact ShapeLex context below. Expand handles only if exact wording is required.",
    compressed.compressedText,
    context.contextText
  ].join("\n\n");
}

async function callTool(handleJsonRpc: (request: any) => Promise<any>, name: string, args: any) {
  const response = await handleJsonRpc({
    jsonrpc: "2.0",
    id: `${name}-${Date.now()}-${Math.random()}`,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });

  if (response.error) {
    throw new Error(response.error.message);
  }
  return response.result.structuredContent;
}

function factCoverage(prompt: string, scenario: Scenario) {
  const covered = scenario.requiredFacts
    .filter((fact) => fact.pattern.test(prompt))
    .map((fact) => fact.name);
  return {
    covered,
    missing: scenario.requiredFacts
      .filter((fact) => !covered.includes(fact.name))
      .map((fact) => fact.name),
    coverage: Number((covered.length / scenario.requiredFacts.length).toFixed(3))
  };
}

function qualityScore(code: string, scenario: Scenario) {
  const checks = scenario.qualityChecks.map((item) => ({
    name: item.name,
    passed: item.check(code)
  }));
  const passed = checks.filter((check) => check.passed).length;
  return {
    score: Number((passed / checks.length).toFixed(3)),
    passed,
    total: checks.length,
    checks
  };
}

function generateCheckoutCode(prompt: string) {
  const threshold = /over 5000/i.test(prompt) ? 5000 : 1000;
  const errorCode = /MANAGER_APPROVAL_REQUIRED/.test(prompt)
    ? "MANAGER_APPROVAL_REQUIRED"
    : "VALIDATION_FAILED";
  const preserveRetry = /preserve retryCount/i.test(prompt);
  const keepIdempotency = /idempotencyKey/i.test(prompt);

  return [
    "export function validateCheckout(input, policy) {",
    "  const validation = validateInvoice(input, policy);",
    "  if (!validation.ok) {",
    `    return { ok: false, errorCode: validation.errorCode${preserveRetry ? ", retryCount: input.retryCount" : ""} };`,
    "  }",
    `  if (input.total > ${threshold} && !input.managerApproved) {`,
    `    return { ok: false, errorCode: "${errorCode}"${preserveRetry ? ", retryCount: input.retryCount" : ""} };`,
    "  }",
    "  const charge = chargeCard(input);",
    `  return { ok: true, charge${keepIdempotency ? ", idempotencyKey: input.idempotencyKey" : ""} };`,
    "}"
  ].join("\n");
}

function generateRateLimitCode(prompt: string) {
  const free = /100 requests per hour/i.test(prompt) ? 100 : 50;
  const pro = /1000 requests per hour/i.test(prompt) ? 1000 : 500;
  const enterprise = /10000 requests per hour/i.test(prompt) ? 10000 : 5000;
  const adminFloor = /below 5000/i.test(prompt);

  return [
    "export function applyRateLimitPolicy(user) {",
    `  const limits = { free: ${free}, pro: ${pro}, enterprise: ${enterprise} };`,
    "  const plan = user.plan || \"free\";",
    "  let limit = limits[plan] ?? limits.free;",
    `  if (user.isAdmin) limit = ${adminFloor ? "Math.max(limit, 5000)" : "limit"};`,
    "  return { limit, windowSeconds: 3600, reason: `plan:${plan}` };",
    "}"
  ].join("\n");
}

function generateMigrationParserCode(prompt: string) {
  const preserveLineNumbers = /line numbers/i.test(prompt);
  return [
    "export function parseMigrationPlan(text) {",
    "  const todos = [];",
    "  const blockers = [];",
    "  const completed = [];",
    "  const lines = String(text ?? \"\").split(\"\\n\");",
    "  lines.forEach((line, index) => {",
    "    const trimmed = line.trim();",
    "    if (!trimmed || trimmed.startsWith(\"#\")) return;",
    `    const item = { text: trimmed.replace(/^(TODO|BLOCKED|DONE):?\\s*/, \"\")${preserveLineNumbers ? ", lineNumber: index + 1" : ""} };`,
    "    if (trimmed.startsWith(\"TODO\")) todos.push(item);",
    "    if (trimmed.startsWith(\"BLOCKED\")) blockers.push(item);",
    "    if (trimmed.startsWith(\"DONE\")) completed.push(item);",
    "  });",
    "  return { todos, blockers, completed };",
    "}"
  ].join("\n");
}

function noisyText(label: string, repeats: number) {
  return Array.from({ length: repeats }, (_, index) => `${label} ${index + 1}: keep for historical context only.`).join("\n");
}

function tokenSavings(rawTokens: number, compressedTokens: number) {
  if (rawTokens === 0) {
    return 0;
  }
  return Number((1 - compressedTokens / rawTokens).toFixed(4));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((sum(values) / values.length).toFixed(3));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = await runE2EEval();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.summary.passed ? 0 : 1;
}
