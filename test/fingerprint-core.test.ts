import assert from "node:assert/strict";
import test from "node:test";
import {
  LEXICAL_PROFILE,
  buildBoundedFingerprintDocument,
  buildFingerprintDocument,
  classifyFingerprintDocuments,
  classifyFingerprintMatch,
  detectCriticalDifference,
  extractCriticalElements,
  hashString64,
  hashToHex,
  normalizeRecall,
  normalizeStrict,
  referenceNgramHash,
  rollingNgrams,
  sha256Hex,
  scoreFingerprintMatch,
  tokenizeStrict,
  verifyExactBytes,
  winnow,
  winnowRollingNgrams,
  type FingerprintDocument,
  type HashableUnit,
  type HashedNgram,
  type MatchThresholds
} from "../src/fingerprint/index.js";

test("lexical-v1 profile is stable and explicit", () => {
  assert.deepEqual(LEXICAL_PROFILE, {
    id: "lexical-v1",
    tokenNgramSize: 5,
    tokenWindowSize: 8,
    characterNgramSize: 4,
    characterWindowSize: 24
  });
});

test("strict normalization applies NFC and stable EOLs with raw byte ranges", () => {
  const input = "Cafe\u0301\r\nmañana\r🙂";
  const normalized = normalizeStrict(input);

  assert.equal(normalized.text, "Café\nmañana\n🙂");
  assert.equal(normalized.rawByteLength, Buffer.byteLength(input));

  const composed = normalized.units.find((unit) => unit.value === "é");
  assert.deepEqual(composed && [composed.rawByteStart, composed.rawByteEnd], [3, 6]);

  const firstNewline = normalized.units.find((unit) => unit.value === "\n");
  assert.deepEqual(
    firstNewline && [firstNewline.rawByteStart, firstNewline.rawByteEnd],
    [6, 8]
  );

  const emoji = normalized.units.find((unit) => unit.value === "🙂");
  assert.equal(
    emoji && emoji.rawByteEnd - emoji.rawByteStart,
    Buffer.byteLength("🙂")
  );
});

test("strict normalization composes Hangul Jamo and preserves embedded NUL", () => {
  const input = "\u1100\u1161\0ok";
  const normalized = normalizeStrict(input);

  assert.equal(normalized.text, "가\0ok");
  assert.equal(normalized.units[0]?.rawByteEnd, Buffer.byteLength("\u1100\u1161"));
});

test("ASCII fast normalization preserves CRLF byte mappings and recall whitespace ranges", () => {
  const strict = normalizeStrict("A\r\nB\rC\t D");
  assert.equal(strict.text, "A\nB\nC\t D");
  assert.deepEqual(
    strict.units.map((unit) => [
      unit.value,
      unit.normalizedStart,
      unit.normalizedEnd,
      unit.rawByteStart,
      unit.rawByteEnd
    ]),
    [
      ["A", 0, 1, 0, 1],
      ["\n", 1, 2, 1, 3],
      ["B", 2, 3, 3, 4],
      ["\n", 3, 4, 4, 5],
      ["C", 4, 5, 5, 6],
      ["\t", 5, 6, 6, 7],
      [" ", 6, 7, 7, 8],
      ["D", 7, 8, 8, 9]
    ]
  );

  const recall = normalizeRecall(strict);
  assert.equal(recall.text, "a b c d");
  assert.deepEqual(
    recall.units.filter((unit) => unit.value === " ").map((unit) => [
      unit.rawByteStart,
      unit.rawByteEnd
    ]),
    [[1, 3], [4, 5], [6, 8]]
  );
});

test("recall normalization lowercases and collapses whitespace without stripping accents", () => {
  const input = "  ÁRBOL\r\n\t MÁS  ";
  const recall = normalizeRecall(input);

  assert.equal(recall.text, "árbol más");
  assert.ok(recall.units.every((unit) => unit.rawByteEnd <= Buffer.byteLength(input)));
});

test("strict tokenizer preserves identifiers, values, dates, operators, and punctuation", () => {
  const input = "validate_$ID !== 2026-07-28 && precio >= 12.50;";
  const tokens = tokenizeStrict(input);

  assert.deepEqual(
    tokens.map(({ value, kind }) => [value, kind]),
    [
      ["validate_$ID", "word"],
      ["!==", "operator"],
      ["2026", "number"],
      ["-", "operator"],
      ["07", "number"],
      ["-", "operator"],
      ["28", "number"],
      ["&&", "operator"],
      ["precio", "word"],
      [">=", "operator"],
      ["12", "number"],
      [".", "punctuation"],
      ["50", "number"],
      [";", "punctuation"]
    ]
  );
});

test("strict tokenizer handles a very long single token without argument overflow", () => {
  const input = "a".repeat(150_000);
  const tokens = tokenizeStrict(input);

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.value.length, input.length);
  assert.equal(tokens[0]!.rawByteStart, 0);
  assert.equal(tokens[0]!.rawByteEnd, input.length);
});

