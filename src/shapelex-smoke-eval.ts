import { createJsonRpcHandler } from "./mcp-server.js";
import { estimateTokens, ShapeLexEngine } from "./shapelex.js";

const sessionId = "smoke-coding-task";
const task = [
  "Implement the checkout validation change.",
  "Return the same concrete coding decision from either raw context or ShapeLex context."
].join(" ");

const facts = [
  {
    name: "manager approval threshold",
    pattern: /do not approve invoices over 5000 without manager approval/i
  },
  {
    name: "preserve retryCount on validation failure",
    pattern: /preserve retrycount when validation fails/i
  },
  {
    name: "uses existing validator",
    pattern: /validateinvoice\s*\(\s*input\s*,\s*policy\s*\)/i
  },
  {
    name: "manager approval error code",
    pattern: /manager_approval_required/i
  },
  {
    name: "never charge before validation",
    pattern: /never call chargecard before validation succeeds/i
  },
  {
    name: "keeps idempotencyKey behavior",
    pattern: /keep existing idempotencykey behavior/i
  }
];

const codingContext = [
  "File: src/checkout.ts",
  "Current behavior: validateInvoice(input, policy) runs before chargeCard.",
  "Requirement: Do not approve invoices over 5000 without manager approval.",
  "Requirement: Preserve retryCount when validation fails.",
  "Requirement: Return error code MANAGER_APPROVAL_REQUIRED.",
  "Requirement: Never call chargeCard before validation succeeds.",
  "Constraint: Keep existing idempotencyKey behavior.",
  "Test failure: expected MANAGER_APPROVAL_REQUIRED for invoice total 6500 and managerApproved=false.",
  "Noise: This legacy checkout module has many repeated comments about operational history. ".repeat(80),
  "Old note: The tax calculation path is unrelated to this change. ".repeat(40)
].join("\n");

export async function runSmokeEval() {
  const handleJsonRpc = createJsonRpcHandler(new ShapeLexEngine(), {
    responseMode: "compatible"
  });
  await callTool(handleJsonRpc, "shapelex_clear", { sessionId });

  const rawPrompt = [
    task,
    "Full context:",
    codingContext
  ].join("\n\n");

  const compressed = await callTool(handleJsonRpc, "shapelex_compress_text", {
    sessionId,
    label: "checkout-validation-context",
    mode: "code",
    text: codingContext
  });

  const context = await callTool(handleJsonRpc, "shapelex_context", {
    sessionId,
    query: "validateInvoice manager approval retryCount chargeCard idempotencyKey",
    mode: "code"
  });

  const shapeLexPrompt = [
    task,
    "ShapeLex compressed context:",
    compressed.compressedText,
    "Compact task context:",
    context.contextText
  ].join("\n\n");

  const rawDecision = decideImplementation(rawPrompt);
  const shapeLexDecision = decideImplementation(shapeLexPrompt);
  const rawFactCoverage = factCoverage(rawPrompt);
  const shapeLexFactCoverage = factCoverage(shapeLexPrompt);

  return {
    scenario: "checkout-validation-coding-task",
    raw: {
      tokenEstimate: estimateTokens(rawPrompt),
      factCoverage: rawFactCoverage,
      decision: rawDecision
    },
    shapeLex: {
      tokenEstimate: estimateTokens(shapeLexPrompt),
      compressionSkipped: compressed.compressionSkipped,
      savingsRatio: tokenSavings(estimateTokens(rawPrompt), estimateTokens(shapeLexPrompt)),
      factCoverage: shapeLexFactCoverage,
      decision: shapeLexDecision
    },
    comparison: {
      tokenDelta: estimateTokens(rawPrompt) - estimateTokens(shapeLexPrompt),
      sameDecision: JSON.stringify(rawDecision) === JSON.stringify(shapeLexDecision),
      sameFactCoverage: rawFactCoverage.coverage === shapeLexFactCoverage.coverage,
      passed: estimateTokens(shapeLexPrompt) < estimateTokens(rawPrompt)
        && JSON.stringify(rawDecision) === JSON.stringify(shapeLexDecision)
        && shapeLexFactCoverage.coverage === 1
    }
  };
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

function factCoverage(prompt: string) {
  const covered = facts.filter((fact) => fact.pattern.test(prompt)).map((fact) => fact.name);
  return {
    covered,
    missing: facts.filter((fact) => !covered.includes(fact.name)).map((fact) => fact.name),
    coverage: Number((covered.length / facts.length).toFixed(3))
  };
}

function decideImplementation(prompt: string) {
  const lower = prompt.toLowerCase();
  return {
    validateBeforeCharge: lower.includes("never call chargecard before validation succeeds"),
    approvalThreshold: lower.includes("over 5000"),
    approvalErrorCode: lower.includes("manager_approval_required"),
    preservesRetryCount: lower.includes("preserve retrycount"),
    usesExistingValidator: lower.includes("validateinvoice(input, policy)"),
    keepsIdempotencyKey: lower.includes("idempotencykey")
  };
}

function tokenSavings(rawTokens: number, compressedTokens: number) {
  if (rawTokens === 0) {
    return 0;
  }
  return Number((1 - compressedTokens / rawTokens).toFixed(4));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = await runSmokeEval();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.comparison.passed ? 0 : 1;
}
