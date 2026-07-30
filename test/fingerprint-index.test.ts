import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INDEX_LIMITS,
  LazyFingerprintIndex
} from "../src/fingerprint/index.js";

const EXACT_TEXT = [
  "The careful analyst reviews every invoice before approving the settlement request.",
  "The compliance system records each decision with a timestamp and operator identifier.",
  "Auditors inspect the complete transaction history during every monthly review."
].join(" ");

test("registrations remain cold until explicit warming or search", () => {
  const index = new LazyFingerprintIndex();
  index.registerDocument({ id: "document-a", textProvider: () => EXACT_TEXT });

  assert.deepEqual(index.stats(), {
    profile: "lexical-v1",
    registeredDocuments: 1,
    warmDocuments: 0,
    coldDocuments: 1,
    postingHashes: 0,
    suppressedHashes: 0,
    estimatedIndexBytes: 0,
    evictions: 0,
    incompleteSearches: 0
  });

  assert.equal(index.warmDocument("document-a"), true);
  assert.equal(index.warmDocument("document-a"), false);
  assert.equal(index.stats().warmDocuments, 1);
});

test("short queries do not warm cold fingerprint documents", () => {
  const index = new LazyFingerprintIndex();
  let providerReads = 0;
  for (let documentIndex = 0; documentIndex < 40; documentIndex += 1) {
    index.registerDocument({
      id: `cold-${documentIndex}`,
      textProvider: () => {
        providerReads += 1;
        return `Cold document ${documentIndex} remains untouched for keyword fallback.`;
      }
    });
  }

  const result = index.search("alpha");

  assert.equal(providerReads, 0);
  assert.equal(result.matches.length, 0);
  assert.equal(result.diagnostics.fallbackRequired, true);
  assert.equal(result.diagnostics.warmedDocuments, 0);
  assert.equal(result.diagnostics.coldDocumentsRemaining, 40);
  assert.equal(index.stats().incompleteSearches, 1);
});

test("search lazily warms and ranks byte-verified exact matches first", () => {
  const index = new LazyFingerprintIndex();
  index.registerDocument({
    id: "related",
    textProvider: () => `Introductory note. ${EXACT_TEXT}`
  });
  index.registerDocument({ id: "exact-z", textProvider: () => EXACT_TEXT });
  index.registerDocument({ id: "exact-a", textProvider: () => EXACT_TEXT });

  const search = index.search(EXACT_TEXT);

  assert.equal(search.matches[0]?.documentId, "exact-a");
  assert.equal(search.matches[0]?.result.matchKind, "exact");
  assert.equal(search.matches[1]?.documentId, "exact-z");
  assert.equal(search.matches[1]?.result.matchKind, "exact");
  assert.equal(search.matches[2]?.result.matchKind, "exact");
  assert.deepEqual(search.matches[2]?.window, {
    rawByteStart: Buffer.byteLength("Introductory note. "),
    rawByteEnd: Buffer.byteLength(`Introductory note. ${EXACT_TEXT}`)
  });
  assert.equal(search.diagnostics.searchComplete, true);
  assert.equal(search.diagnostics.coldDocumentsRemaining, 0);
  assert.equal(search.diagnostics.verifiedCandidates, 3);
});

test("a coherent relocated block outranks a noisy reordered overlap", () => {
  const paragraphs = [
    "Amber researchers catalogue coastal bird migrations with careful field notes and verified observations.",
    "Blue archivists preserve historic letters while recording provenance, condition, language, and restoration details.",
    "Copper engineers compare resilient bridge designs under wind, rain, vibration, and changing seasonal loads.",
    "Dahlia botanists document native flowers through patient surveys, consistent labels, and reproducible photographs."
  ];
  const query = paragraphs.join("\n\n");
  const index = new LazyFingerprintIndex({ maxVerificationsPerQuery: 1 });
  index.registerDocument({
    id: "a-noisy-reordered",
    textProvider: () => [paragraphs[2], paragraphs[0], paragraphs[3], paragraphs[1]].join("\n\n")
  });
  index.registerDocument({
    id: "z-relocated-exact",
    textProvider: () => `Unrelated preface about astronomy and telescope maintenance.\n\n${query}\n\nUnrelated appendix about ceramic glazing.`
  });

  const search = index.search(query);

  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0]?.documentId, "z-relocated-exact");
  assert.equal(search.matches[0]?.result.matchKind, "exact");
  assert.ok(search.matches[0]?.window);
  assert.ok(search.diagnostics.limitsHit.includes("verification_limit"));
});

