import process from "node:process";
import { createJsonRpcHandler } from "./mcp-server.js";
import { estimateTokens, ShapeLexEngine } from "./shapelex.js";

type AgentScenario = {
  name: string;
  userPrompt: string;
  context: string;
  expectedUsesShapeLex: boolean;
  expectedTool?: "shapelex_compress_text" | "shapelex_compress_messages" | "shapelex_context";
  expectedSuggestions?: string[];
};

type AgentDecision = {
  usesShapeLex: boolean;
  plannedTools: string[];
  suggestions: string[];
  userNotice: string | null;
  reason: string;
  rawPromptTokens: number;
  estimatedAfterShapeLexTokens: number;
  estimatedSavingsRatio: number;
};

const scenarios: AgentScenario[] = [
  {
    name: "long-pasted-project-context",
    userPrompt: "Please implement the checkout validation helper from this project context.",
    context: [
      "File: src/checkout.ts",
      "Existing public function name must be validateCheckout.",
      "Requirement: Do not approve invoices over 5000 without manager approval.",
      "Requirement: Preserve retryCount when validation fails.",
      noisyText("Legacy checkout operational note", 120)
    ].join("\n"),
    expectedUsesShapeLex: true,
    expectedTool: "shapelex_compress_text",
    expectedSuggestions: ["lean"]
  },
  {
    name: "repeated-old-chat-history",
    userPrompt: "Continue from the earlier decisions and make the next code change.",
    context: [
      "user: We decided not to delete local memory automatically.",
      "assistant: I will preserve exact sx:// expansion for sensitive details.",
      "user: Keep responses brief and spend tokens on code and tests.",
      noisyText("older conversation turn", 90)
    ].join("\n"),
    expectedUsesShapeLex: true,
    expectedTool: "shapelex_compress_messages",
    expectedSuggestions: ["cleanup-preview"]
  },
  {
    name: "short-one-off-question",
    userPrompt: "What command runs the tests?",
    context: "package.json has a test script named npm test.",
    expectedUsesShapeLex: false,
    expectedSuggestions: ["lean"]
  },
  {
    name: "memory-reuse-needed",
    userPrompt: "Use the earlier ShapeLex project requirements before changing docs.",
    context: "The user references earlier project requirements but did not paste them again.",
    expectedUsesShapeLex: true,
    expectedTool: "shapelex_context",
    expectedSuggestions: ["lean"]
  },
  {
    name: "project-switch-needs-new-session",
    userPrompt: "Now switch from the checkout app to a new CRM portal repo and plan the first change.",
    context: "This is a different repo, client, and task than the previous memory session.",
    expectedUsesShapeLex: true,
    expectedTool: "shapelex_context",
    expectedSuggestions: ["session-switch", "lean"]
  },
  {
    name: "deep-memory-inspection-needs-full",
    userPrompt: "I need deeper ShapeLex memory stats and risk details before deciding what to expand.",
    context: "The user is asking for lower-level stats and risk analysis, not normal coding context.",
    expectedUsesShapeLex: true,
    expectedTool: "shapelex_context",
    expectedSuggestions: ["full"]
  }
];

export async function runAgentAdoptionEval() {
  const handleJsonRpc = createJsonRpcHandler(new ShapeLexEngine({ persistent: false }));
  const initialize = await handleJsonRpc({ jsonrpc: "2.0", id: "agent-init", method: "initialize", params: {} });
  const toolsList = await handleJsonRpc({ jsonrpc: "2.0", id: "agent-tools", method: "tools/list" });
  const instructions = String(initialize.result.instructions ?? "");
  const tools = toolsList.result.tools.map((tool: any) => ({
    name: String(tool.name),
    description: String(tool.description ?? "")
  }));
  const decisions = scenarios.map((scenario) => {
    const decision = simulateAgentDecision({ scenario, instructions, tools });
    return {
      scenario: scenario.name,
      expectedUsesShapeLex: scenario.expectedUsesShapeLex,
      expectedTool: scenario.expectedTool ?? null,
      expectedSuggestions: scenario.expectedSuggestions ?? [],
      decision,
      passed: decision.usesShapeLex === scenario.expectedUsesShapeLex
        && (!scenario.expectedTool || decision.plannedTools.includes(scenario.expectedTool))
        && (scenario.expectedSuggestions ?? []).every((suggestion) => decision.suggestions.includes(suggestion))
    };
  });

  const agentDrivenContract = /agent-driven/i.test(instructions)
    && /proactively/i.test(instructions)
    && /do not wait/i.test(instructions)
    && /Briefly tell/i.test(instructions)
    && /Recommend lean mode/i.test(instructions)
    && /Suggest a new readable sessionId/i.test(instructions)
    && /Suggest cleanup/i.test(instructions);
  const passed = agentDrivenContract && decisions.every((decision) => decision.passed);

  return {
    type: "shapelex-agent-adoption-simulation",
    note: "This is a deterministic agent-policy simulation. It does not call a live LLM and does not call ShapeLex compression tools; it checks whether the MCP instructions and tool descriptions would make a compliant agent choose ShapeLex without the user manually asking.",
    summary: {
      passed,
      agentDrivenContract,
      scenarios: decisions.length,
      shapeLexExpected: decisions.filter((decision) => decision.expectedUsesShapeLex).length,
      shapeLexChosen: decisions.filter((decision) => decision.decision.usesShapeLex).length,
      suggestionsPassed: decisions.every((decision) => decision.passed),
      averageEstimatedSavingsRatio: average(decisions
        .filter((decision) => decision.decision.usesShapeLex)
        .map((decision) => decision.decision.estimatedSavingsRatio))
    },
    decisions
  };
}