test("token raw ranges slice the original UTF-8 bytes conservatively", () => {
  const input = "x Cafe\u0301 🙂";
  const bytes = Buffer.from(input);
  const tokens = tokenizeStrict(input);
  const cafe = tokens[1]!;
  const emoji = tokens[2]!;

  assert.equal(bytes.subarray(cafe.rawByteStart, cafe.rawByteEnd).toString(), "Cafe\u0301");
  assert.equal(bytes.subarray(emoji.rawByteStart, emoji.rawByteEnd).toString(), "🙂");
});

test("64-bit hashes are deterministic fixed-width hexadecimal values", () => {
  assert.equal(hashToHex(hashString64("")), "cbf29ce484222325");
  assert.equal(hashToHex(hashString64("ShapeLex")).length, 16);
  assert.match(hashToHex(hashString64("á🙂")), /^[a-f0-9]{16}$/);
  assert.equal(hashString64("ShapeLex"), hashString64("ShapeLex"));
  assert.notEqual(hashString64("ShapeLex"), hashString64("shapelex"));
});

test("rolling n-gram hashes agree with the simple reference implementation", () => {
  const units = makeHashableUnits(["a", "b", "c", "d", "e", "f"]);
  const ngrams = rollingNgrams(units, 3);

  assert.equal(ngrams.length, 4);
  ngrams.forEach((ngram, position) => {
    assert.equal(
      ngram.hash,
      referenceNgramHash(units.slice(position, position + 3).map((unit) => unit.value))
    );
    assert.equal(ngram.position, position);
    assert.equal(ngram.endPosition, position + 3);
  });
});

test("rolling n-grams reject invalid sizes and return empty for short inputs", () => {
  const units = makeHashableUnits(["a", "b"]);

  assert.deepEqual(rollingNgrams(units, 3), []);
  assert.throws(() => rollingNgrams(units, 0), /positive safe integer/);
  assert.throws(() => rollingNgrams(units, Number.NaN), /positive safe integer/);
});

test("winnowing chooses the rightmost minimum and emits a selection once", () => {
  const ngrams = makeNgrams([3n, 1n, 1n, 2n, 0n]);
  const selected = winnow(ngrams, 3);

  assert.deepEqual(selected.map((item) => item.position), [2, 4]);
});

test("winnowing handles empty and shorter-than-window streams", () => {
  assert.deepEqual(winnow([], 8), []);
  assert.deepEqual(winnow(makeNgrams([5n, 2n, 2n]), 8).map((item) => item.position), [2]);
  assert.throws(() => winnow(makeNgrams([1n]), -1), /positive safe integer/);
});

test("fused rolling winnowing exactly matches the compatibility pipeline", () => {
  const units = makeHashableUnits([
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi"
  ]);

  for (const ngramSize of [1, 3, 5]) {
    for (const windowSize of [1, 4, 24]) {
      assert.deepEqual(
        winnowRollingNgrams(units, ngramSize, windowSize),
        winnow(rollingNgrams(units, ngramSize), windowSize)
      );
    }
  }
  assert.deepEqual(winnowRollingNgrams(units.slice(0, 2), 3, 8), []);
  assert.throws(
    () => winnowRollingNgrams(units, 0, 8),
    /ngram size must be a positive safe integer/
  );
  assert.throws(
    () => winnowRollingNgrams(units, 3, 0),
    /window size must be a positive safe integer/
  );

  let randomState = 0x1234_5678;
  for (let run = 0; run < 100; run += 1) {
    const values: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      values.push(`unit-${randomState.toString(16)}`);
    }
    const randomUnits = makeHashableUnits(values);
    assert.deepEqual(
      winnowRollingNgrams(randomUnits, 5, 8),
      winnow(rollingNgrams(randomUnits, 5), 8)
    );
  }
});

test("fingerprint documents are deterministic and keep hashes model-safe", () => {
  const input = "Do not approve invoice 4815 before settlement. ".repeat(8);
  const first = buildFingerprintDocument(input);
  const second = buildFingerprintDocument(Buffer.from(input));

  assert.deepEqual(first, second);
  assert.equal(first.sha256, sha256Hex(input));
  assert.ok(first.tokenFingerprints.length > 0);
  assert.ok(first.characterFingerprints.length > 0);
  assert.ok(first.tokenFingerprints.every((item) => /^[a-f0-9]{16}$/.test(item.hash)));
});