test("relocated windows use UTF-8 byte offsets for astral and accented text", () => {
  const prefix = "🛰️ Preámbulo técnico.\n";
  const query = [
    "La analista revisó cuidadosamente señales únicas de migración costera.",
    "Después documentó cada observación con brújula, cámara y ubicación precisa.",
    "El equipo comparó patrones históricos antes de publicar conclusiones verificables."
  ].join(" ");
  const index = new LazyFingerprintIndex();
  index.registerDocument({
    id: "unicode-relocated",
    textProvider: () => `${prefix}${query}\nEpílogo neutral.`
  });

  const search = index.search(query);

  assert.equal(search.matches[0]?.result.matchKind, "exact");
  assert.deepEqual(search.matches[0]?.window, {
    rawByteStart: Buffer.byteLength(prefix),
    rawByteEnd: Buffer.byteLength(`${prefix}${query}`)
  });
});

test("a coherent relocated strong match outranks noisy aggregate overlap", () => {
  const paragraphs = [
    "Amber researchers catalogue coastal bird migrations with careful field notes and verified observations.",
    "Blue archivists preserve historic letters while recording provenance, condition, language, and restoration details.",
    "Copper engineers compare resilient bridge designs under wind, rain, vibration, and changing seasonal loads.",
    "Dahlia botanists document native flowers through patient surveys, consistent labels, and reproducible photographs."
  ];
  const query = paragraphs.join("\n\n");
  const related = query.replace("Amber researchers", "amber researchers");
  const index = new LazyFingerprintIndex({ maxVerificationsPerQuery: 1 });
  index.registerDocument({
    id: "a-noisy-reordered",
    textProvider: () => [paragraphs[2], paragraphs[0], paragraphs[3], paragraphs[1]].join("\n\n")
  });
  index.registerDocument({
    id: "z-relocated-strong",
    textProvider: () => `Preface with unrelated notes about telescope mirrors.\n\n${related}\n\nAppendix with unrelated notes about ceramic glazing.`
  });

  const search = index.search(query);

  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0]?.documentId, "z-relocated-strong");
  assert.equal(search.matches[0]?.result.matchKind, "strong_related");
  assert.ok(search.matches[0]?.window);
});

test("reordered blocks retain multiple coherent positional peaks", () => {
  const paragraphs = [
    "Amber researchers catalogue coastal bird migrations with careful field notes and verified observations.",
    "Blue archivists preserve historic letters while recording provenance, condition, language, and restoration details.",
    "Copper engineers compare resilient bridge designs under wind, rain, vibration, and changing seasonal loads.",
    "Dahlia botanists document native flowers through patient surveys, consistent labels, and reproducible photographs."
  ];
  const query = paragraphs.join("\n\n");
  const reordered = [paragraphs[2], paragraphs[3], paragraphs[0], paragraphs[1]].join("\n\n");
  const index = new LazyFingerprintIndex();
  index.registerDocument({ id: "reordered", textProvider: () => reordered });

  const search = index.search(query);

  assert.equal(search.matches[0]?.result.matchKind, "related_reordered");
  assert.ok((search.matches[0]?.result.metrics.alignmentPeaks ?? 0) >= 2);
  assert.ok((search.matches[0]?.alignment?.coherentPeaks ?? 0) >= 2);
  assert.equal(search.matches[0]?.window, undefined);
});

test("candidate ordering is deterministic regardless of registration order", () => {
  const create = (ids: readonly string[]) => {
    const index = new LazyFingerprintIndex();
    for (const id of ids) {
      index.registerDocument({ id, textProvider: () => EXACT_TEXT });
    }
    return index.search(EXACT_TEXT).matches.map((match) => match.documentId);
  };

  assert.deepEqual(create(["z", "a", "m"]), ["a", "m", "z"]);
  assert.deepEqual(create(["m", "z", "a"]), ["a", "m", "z"]);
});

test("a whole exact record outranks an equally exact materialized window", () => {
  const index = new LazyFingerprintIndex();
  index.registerDocument({
    id: "a-relocated-window",
    textProvider: () => `Preface with unrelated material. ${EXACT_TEXT}`
  });
  index.registerDocument({
    id: "z-whole-record",
    textProvider: () => EXACT_TEXT
  });

  const search = index.search(EXACT_TEXT);

  assert.equal(search.matches[0]?.documentId, "z-whole-record");
  assert.equal(search.matches[0]?.window, undefined);
  assert.equal(search.matches[1]?.result.matchKind, "exact");
  assert.ok(search.matches[1]?.window);
});

