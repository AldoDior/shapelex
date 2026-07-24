import { performance } from "node:perf_hooks";
import { ShapeLexEngine, estimateTokens } from "../src/shapelex.js";

const cases = [
  {
    name: "policy-text",
    mode: "text",
    text: [
      "Do not approve payment batch 42 before dual approval.",
      "The rollback owner is OPS-123.",
      "Keep audit logs for 7 years.",
      "This policy is repeated for operational clarity. ".repeat(35)
    ].join(" "),
    facts: ["Do not approve", "batch 42", "dual approval", "OPS-123", "7 years"]
  },
  {
    name: "repo-code",
    mode: "code",
    text: [
      "import fs from \"node:fs\";",
      "export class RepoReader {",
      "  readFile(path) {",
      "    if (!path) throw new Error(\"missing path\");",
      "    return fs.readFileSync(path, \"utf8\");",
      "  }",
      "}",
      "Traceback: Error: missing path",
      "    at RepoReader.readFile (repo-reader.js:4:22)"
    ].join("\n"),
    facts: ["import fs", "RepoReader", "readFile", "missing path", "Traceback"]
  },
  {
    name: "conversation",
    mode: "conversation",
    messages: [
      { role: "user", content: "Decidimos que ShapeLex no debe reconstruir todo desde texto comprimido." },
      { role: "assistant", content: "Pendiente: implementar search, retrieve y risk assessment." },
      { role: "user", content: "Cambio de opinion: mejor no persistir nada todavia." },
      { role: "assistant", content: "Restriccion: preservar negaciones, numeros y decisiones tomadas." }
    ],
    facts: ["no debe reconstruir", "Pendiente", "Cambio de opinion", "no persistir", "preservar negaciones"]
  }
];

export function runBenchmark() {
  const engine = new ShapeLexEngine();
  const results = [];

  for (const item of cases) {
    const start = performance.now();
    const compressed = item.messages
      ? engine.compressMessages({ sessionId: "bench", label: item.name, messages: item.messages })
      : engine.compressText({ sessionId: "bench", label: item.name, mode: item.mode, text: item.text });
    const compressMs = performance.now() - start;

    const retrieveStart = performance.now();
    const retrieved = engine.retrieve({ sessionId: "bench", uri: compressed.uri, level: 3 });
    const retrieveMs = performance.now() - retrieveStart;

    const searchStart = performance.now();
    const searched = engine.search({ sessionId: "bench", query: item.facts[0], mode: item.mode });
    const searchMs = performance.now() - searchStart;

    const rawText = item.messages
      ? item.messages.map((message) => message.content).join("\n")
      : item.text;
    const v2Evidence = JSON.stringify(retrieved.levels).toLowerCase();
    const legacyEvidence = compressed.handles.map((handle) => handle.uri).join(" ").toLowerCase();
    const rawEvidence = rawText.toLowerCase();
    const facts = item.facts.map((fact) => fact.toLowerCase());

    results.push({
      name: item.name,
      mode: item.mode,
      rawTokens: compressed.rawTokenEstimate,
      fullContext: {
        tokens: compressed.rawTokenEstimate,
        factRecall: recall(facts, rawEvidence)
      },
      shapeLexLegacyLike: {
        tokens: estimateTokens(legacyEvidence),
        factRecall: recall(facts, legacyEvidence)
      },
      shapeLexV2: {
        tokens: compressed.compressedTokenEstimate,
        tokenReductionRatio: Number((compressed.rawTokenEstimate / Math.max(1, compressed.compressedTokenEstimate)).toFixed(2)),
        factRecall: recall(facts, v2Evidence),
        riskLevel: compressed.risk.level,
        shouldExpand: compressed.risk.shouldExpand
      },
      latencyMs: {
        compress: Number(compressMs.toFixed(3)),
        retrieve: Number(retrieveMs.toFixed(3)),
        search: Number(searchMs.toFixed(3))
      },
      searchHits: searched.results.length
    });
  }

  const summary = {
    cases: results.length,
    averageV2TokenReductionRatio: average(results.map((item) => item.shapeLexV2.tokenReductionRatio)),
    averageV2FactRecall: average(results.map((item) => item.shapeLexV2.factRecall)),
    averageLegacyLikeFactRecall: average(results.map((item) => item.shapeLexLegacyLike.factRecall)),
    averageCompressLatencyMs: average(results.map((item) => item.latencyMs.compress))
  };

  return { summary, results };
}

function recall(facts, evidence) {
  if (facts.length === 0) {
    return 1;
  }
  const hits = facts.filter((fact) => evidence.includes(fact)).length;
  return Number((hits / facts.length).toFixed(3));
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const report = runBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