test("canonical ASCII recall optimization preserves every lexical-v1 character anchor", () => {
  const input = "Alpha BETA gamma delta. One two three four five.";
  const fingerprint = buildFingerprintDocument(input);
  const recall = normalizeRecall(normalizeStrict(input));
  const expected = winnow(
    rollingNgrams(recall.units, LEXICAL_PROFILE.characterNgramSize),
    LEXICAL_PROFILE.characterWindowSize
  ).map((ngram) => ({
    profile: LEXICAL_PROFILE.id,
    channel: "character",
    hash: hashToHex(ngram.hash),
    position: ngram.position,
    endPosition: ngram.endPosition,
    rawByteStart: ngram.rawByteStart,
    rawByteEnd: ngram.rawByteEnd
  }));

  assert.deepEqual(fingerprint.characterFingerprints, expected);
  assert.equal(fingerprint.recallText, recall.text);
});

test("canonical ASCII identity construction matches the mapped lexical-v1 reference", () => {
  const cases = [
    "",
    "abc",
    "Alpha BETA gamma delta.",
    "const total = invoice.value ?? 0;",
    "alpha\tBETA\ngamma delta",
    "flags >>>= 2; active &&= ready; path?.value"
  ];

  for (const input of cases) {
    const expected = buildMappedReferenceDocument(input);
    assert.deepEqual(
      buildFingerprintDocument(input),
      expected,
      `identity fingerprint mismatch for ${JSON.stringify(input)}`
    );
    assert.deepEqual(
      buildFingerprintDocument(Buffer.from(input)),
      expected,
      `identity byte fingerprint mismatch for ${JSON.stringify(input)}`
    );
    assert.deepEqual(tokenizeStrict(input), tokenizeStrict(normalizeStrict(input)));
  }
});

test("bounded canonical ASCII identity construction preserves mapped selections", () => {
  const inputs = [
    "",
    "short",
    "Alpha\tbeta\ngamma delta epsilon zeta eta theta.",
    "const total = invoice.value ?? 0; return total >= 12; ".repeat(20).trimEnd()
  ];

  for (const input of inputs) {
    const full = buildMappedReferenceDocument(input);
    for (const limit of [0, 1, 8, 31, 100, 10_000]) {
      assert.deepEqual(
        buildBoundedFingerprintDocument(input, limit),
        boundReferenceDocument(full, limit),
        `bounded identity mismatch for limit ${limit} and ${JSON.stringify(input.slice(0, 40))}`
      );
    }
  }
});

test("bounded fingerprint construction truncates during generation without changing prefixes", () => {
  const input = "Do not approve invoice 4815 before settlement. ".repeat(1_000);
  const full = buildFingerprintDocument(input);
  const bounded = buildBoundedFingerprintDocument(input, 100);

  assert.equal(bounded.complete, false);
  assert.equal(
    bounded.document.tokenFingerprints.length + bounded.document.characterFingerprints.length,
    100
  );
  assert.deepEqual(
    bounded.document.tokenFingerprints,
    full.tokenFingerprints.slice(0, bounded.document.tokenFingerprints.length)
  );
  assert.deepEqual(
    bounded.document.characterFingerprints,
    full.characterFingerprints.slice(0, bounded.document.characterFingerprints.length)
  );
  assert.deepEqual(buildBoundedFingerprintDocument("short", 100), {
    document: buildFingerprintDocument("short"),
    complete: true
  });
  assert.throws(
    () => buildBoundedFingerprintDocument("text", -1),
    /fingerprint limit must be a non-negative safe integer/
  );
});

test("token winnowing retains anchors across an inserted prefix", () => {
  const shared = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar";
  const original = buildFingerprintDocument(shared);
  const prefixed = buildFingerprintDocument(`prefix words added here now ${shared}`);
  const originalHashes = new Set(original.tokenFingerprints.map((item) => item.hash));

  assert.ok(prefixed.tokenFingerprints.some((item) => originalHashes.has(item.hash)));
});

test("fingerprint construction rejects invalid UTF-8 bytes", () => {
  assert.throws(
    () => buildFingerprintDocument(Uint8Array.from([0xc3, 0x28])),
    /valid UTF-8/
  );
});

test("SHA-256 exact verification requires digest and byte equality", () => {
  const canonical = "café\n";
  const decomposed = "cafe\u0301\n";
  const canonicalDigest = sha256Hex(canonical);

  assert.equal(canonicalDigest.length, 64);
  assert.equal(verifyExactBytes(canonical, canonical), true);
  assert.equal(verifyExactBytes(canonical, Buffer.from(canonical), canonicalDigest), true);
  assert.equal(verifyExactBytes(canonical, canonical, canonicalDigest.toUpperCase()), true);
  assert.equal(verifyExactBytes(canonical, decomposed), false);
  assert.equal(verifyExactBytes(canonical, canonical, "not-a-digest"), false);
  assert.equal(verifyExactBytes(canonical, canonical, canonicalDigest.slice(1)), false);
  assert.equal(verifyExactBytes(canonical, canonical, `0${canonicalDigest}`), false);
  assert.equal(verifyExactBytes(canonical, canonical, `${canonicalDigest}0`), false);
  assert.equal(
    verifyExactBytes(canonical, canonical, `${canonicalDigest.slice(0, -1)}g`),
    false
  );
  assert.equal(verifyExactBytes(canonical, canonical, sha256Hex("different")), false);
  assert.equal(verifyExactBytes("aa", "bb", sha256Hex("aa")), false);
  assert.equal(verifyExactBytes("a", "aa", sha256Hex("a")), false);
  assert.equal(
    verifyExactBytes(Uint8Array.from([0, 1, 255]), Uint8Array.from([0, 1, 255])),
    true
  );
});

