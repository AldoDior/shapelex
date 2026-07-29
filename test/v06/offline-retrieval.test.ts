import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFingerprintDocument,
  scoreFingerprintMatch,
  type FingerprintDocument,
  type MatchMetrics
} from "../../src/fingerprint/index.js";
import { createAcceptanceCorpus } from "./corpus.js";
import { recallAtK, type RetrievalRun } from "./metrics.js";

interface IndexedSource {
  id: string;
  document: FingerprintDocument;
}

test("offline lexical ranking reaches the release Recall@5 gate on related and reordered queries", () => {
  const corpus = createAcceptanceCorpus();
  const uniqueSources = new Map<string, string>();
  for (const item of corpus) {
    uniqueSources.set(groupId(item.id), item.source);
  }
  const index: IndexedSource[] = [...uniqueSources]
    .map(([id, source]) => ({ id, document: buildFingerprintDocument(source) }));
  const queries = corpus.filter((item) => (
    item.expected === "strong_related" || item.expected === "related_reordered"
  ));

  const runs: RetrievalRun[] = queries.map((query) => ({
    queryId: query.id,
    relevantIds: [groupId(query.id)],
    rankedIds: rankSources(buildFingerprintDocument(query.candidate), index)
  }));

  assert.equal(runs.length, 120);
  assert.ok(recallAtK(runs, 5) >= 0.95);
});

function rankSources(query: FingerprintDocument, sources: readonly IndexedSource[]): string[] {
  return sources
    .map((source) => ({
      id: source.id,
      score: compositeScore(scoreFingerprintMatch(query, source.document))
    }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((item) => item.id);
}

function compositeScore(metrics: MatchMetrics): number {
  return (
    metrics.tokenContainment * 0.50
    + metrics.characterJaccard * 0.30
    + metrics.alignmentDominance * 0.20
  );
}

function groupId(id: string): string {
  return id.replace(/-(?:exact|normalized|related|reordered|critical|unrelated)$/u, "");
}

