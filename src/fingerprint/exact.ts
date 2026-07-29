import crypto from "node:crypto";

export function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function verifyExactBytes(
  query: string | Uint8Array,
  candidate: string | Uint8Array,
  expectedCandidateDigest?: string
): boolean {
  const queryBytes = toBuffer(query);
  const candidateBytes = toBuffer(candidate);
  const queryDigest = Buffer.from(sha256Hex(queryBytes), "hex");
  const candidateDigestHex = expectedCandidateDigest ?? sha256Hex(candidateBytes);
  if (!/^[a-f0-9]{64}$/i.test(candidateDigestHex)) {
    return false;
  }
  const candidateDigest = Buffer.from(candidateDigestHex, "hex");
  return (
    crypto.timingSafeEqual(queryDigest, candidateDigest)
    && queryBytes.equals(candidateBytes)
  );
}

function toBuffer(value: string | Uint8Array): Buffer {
  return Buffer.from(value);
}