test("critical extraction covers English and Spanish safety signals", () => {
  const elements = extractCriticalElements(
    "Never delete before 2026-07-28 at 09:30; jamás deberá permitir true && total >= 12."
  );

  assert.ok(elements.some((item) => item.category === "negation" && item.value === "never"));
  assert.ok(elements.some((item) => item.category === "destructive" && item.value === "delete"));
  assert.ok(elements.some((item) => item.category === "date-time" && item.value === "2026-07-28"));
  assert.ok(elements.some((item) => item.category === "date-time" && item.value === "09:30"));
  assert.ok(elements.some((item) => item.category === "negation" && item.value === "jamás"));
  assert.ok(elements.some((item) => item.category === "imperative" && item.value === "deberá"));
  assert.ok(elements.some((item) => item.category === "boolean-null" && item.value === "true"));
  assert.ok(elements.some((item) => item.category === "operator" && item.value === ">="));
});

test("every lexical-v1 protected word and operator is classified by the public contract", () => {
  const protectedValues = {
    negation: [
      "no", "not", "never", "without", "cannot", "can't", "dont", "don't",
      "neither", "nor", "nunca", "jamás", "jamas", "sin", "tampoco", "ni"
    ],
    "boolean-null": [
      "true", "false", "null", "undefined", "verdadero", "falso", "nulo"
    ],
    destructive: [
      "delete", "remove", "drop", "reset", "destroy", "erase", "purge", "truncate",
      "overwrite", "revoke", "deny", "block", "borrar", "eliminar", "destruir",
      "reiniciar", "purgar", "truncar", "sobrescribir", "revocar", "rechazar",
      "bloquear", "borra", "borre", "borrad", "elimina", "elimine", "eliminad",
      "destruye", "destruya", "reinicia", "reinicie", "purga", "purgue", "trunca",
      "trunque", "sobrescribe", "sobrescriba", "revoca", "revoque", "rechaza",
      "rechace", "bloquea", "bloquee"
    ],
    imperative: [
      "must", "should", "shall", "required", "only", "always", "avoid", "allow",
      "approve", "commit", "push", "merge", "deploy", "execute", "run", "write",
      "debe", "debes", "deberá", "debera", "solo", "solamente", "siempre",
      "evita", "evitar", "permite", "permitir", "aprobar", "guardar", "ejecutar",
      "haz", "haga", "hagan", "permita", "aprueba", "apruebe", "guarda", "guarde",
      "ejecuta", "ejecute", "escribe", "escriba"
    ],
    operator: [
      "=", "==", "===", "!=", "!==", "<", "<=", ">", ">=", "&&", "||", "!",
      "+", "-", "*", "/", "%", "+=", "-=", "*=", "/=", "??", "=>", ":=", "&",
      "|", "^", "~", "++", "--", "<<", ">>", ">>>", "**", "**=", "%=", "&=", "|=",
      "^=", "<<=", ">>=", ">>>=", "??=", "&&=", "||="
    ]
  } as const;

  for (const [category, values] of Object.entries(protectedValues)) {
    for (const value of values) {
      assert.deepEqual(
        extractCriticalElements(value),
        [{ category, value: value.replace("’", "'").toLowerCase() }],
        `critical contract missing ${category}:${value}`
      );
    }
  }
});

test("critical differences report ordered additions and removals", () => {
  const difference = detectCriticalDifference(
    "Do not delete 12 records.",
    "Delete 13 records."
  );

  assert.equal(difference.different, true);
  assert.ok(difference.removed.some((item) => item.category === "negation"));
  assert.ok(difference.removed.some((item) => item.value === "12"));
  assert.ok(difference.added.some((item) => item.value === "13"));
  assert.equal(detectCriticalDifference("Debe permitir true.", "Debe permitir true.").different, false);
});

test("critical difference details preserve duplicate element counts", () => {
  const difference = detectCriticalDifference(
    "not not invoice 12 12",
    "not invoice 12 13 13"
  );

  assert.equal(difference.different, true);
  assert.deepEqual(difference.removed, [
    { category: "negation", value: "not" },
    { category: "number", value: "12" }
  ]);
  assert.deepEqual(difference.added, [
    { category: "number", value: "13" },
    { category: "number", value: "13" }
  ]);
  const reordered = detectCriticalDifference("not 12", "12 not");
  assert.equal(reordered.different, true);
  assert.deepEqual(reordered.added, []);
  assert.deepEqual(reordered.removed, []);

  const extended = detectCriticalDifference("not", "not 12");
  assert.equal(extended.different, true);
  assert.deepEqual(extended.added, [{ category: "number", value: "12" }]);
  assert.deepEqual(extended.removed, []);
});