function simulateAgentDecision({
  scenario,
  instructions,
  tools
}: {
  scenario: AgentScenario;
  instructions: string;
  tools: Array<{ name: string; description: string }>;
}): AgentDecision {
  const rawPromptTokens = estimateTokens(`${scenario.userPrompt}\n\n${scenario.context}`);
  const hasAgentDrivenInstruction = /agent-driven/i.test(instructions)
    && /proactively/i.test(instructions)
    && /do not wait/i.test(instructions);
  const hasNoticeInstruction = /Briefly tell/i.test(instructions);
  const longContext = rawPromptTokens >= 350;
  const repeatedContext = /older conversation|earlier decisions|repeated|history/i.test(`${scenario.userPrompt}\n${scenario.context}`);
  const oldMemoryNeeded = /earlier ShapeLex project requirements|earlier project requirements|old memory|previous requirements/i.test(scenario.userPrompt);
  const projectSwitch = /switch|different repo|different project|new CRM portal|client|feature/i.test(`${scenario.userPrompt}\n${scenario.context}`);
  const cleanupNeeded = /older conversation|noisy|unrelated|old|history/i.test(`${scenario.userPrompt}\n${scenario.context}`);
  const fullModeNeeded = /deeper|stats|risk|lower-level|inspect/i.test(`${scenario.userPrompt}\n${scenario.context}`);
  const hasModeGuidance = /Recommend lean mode/i.test(instructions) && /suggest full mode/i.test(instructions);
  const hasSessionGuidance = /Suggest a new readable sessionId/i.test(instructions);
  const hasCleanupGuidance = /Suggest cleanup/i.test(instructions) && /dryRun/i.test(instructions);
  const toolNames = new Set(tools.map((tool) => tool.name));
  const plannedTools: string[] = [];
  const suggestions: string[] = [];

  if (hasAgentDrivenInstruction && oldMemoryNeeded && toolNames.has("shapelex_context")) {
    plannedTools.push("shapelex_context");
  } else if (hasAgentDrivenInstruction && (projectSwitch || fullModeNeeded) && toolNames.has("shapelex_context")) {
    plannedTools.push("shapelex_context");
  } else if (hasAgentDrivenInstruction && repeatedContext && rawPromptTokens >= 120 && toolNames.has("shapelex_compress_messages")) {
    plannedTools.push("shapelex_compress_messages", "shapelex_context");
  } else if (hasAgentDrivenInstruction && longContext && toolNames.has("shapelex_compress_text")) {
    plannedTools.push("shapelex_compress_text", "shapelex_context");
  }

  if (hasModeGuidance) {
    suggestions.push(fullModeNeeded ? "full" : "lean");
  }
  if (hasSessionGuidance && projectSwitch) {
    suggestions.push("session-switch");
  }
  if (hasCleanupGuidance && cleanupNeeded && rawPromptTokens >= 120) {
    suggestions.push("cleanup-preview");
  }

  const usesShapeLex = plannedTools.length > 0;
  const estimatedAfterShapeLexTokens = usesShapeLex
    ? estimateShapeLexPromptTokens(rawPromptTokens, plannedTools)
    : rawPromptTokens;

  return {
    usesShapeLex,
    plannedTools,
    suggestions,
    userNotice: usesShapeLex && hasNoticeInstruction
      ? "I am going to compress older context with ShapeLex to keep this session lighter."
      : null,
    reason: reasonForDecision({ usesShapeLex, longContext, repeatedContext, oldMemoryNeeded }),
    rawPromptTokens,
    estimatedAfterShapeLexTokens,
    estimatedSavingsRatio: tokenSavings(rawPromptTokens, estimatedAfterShapeLexTokens)
  };
}

function estimateShapeLexPromptTokens(rawPromptTokens: number, plannedTools: string[]) {
  const handleAndContextOverhead = plannedTools.includes("shapelex_compress_messages") ? 180 : 160;
  const compactContextTokens = Math.ceil(rawPromptTokens * 0.28);
  return Math.min(rawPromptTokens, compactContextTokens + handleAndContextOverhead);
}

function reasonForDecision({
  usesShapeLex,
  longContext,
  repeatedContext,
  oldMemoryNeeded
}: {
  usesShapeLex: boolean;
  longContext: boolean;
  repeatedContext: boolean;
  oldMemoryNeeded: boolean;
}) {
  if (!usesShapeLex) {
    return "Context is small enough that ShapeLex tool calls would likely cost more than they save.";
  }
  if (oldMemoryNeeded) {
    return "The user references earlier memory, so the agent should retrieve compact ShapeLex context without being asked.";
  }
  if (repeatedContext) {
    return "The scenario contains older or repeated conversation history, so the agent should compress it proactively.";
  }
  if (longContext) {
    return "The scenario contains long pasted context, so the agent should compress it proactively.";
  }
  return "ShapeLex is useful for this scenario.";
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

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = await runAgentAdoptionEval();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.summary.passed ? 0 : 1;
}