test("invalidation removes postings and permits a clean lazy rebuild", () => {
  const index = new LazyFingerprintIndex();
  let current = EXACT_TEXT;
  index.registerDocument({ id: "mutable", textProvider: () => current });
  assert.equal(index.search(EXACT_TEXT).matches[0]?.result.matchKind, "exact");

  current = [
    "A replacement document discusses weather stations and ocean temperatures.",
    "Researchers compare seasonal observations from several independent sensors.",
    "The report contains no invoice workflow or settlement instructions."
  ].join(" ");
  const staleSearch = index.search(EXACT_TEXT);
  assert.deepEqual(staleSearch.diagnostics.staleDocuments, ["mutable"]);
  assert.ok(staleSearch.diagnostics.limitsHit.includes("stale_document"));
  assert.equal(index.stats().coldDocuments, 1);

  const rebuilt = index.search(current);
  assert.equal(rebuilt.matches[0]?.result.matchKind, "exact");
  assert.equal(index.stats().warmDocuments, 1);
});

test("registering the same id replaces and invalidates its former content", () => {
  const index = new LazyFingerprintIndex();
  index.registerDocument({ id: "replace", textProvider: () => EXACT_TEXT });
  index.warmDocument("replace");
  assert.equal(index.stats().warmDocuments, 1);

  const replacement = `${EXACT_TEXT} A replacement suffix is now present.`;
  index.registerDocument({ id: "replace", textProvider: () => replacement });
  assert.equal(index.stats().warmDocuments, 0);
  assert.equal(index.search(replacement).matches[0]?.result.matchKind, "exact");
});

test("posting floods become stop-fingerprints and remain bounded", () => {
  const index = new LazyFingerprintIndex({
    maxPostingsPerHash: 2,
    maxFingerprintsPerDocument: 100
  });
  index.registerDocument({
    id: "repetitive",
    textProvider: () => "repeat repeat repeat repeat repeat repeat repeat repeat ".repeat(20)
  });
  index.warmDocument("repetitive");

  const stats = index.stats();
  assert.ok(stats.suppressedHashes > 0);
  assert.ok(stats.postingHashes <= 100);

  const search = index.search("repeat repeat repeat repeat repeat repeat");
  assert.ok(search.diagnostics.suppressedHashes > 0);
  assert.ok(search.diagnostics.queryFingerprints <= index.limits.maxQueryFingerprints);
  assert.ok(search.diagnostics.limitsHit.includes("suppressed_hash_limit"));
  assert.equal(search.diagnostics.fallbackRequired, true);
});

test("cold-document, candidate, and verification limits are disclosed", () => {
  const coldLimited = new LazyFingerprintIndex({ maxColdDocumentsPerQuery: 1 });
  for (const id of ["c", "a", "b"]) {
    coldLimited.registerDocument({ id, textProvider: () => EXACT_TEXT });
  }
  const coldSearch = coldLimited.search(EXACT_TEXT);
  assert.equal(coldSearch.diagnostics.searchComplete, false);
  assert.equal(coldSearch.diagnostics.coldDocumentsRemaining, 2);
  assert.ok(coldSearch.diagnostics.limitsHit.includes("cold_document_limit"));

  const candidateLimited = new LazyFingerprintIndex({
    maxCandidateDocuments: 2,
    maxVerificationsPerQuery: 1
  });
  for (const id of ["a", "b", "c"]) {
    candidateLimited.registerDocument({ id, textProvider: () => EXACT_TEXT });
  }
  const candidateSearch = candidateLimited.search(EXACT_TEXT);
  assert.equal(candidateSearch.matches.length, 1);
  assert.ok(candidateSearch.diagnostics.limitsHit.includes("candidate_document_limit"));
  assert.ok(candidateSearch.diagnostics.limitsHit.includes("verification_limit"));
  assert.equal(candidateSearch.diagnostics.searchComplete, false);
});

test("query and document fingerprint limits retain both lexical channels", () => {
  const index = new LazyFingerprintIndex({
    maxFingerprintsPerDocument: 8,
    maxQueryFingerprints: 6
  });
  index.registerDocument({ id: "bounded", textProvider: () => EXACT_TEXT });
  const search = index.search(EXACT_TEXT);

  assert.equal(search.diagnostics.queryFingerprints, 6);
  assert.ok(search.diagnostics.limitsHit.includes("query_fingerprint_limit"));
  assert.ok(search.diagnostics.limitsHit.includes("document_fingerprint_limit"));
});

test("the memory budget evicts least-recently-used documents", () => {
  const probe = new LazyFingerprintIndex();
  probe.registerDocument({ id: "probe", textProvider: () => EXACT_TEXT });
  probe.warmDocument("probe");
  const oneDocumentBytes = probe.stats().estimatedIndexBytes;

  const index = new LazyFingerprintIndex({
    maxEstimatedBytes: oneDocumentBytes + 1
  });
  index.registerDocument({ id: "a", textProvider: () => EXACT_TEXT });
  index.registerDocument({
    id: "b",
    textProvider: () => EXACT_TEXT.replace("invoice", "account")
  });
  index.warmDocument("a");
  index.warmDocument("b");

  assert.equal(index.stats().warmDocuments, 1);
  assert.equal(index.stats().coldDocuments, 1);
  assert.equal(index.stats().evictions, 1);
  assert.ok(index.stats().estimatedIndexBytes <= index.limits.maxEstimatedBytes);
});