test("date and time variants remain protected without treating colon ranges as dates", () => {
  const cases = [
    ["2026-07", "date-time"],
    ["2026-07-28", "date-time"],
    ["28/07/2026", "date-time"],
    ["09:30", "date-time"],
    ["09:30:45", "date-time"]
  ] as const;

  for (const [value, category] of cases) {
    assert.deepEqual(
      extractCriticalElements(value),
      [{ category, value }],
      `critical date/time contract missing ${value}`
    );
  }

  assert.equal(
    extractCriticalElements("2026:07").some((item) => item.category === "date-time"),
    false
  );
  assert.equal(
    extractCriticalElements("09:3").some((item) => item.category === "date-time"),
    false
  );
  assert.equal(detectCriticalDifference("Deploy at 09:30.", "Deploy at 09:31.").different, true);
  assert.equal(detectCriticalDifference("Release 2026-07-28.", "Release 2026-07-29.").different, true);
});

test("date and time recognition rejects leading, trailing, and partial junk", () => {
  for (const malformed of [
    "x2026-07-28",
    "2026-07-28x",
    "2026-07-28-extra",
    "x2026/07/28",
    "2026/07/28/extra",
    "x09:30:45",
    "09:30:45x",
    "09:30:45:extra"
  ]) {
    assert.equal(
      extractCriticalElements(malformed).some((item) => item.category === "date-time"),
      false,
      `malformed date/time was accepted: ${malformed}`
    );
  }
});

test("date and time adjacency checks do not cross whitespace boundaries", () => {
  for (const input of [
    "archive - 2026-07-28",
    "2026-07-28 - archive",
    "archive / 28/07/2026",
    "28/07/2026 / archive",
    "archive : 09:30:45",
    "09:30:45 : archive"
  ]) {
    assert.equal(
      extractCriticalElements(input).filter((item) => item.category === "date-time").length,
      1,
      `valid separated date/time was rejected: ${input}`
    );
  }
});

test("number extraction accepts only complete numeric tokens", () => {
  assert.deepEqual(extractCriticalElements("4815"), [
    { category: "number", value: "4815" }
  ]);
  assert.deepEqual(extractCriticalElements("12.50"), [
    { category: "number", value: "12" },
    { category: "number", value: "50" }
  ]);
  assert.deepEqual(extractCriticalElements("12,500"), [
    { category: "number", value: "12" },
    { category: "number", value: "500" }
  ]);
  for (const malformed of ["12abc", "12a34", "abc12"]) {
    assert.deepEqual(
      extractCriticalElements(malformed),
      [],
      `malformed number was accepted: ${malformed}`
    );
  }
});

test("apostrophe-split English contractions remain protected negations", () => {
  const straight = extractCriticalElements("You can't delete the backup.");
  const curly = extractCriticalElements("You don’t overwrite the release.");

  assert.ok(straight.some((item) => item.category === "negation" && item.value === "can't"));
  assert.ok(curly.some((item) => item.category === "negation" && item.value === "don't"));

  const safe = [
    "The operator can delete the archived preview after approval.",
    "The workflow records the decision and preserves the full audit trail.",
    "Every exact source remains available through its expansion handle."
  ].join(" ");
  const changed = safe.replace("can delete", "can't delete");
  const result = classifyFingerprintMatch(safe, changed);

  assert.equal(result.criticalDiff, true);
  assert.notEqual(result.matchKind, "strong_related");
  assert.equal(result.mustExpand, true);
});

test("contraction protection requires a contiguous n-apostrophe-t sequence", () => {
  for (const contraction of ["can't", "won't", "isn't", "DON'T", "don\u2019t"]) {
    assert.deepEqual(
      extractCriticalElements(contraction),
      [{ category: "negation", value: contraction.toLowerCase().replace("\u2019", "'") }]
    );
  }

  for (const separated of ["can ' t", "can' t", "can 't"]) {
    assert.deepEqual(extractCriticalElements(separated), []);
  }
  assert.deepEqual(extractCriticalElements("cant"), []);
});

test("malformed and partial contractions are not protected negations", () => {
  for (const malformed of [
    "'t",
    "ca't",
    "cat't",
    "12n't",
    "can-t",
    "can`t",
    "can'x",
    "can'",
    "n't"
  ]) {
    assert.equal(
      extractCriticalElements(malformed).some((item) => item.category === "negation"),
      false,
      `malformed contraction was accepted: ${malformed}`
    );
  }
});

