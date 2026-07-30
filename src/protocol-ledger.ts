import { createJsonRpcHandler } from "./mcp-server.js";
import { ShapeLexEngine, estimateTokens } from "./shapelex.js";

const FOLLOW_UP_TURNS = 4;

export interface TokenLedgerEntry {
  id: string;
  rawPromptTokens: number;
  toolSchemaTokens: number;
  requestTokens: number;
  responseTokens: number;
  expansionTokens: number;
  requiredFacts: readonly string[];
  recoveredFacts: readonly string[];
}

export interface TokenLedgerSummary {
  cases: number;
  aggregateReduction: number;
  medianReduction: number;
  requiredFactFidelity: number;
  regressions: string[];
  rawTokens: number;
  shapeLexTokens: number;
}

export interface OfflineProtocolReport {
  methodology: {
    followUpTurns: number;
    schemaTokensPerTurn: number;
    tokenEstimator: "shapelex-estimate";
    expansionPolicy: "minimum-exact-span-containing-required-fact";
  };
  entries: TokenLedgerEntry[];
  summary: TokenLedgerSummary;
}

export async function runOfflineProtocolEvaluation(): Promise<OfflineProtocolReport> {
  const engine = new ShapeLexEngine({ persistent: false });
  const handler = createJsonRpcHandler(engine, { toolset: "lean" });
  const toolsResponse = await handler({
    jsonrpc: "2.0",
    id: "tools",
    method: "tools/list",
    params: {}
  });
  const schemaTokensPerTurn = estimateTokens(JSON.stringify(toolsResponse.result));
  const entries: TokenLedgerEntry[] = [];

  for (let caseNumber = 1; caseNumber <= 12; caseNumber += 1) {
    const requiredFacts = requiredFactsFor(caseNumber);
    const rawText = longScenario(caseNumber, requiredFacts);
    const sessionId = `offline-ledger-${caseNumber}`;
    const compressed = engine.compressText({ sessionId, text: rawText });
    const selectedExpansions = selectMinimumFactExpansions(
      engine,
      sessionId,
      compressed.handles,
      requiredFacts
    );
    const recoveredText = [
      compressed.compressedText,
      ...selectedExpansions.map((item) => item.text)
    ].join("\n");
    const expansionRequestTokens = selectedExpansions.reduce(
      (total, item) => total + estimateTokens(JSON.stringify({ handle: item.handle })),
      0
    );

    entries.push({
      id: `long-context-${String(caseNumber).padStart(2, "0")}`,
      rawPromptTokens: estimateTokens(rawText) * FOLLOW_UP_TURNS,
      toolSchemaTokens: schemaTokensPerTurn * (FOLLOW_UP_TURNS + 1),
      requestTokens: estimateTokens(JSON.stringify({ sessionId, text: rawText }))
        + expansionRequestTokens,
      responseTokens: estimateTokens(compressed.compressedText),
      expansionTokens: selectedExpansions.reduce(
        (total, item) => total + estimateTokens(item.text),
        0
      ),
      requiredFacts,
      recoveredFacts: requiredFacts.filter((fact) => recoveredText.includes(fact))
    });
  }

  return {
    methodology: {
      followUpTurns: FOLLOW_UP_TURNS,
      schemaTokensPerTurn,
      tokenEstimator: "shapelex-estimate",
      expansionPolicy: "minimum-exact-span-containing-required-fact"
    },
    entries,
    summary: summarizeTokenLedger(entries)
  };
}

export function summarizeTokenLedger(entries: readonly TokenLedgerEntry[]): TokenLedgerSummary {
  const reductions: number[] = [];
  const regressions: string[] = [];
  let rawTokens = 0;
  let shapeLexTokens = 0;
  let requiredFacts = 0;
  let recoveredFacts = 0;

  for (const entry of entries) {
    const total = entry.toolSchemaTokens
      + entry.requestTokens
      + entry.responseTokens
      + entry.expansionTokens;
    rawTokens += entry.rawPromptTokens;
    shapeLexTokens += total;
    reductions.push(safeRatio(entry.rawPromptTokens - total, entry.rawPromptTokens, 0));
    if (total > entry.rawPromptTokens) {
      regressions.push(entry.id);
    }

    const recovered = new Set(entry.recoveredFacts);
    requiredFacts += entry.requiredFacts.length;
    recoveredFacts += entry.requiredFacts.filter((fact) => recovered.has(fact)).length;
  }

  return {
    cases: entries.length,
    aggregateReduction: safeRatio(rawTokens - shapeLexTokens, rawTokens, 0),
    medianReduction: percentile(reductions, 0.5),
    requiredFactFidelity: safeRatio(recoveredFacts, requiredFacts),
    regressions,
    rawTokens,
    shapeLexTokens
  };
}

function requiredFactsFor(caseNumber: number): string[] {
  const day = String(caseNumber).padStart(2, "0");
  return [
    `Do not approve invoice ${4_800 + caseNumber}.`,
    `The deadline is 2026-08-${day}.`,
    `The limit is >= ${100 + caseNumber}.`
  ];
}

function longScenario(caseNumber: number, facts: readonly string[]): string {
  const section = (phase: string) => Array.from({ length: 90 }, (_, index) => (
    `Case ${caseNumber} ${phase} record ${index} explains routine review evidence, `
    + "ownership rationale, recovery preparation, and audit history."
  )).join(" ");

  return [
    section("alpha"),
    facts[0],
    section("beta"),
    facts[1],
    section("gamma"),
    facts[2],
    section("delta")
  ].join("\n");
}

function selectMinimumFactExpansions(
  engine: ShapeLexEngine,
  sessionId: string,
  handles: ReadonlyArray<{ uri: string }>,
  facts: readonly string[]
): Array<{ handle: string; text: string }> {
  const expanded = handles.map((handle) => ({
    handle: handle.uri,
    text: engine.expand({ sessionId, handle: handle.uri }).text
  }));
  const selected = new Map<string, { handle: string; text: string }>();

  for (const fact of facts) {
    const candidates = expanded
      .filter((item) => item.text.includes(fact))
      .sort((left, right) => (
        estimateTokens(left.text) - estimateTokens(right.text)
        || left.handle.localeCompare(right.handle)
      ));
    if (candidates[0]) {
      selected.set(candidates[0].handle, candidates[0]);
    }
  }

  return [...selected.values()];
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(Math.max(0, Math.min(1, percentileValue)) * sorted.length) - 1;
  return sorted[Math.max(0, rank)]!;
}

function safeRatio(numerator: number, denominator: number, emptyValue = 1): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}
