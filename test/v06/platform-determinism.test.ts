import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildFingerprintDocument,
  classifyFingerprintMatch
} from "../../src/fingerprint/index.js";

test("Unicode and CRLF fingerprint digest is identical across supported platforms", () => {
  const text = "Cafe\u0301\r\nmañana\r🙂\nvalidate_$ID !== 2026-07-28 && precio >= 12.50;";
  const document = buildFingerprintDocument(text);
  const digest = createHash("sha256")
    .update(JSON.stringify(document), "utf8")
    .digest("hex");

  assert.equal(digest, "4177709fbb10f853b5c324e124282d9801e8a2d25960ef1d2c1eafe05bd4af09");
  assert.equal(
    classifyFingerprintMatch(text, text.replace(/\r\n?/gu, "\n")).matchKind,
    "normalized_equal"
  );
});