test("Spanish destructive imperatives and bitwise operators are critical", () => {
  const safe = [
    "Conserva el archivo de respaldo hasta que finalice la revisión aprobada.",
    "El sistema registra flags & ADMIN y conserva la evidencia completa.",
    "Los auditores verifican cada decisión antes de ejecutar el proceso."
  ].join(" ");
  const destructive = safe.replace("Conserva el archivo", "Borra el archivo");
  const operatorChanged = safe.replace("flags & ADMIN", "flags | ADMIN");

  for (const changed of [destructive, operatorChanged]) {
    const result = classifyFingerprintMatch(safe, changed);
    assert.equal(result.criticalDiff, true);
    assert.notEqual(result.matchKind, "strong_related");
    assert.equal(result.mustExpand, true);
  }
});

test("byte-identical content is exact with a perfect score", () => {
  const text = "alpha bravo charlie delta echo foxtrot golf hotel india";
  const result = classifyFingerprintMatch(text, text);

  assert.equal(result.matchKind, "exact");
  assert.equal(result.exact, true);
  assert.equal(result.mustExpand, false);
  assert.equal(result.criticalDiff, false);
  assert.equal(result.score, 1);
});

test("token-equivalent line ending changes are normalized_equal, never exact", () => {
  const result = classifyFingerprintMatch(
    "alpha bravo\r\ncharlie delta",
    "alpha bravo\ncharlie delta"
  );

  assert.equal(result.matchKind, "normalized_equal");
  assert.equal(result.exact, false);
  assert.equal(result.mustExpand, true);
});

test("short and low-entropy inputs use keyword fallback", () => {
  assert.equal(classifyFingerprintMatch("alpha beta", "alpha gamma").matchKind, "keyword");
  assert.equal(
    classifyFingerprintMatch("repeat repeat repeat repeat repeat", "repeat repeat repeat repeat other").matchKind,
    "keyword"
  );
});

test("a critical mutation cannot be classified as strong related", () => {
  const query = [
    "The operator must never delete invoice 4815 before settlement review.",
    "The workflow records every approval and sends a compliance notification.",
    "Auditors inspect the complete transaction history after the final decision."
  ].join(" ");
  const candidate = query.replace("never delete invoice 4815", "delete invoice 4816");
  const result = classifyFingerprintMatch(query, candidate);

  assert.equal(result.criticalDiff, true);
  assert.notEqual(result.matchKind, "exact");
  assert.notEqual(result.matchKind, "strong_related");
  assert.notEqual(result.matchKind, "related_reordered");
  assert.equal(result.mustExpand, true);
});

test("an inserted prefix preserves a coherent strong match", () => {
  const paragraphs = longParagraphs();
  const result = classifyFingerprintMatch(
    paragraphs.join(" "),
    ["Introductory context appears first.", ...paragraphs].join(" ")
  );

  assert.equal(result.matchKind, "strong_related");
  assert.equal(result.metrics.alignmentPeaks, 1);
  assert.equal(result.exact, false);
  assert.equal(result.mustExpand, true);
});

test("multiple coherent offsets recognize reordered material as advisory", () => {
  const paragraphs = longParagraphs();
  const result = classifyFingerprintMatch(
    paragraphs.join(" "),
    [paragraphs[2], paragraphs[3], paragraphs[0], paragraphs[1], paragraphs[4]].join(" ")
  );

  assert.equal(result.matchKind, "related_reordered");
  assert.ok(result.metrics.alignmentPeaks >= 2);
  assert.equal(result.exact, false);
  assert.equal(result.mustExpand, true);
});

test("strong-related thresholds require every signal and include exact boundaries", () => {
  const pair = syntheticMatcherPair("aligned");
  const metrics = scoreFingerprintMatch(pair.query, pair.candidate);
  const thresholds: MatchThresholds = {
    strongTokenContainment: metrics.tokenContainment,
    strongCharacterJaccard: metrics.characterJaccard,
    strongAlignmentDominance: metrics.alignmentDominance,
    strongMinimumVotes: metrics.usefulVotes,
    relatedTokenContainment: 1.1,
    relatedCharacterJaccard: 1.1
  };

  assert.equal(classifySyntheticPair(pair, thresholds).matchKind, "strong_related");

  const failures: Array<[keyof MatchThresholds, number]> = [
    ["strongTokenContainment", metrics.tokenContainment + Number.EPSILON],
    ["strongCharacterJaccard", metrics.characterJaccard + Number.EPSILON],
    ["strongAlignmentDominance", metrics.alignmentDominance + Number.EPSILON],
    ["strongMinimumVotes", metrics.usefulVotes + 1]
  ];
  for (const [signal, failingThreshold] of failures) {
    assert.equal(
      classifySyntheticPair(pair, { ...thresholds, [signal]: failingThreshold }).matchKind,
      "unrelated",
      `strong-related did not require ${signal}`
    );
  }
});