test("retained-memory safety calibration evicts before the configured budget", () => {
  const largeText = `${EXACT_TEXT}\n`.repeat(24);
  const probe = new LazyFingerprintIndex();
  probe.registerDocument({ id: "probe", textProvider: () => largeText });
  probe.warmDocument("probe");
  const calibratedDocumentBytes = probe.stats().estimatedIndexBytes;
  const rawBytes = Buffer.byteLength(largeText);

  assert.ok(
    calibratedDocumentBytes > rawBytes * 16,
    "estimate includes retained V8 object/Map overhead, not only UTF-8 payload"
  );

  const budget = Math.floor(calibratedDocumentBytes * 1.75);
  const index = new LazyFingerprintIndex({ maxEstimatedBytes: budget });
  index.registerDocument({ id: "first", textProvider: () => largeText });
  index.registerDocument({
    id: "second",
    textProvider: () => largeText.replace("invoice", "account")
  });
  index.warmDocument("first");
  index.warmDocument("second");

  assert.equal(index.stats().evictions, 1);
  assert.equal(index.stats().warmDocuments, 1);
  assert.ok(index.stats().estimatedIndexBytes < budget);
});

test("a cheap source version callback invalidates changed content before matching", () => {
  const index = new LazyFingerprintIndex();
  let version = 1;
  let text = EXACT_TEXT;
  index.registerDocument({
    id: "versioned",
    textProvider: () => text,
    versionProvider: () => version
  });
  index.warmDocument("versioned");

  version = 2;
  text = `${EXACT_TEXT} The source changed on disk.`;
  const search = index.search(text);

  assert.deepEqual(search.diagnostics.staleDocuments, ["versioned"]);
  assert.ok(search.diagnostics.limitsHit.includes("stale_document"));
  assert.equal(search.matches[0]?.result.matchKind, "exact");
});

test("a stale provider is isolated and reported without aborting the search", () => {
  const index = new LazyFingerprintIndex();
  const staleError = Object.assign(new Error("source changed"), {
    code: "STALE_SOURCE"
  });
  index.registerDocument({
    id: "stale-provider",
    textProvider: () => {
      throw staleError;
    }
  });

  const search = index.search(EXACT_TEXT);

  assert.deepEqual(search.matches, []);
  assert.deepEqual(search.diagnostics.staleDocuments, ["stale-provider"]);
  assert.ok(search.diagnostics.limitsHit.includes("stale_document"));
  assert.equal(search.diagnostics.searchComplete, false);
  assert.equal(index.stats().coldDocuments, 1);
});

test("unregister and clear remove lifecycle state deterministically", () => {
  const index = new LazyFingerprintIndex();
  index.registerDocument({ id: "a", textProvider: () => EXACT_TEXT });
  index.registerDocument({ id: "b", textProvider: () => EXACT_TEXT });
  index.warmDocument("a");

  assert.equal(index.unregisterDocument("a"), true);
  assert.equal(index.unregisterDocument("a"), false);
  assert.equal(index.stats().registeredDocuments, 1);
  index.clear();
  assert.equal(index.stats().registeredDocuments, 0);
  assert.equal(index.stats().estimatedIndexBytes, 0);
});

test("invalid registrations, limits, providers, and unknown ids fail explicitly", () => {
  assert.throws(
    () => new LazyFingerprintIndex({ maxPostingsPerHash: 0 }),
    /positive safe integer/
  );
  const index = new LazyFingerprintIndex();
  assert.throws(
    () => index.registerDocument({ id: "", textProvider: () => "text" }),
    /document id/
  );
  assert.throws(() => index.warmDocument("missing"), /Unknown fingerprint document/);
  index.registerDocument({
    id: "invalid-provider-result",
    textProvider: () => 42 as unknown as string
  });
  assert.throws(
    () => index.warmDocument("invalid-provider-result"),
    /string or Uint8Array/
  );
  index.registerDocument({
    id: "invalid-version",
    textProvider: () => "valid text",
    versionProvider: () => ({}) as unknown as string
  });
  assert.throws(
    () => index.warmDocument("invalid-version"),
    /string or finite number/
  );
});

test("published default limits match the professional bounded-index contract", () => {
  assert.deepEqual(DEFAULT_INDEX_LIMITS, {
    maxPostingsPerHash: 128,
    maxFingerprintsPerDocument: 50_000,
    maxQueryFingerprints: 4_096,
    maxColdDocumentsPerQuery: 32,
    maxCandidateDocuments: 32,
    maxVerificationsPerQuery: 16,
    maxEstimatedBytes: 64 * 1024 * 1024
  });
});