test("reordered thresholds require aggregate signals, votes, and two peaks", () => {
  const reordered = syntheticMatcherPair("reordered");
  const metrics = scoreFingerprintMatch(reordered.query, reordered.candidate);
  const thresholds: MatchThresholds = {
    strongTokenContainment: 1.1,
    strongCharacterJaccard: metrics.characterJaccard,
    strongAlignmentDominance: 1.1,
    strongMinimumVotes: metrics.usefulVotes,
    relatedTokenContainment: metrics.tokenContainment,
    relatedCharacterJaccard: 1.1
  };

  assert.equal(metrics.alignmentPeaks, 2);
  assert.equal(classifySyntheticPair(reordered, thresholds).matchKind, "related_reordered");
  assert.notEqual(
    classifySyntheticPair(reordered, {
      ...thresholds,
      relatedTokenContainment: metrics.tokenContainment + Number.EPSILON
    }).matchKind,
    "related_reordered"
  );
  assert.notEqual(
    classifySyntheticPair(reordered, {
      ...thresholds,
      strongCharacterJaccard: metrics.characterJaccard + Number.EPSILON
    }).matchKind,
    "related_reordered"
  );
  assert.notEqual(
    classifySyntheticPair(reordered, {
      ...thresholds,
      strongMinimumVotes: metrics.usefulVotes + 1
    }).matchKind,
    "related_reordered"
  );

  const aligned = syntheticMatcherPair("aligned");
  assert.equal(scoreFingerprintMatch(aligned.query, aligned.candidate).alignmentPeaks, 1);
  assert.notEqual(
    classifySyntheticPair(aligned, {
      ...thresholds,
      strongMinimumVotes: scoreFingerprintMatch(aligned.query, aligned.candidate).usefulVotes
    }).matchKind,
    "related_reordered"
  );
});

test("related classification uses either similarity signal and includes boundaries", () => {
  const pair = syntheticMatcherPair("aligned");
  const metrics = scoreFingerprintMatch(pair.query, pair.candidate);
  const base: MatchThresholds = {
    strongTokenContainment: 1.1,
    strongCharacterJaccard: 1.1,
    strongAlignmentDominance: 1.1,
    strongMinimumVotes: metrics.usefulVotes + 1,
    relatedTokenContainment: metrics.tokenContainment,
    relatedCharacterJaccard: metrics.characterJaccard
  };

  assert.equal(classifySyntheticPair(pair, base).matchKind, "related");
  assert.equal(
    classifySyntheticPair(pair, {
      ...base,
      relatedCharacterJaccard: metrics.characterJaccard + Number.EPSILON
    }).matchKind,
    "related"
  );
  assert.equal(
    classifySyntheticPair(pair, {
      ...base,
      relatedTokenContainment: metrics.tokenContainment + Number.EPSILON
    }).matchKind,
    "related"
  );
  assert.equal(
    classifySyntheticPair(pair, {
      ...base,
      relatedTokenContainment: metrics.tokenContainment + Number.EPSILON,
      relatedCharacterJaccard: metrics.characterJaccard + Number.EPSILON
    }).matchKind,
    "unrelated"
  );
});

test("unrelated documents remain unrelated and scores are bounded", () => {
  const left = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const right = "uno dos tres cuatro cinco seis siete ocho nueve diez";
  const result = classifyFingerprintMatch(left, right);

  assert.equal(result.matchKind, "unrelated");
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.score >= 0 && result.score <= 1);
});

function makeHashableUnits(values: readonly string[]): HashableUnit[] {
  return values.map((value, index) => ({
    value,
    normalizedStart: index,
    normalizedEnd: index + 1,
    rawByteStart: index,
    rawByteEnd: index + 1
  }));
}

function makeNgrams(hashes: readonly bigint[]): HashedNgram[] {
  return hashes.map((hash, position) => ({
    hash,
    position,
    endPosition: position + 1,
    rawByteStart: position,
    rawByteEnd: position + 1
  }));
}

function buildMappedReferenceDocument(input: string): FingerprintDocument {
  const strict = normalizeStrict(input);
  const recall = normalizeRecall(strict);
  const tokens = tokenizeStrict(strict);
  return {
    profile: LEXICAL_PROFILE.id,
    rawByteLength: Buffer.byteLength(input),
    sha256: sha256Hex(input),
    strictText: strict.text,
    strictTokenValues: tokens.map((token) => token.value),
    tokens,
    recallText: recall.text,
    tokenFingerprints: referenceFingerprints(
      winnow(
        rollingNgrams(tokens, LEXICAL_PROFILE.tokenNgramSize),
        LEXICAL_PROFILE.tokenWindowSize
      ),
      "token"
    ),
    characterFingerprints: referenceFingerprints(
      winnow(
        rollingNgrams(recall.units, LEXICAL_PROFILE.characterNgramSize),
        LEXICAL_PROFILE.characterWindowSize
      ),
      "character"
    )
  };
}

function referenceFingerprints(
  ngrams: readonly HashedNgram[],
  channel: "token" | "character"
): FingerprintDocument["tokenFingerprints"] {
  return ngrams.map((ngram) => ({
    profile: LEXICAL_PROFILE.id,
    channel,
    hash: hashToHex(ngram.hash),
    position: ngram.position,
    endPosition: ngram.endPosition,
    rawByteStart: ngram.rawByteStart,
    rawByteEnd: ngram.rawByteEnd
  }));
}

function boundReferenceDocument(
  full: FingerprintDocument,
  limit: number
): ReturnType<typeof buildBoundedFingerprintDocument> {
  let tokenBudget = Math.ceil(limit / 2);
  let tokenFingerprints = full.tokenFingerprints.slice(0, tokenBudget);
  let tokenComplete = full.tokenFingerprints.length <= tokenBudget;
  const characterBudget = tokenComplete
    ? limit - tokenFingerprints.length
    : Math.floor(limit / 2);
  const characterFingerprints = full.characterFingerprints.slice(0, characterBudget);
  const characterComplete = full.characterFingerprints.length <= characterBudget;

  if (!tokenComplete && characterComplete && characterFingerprints.length < characterBudget) {
    tokenBudget = limit - characterFingerprints.length;
    tokenFingerprints = full.tokenFingerprints.slice(0, tokenBudget);
    tokenComplete = full.tokenFingerprints.length <= tokenBudget;
  }

  return {
    document: {
      ...full,
      tokenFingerprints,
      characterFingerprints
    },
    complete: tokenComplete && characterComplete
  };
}

function syntheticMatcherPair(
  alignment: "aligned" | "reordered"
): {
  query: FingerprintDocument;
  candidate: FingerprintDocument;
  queryText: string;
  candidateText: string;
} {
  const queryText = "alpha bravo charlie delta echo foxtrot";
  const candidateText = "alpha bravo charlie delta echo golf";
  const tokenHashes = [
    "0000000000000001",
    "0000000000000002",
    "0000000000000003",
    "0000000000000004",
    "0000000000000005",
    "0000000000000006"
  ];
  const queryPositions = [0, 1, 2, 3, 4, 5];
  const candidatePositions = alignment === "aligned"
    ? [10, 11, 12, 13, 14, 15]
    : [10, 11, 12, 23, 24, 25];
  const characterHashes = [
    "1000000000000001",
    "1000000000000002",
    "1000000000000003",
    "1000000000000004"
  ];
  const queryBase = buildFingerprintDocument(queryText);
  const candidateBase = buildFingerprintDocument(candidateText);

  return {
    queryText,
    candidateText,
    query: {
      ...queryBase,
      strictTokenValues: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"],
      tokenFingerprints: tokenHashes.map((hash, index) =>
        syntheticFingerprint(hash, queryPositions[index]!, "token")
      ),
      characterFingerprints: characterHashes.map((hash, position) =>
        syntheticFingerprint(hash, position, "character")
      )
    },
    candidate: {
      ...candidateBase,
      strictTokenValues: ["alpha", "bravo", "charlie", "delta", "echo", "golf"],
      tokenFingerprints: tokenHashes.map((hash, index) =>
        syntheticFingerprint(hash, candidatePositions[index]!, "token")
      ),
      characterFingerprints: [
        ...characterHashes.map((hash, position) =>
          syntheticFingerprint(hash, position, "character")
        ),
        syntheticFingerprint("1000000000000005", 4, "character")
      ]
    }
  };
}

function syntheticFingerprint(
  hash: string,
  position: number,
  channel: "token" | "character"
): FingerprintDocument["tokenFingerprints"][number] {
  return {
    profile: LEXICAL_PROFILE.id,
    channel,
    hash,
    position,
    endPosition: position + 1,
    rawByteStart: position,
    rawByteEnd: position + 1
  };
}

function classifySyntheticPair(
  pair: ReturnType<typeof syntheticMatcherPair>,
  thresholds: Readonly<MatchThresholds>
): ReturnType<typeof classifyFingerprintDocuments> {
  return classifyFingerprintDocuments(
    pair.query,
    pair.candidate,
    pair.queryText,
    pair.candidateText,
    thresholds
  );
}

function longParagraphs(): string[] {
  return [
    "The careful analyst reviews every invoice before approving the settlement request.",
    "The compliance system records each decision with a complete timestamp and operator identifier.",
    "Auditors inspect the transaction history and verify supporting documents during monthly review.",
    "The notification service sends a detailed report to the finance and risk management teams.",
    "This workflow protects customers while preserving an accurate record for future investigation."
  ];
}
