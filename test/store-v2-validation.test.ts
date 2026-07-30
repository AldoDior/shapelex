import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  StoreBusyError,
  StoreFormatError,
  StoreRevisionConflictError,
  TransactionalStoreV2,
  migrateV1Store,
  parseStoreEnvelope,
  sourceRecordFromMaterial
} from "../src/storage/index.js";

test("validates migration inputs and supports explicit source enumeration", () => {
  assert.throws(
    () => migrateV1Store(
      { version: 1, savedAt: 42, sessions: [] } as never,
      { workspaceId: "workspace" }
    ),
    /savedAt/
  );
  assert.throws(
    () => migrateV1Store({ version: 1, sessions: [] }, {
      workspaceId: "workspace",
      enumerateSources() {
        return [{
          bytes: "not bytes" as unknown as Uint8Array,
          origin: { kind: "text", sessionId: "s", documentId: "d" }
        }];
      }
    }),
    /Uint8Array/
  );

  const material = {
    bytes: Buffer.from("enumerated", "utf8"),
    origin: {
      kind: "text" as const,
      sessionId: "s",
      documentId: "d"
    }
  };
  const migrated = migrateV1Store({ version: 1, sessions: [{ id: "s" }] }, {
    workspaceId: "workspace",
    fingerprintProfile: "test-profile",
    enumerateSources() {
      return [
        material,
        material,
        {
          ...material,
          bytes: Buffer.from("second enumerated source", "utf8"),
          origin: { ...material.origin, documentId: "d2" }
        }
      ];
    }
  });
  assert.equal(migrated.fingerprintProfile, "test-profile");
  assert.equal(migrated.sources.length, 2);
  assert.ok(migrated.sources.every((source) => source.origins.length === 1));
});

test("text sources round-trip once while file-only sources remain metadata-only", () => {
  const exactText = "No borrar el café ☕ before 2026-08-01.\r\n";
  const exactBytes = Buffer.from(exactText, "utf8");
  const migrated = migrateV1Store({ version: 1, sessions: [{ id: "s" }] }, {
    workspaceId: "workspace",
    enumerateSources() {
      return [
        {
          bytes: exactBytes,
          origin: {
            kind: "file",
            sessionId: "s",
            documentId: "file-doc",
            relativePath: "notes.txt"
          }
        },
        {
          bytes: exactBytes,
          origin: { kind: "text", sessionId: "s", documentId: "text-doc" }
        }
      ];
    }
  });

  assert.equal(migrated.sources.length, 1);
  assert.equal(migrated.sources[0]!.text, exactText);
  assert.equal(migrated.sources[0]!.origins.length, 2);
  const roundTripped = parseStoreEnvelope(
    JSON.stringify(migrated),
    { workspaceId: "workspace" }
  ).envelope;
  assert.equal(roundTripped.sources[0]!.text, exactText);
  assert.equal(
    Buffer.byteLength(roundTripped.sources[0]!.text!, "utf8"),
    roundTripped.sources[0]!.byteLength
  );

  const fileOnly = sourceRecordFromMaterial({
    bytes: Buffer.from("valid file-backed UTF-8", "utf8"),
    origin: {
      kind: "file",
      sessionId: "s",
      documentId: "binary-file",
      relativePath: "binary.dat"
    }
  });
  assert.equal(fileOnly.text, undefined);
});

test("text source creation rejects invalid UTF-8 and loading rejects content tampering", () => {
  assert.throws(
    () => sourceRecordFromMaterial({
      bytes: Buffer.from([0xff, 0xfe, 0xfd]),
      origin: {
        kind: "file",
        sessionId: "s",
        documentId: "d",
        relativePath: "invalid.txt"
      }
    }),
    /valid UTF-8/
  );

  const valid = migrateV1Store({ version: 1, sessions: [] }, {
    workspaceId: "workspace",
    enumerateSources() {
      return [{
        bytes: Buffer.from("immutable source", "utf8"),
        origin: { kind: "text", sessionId: "s", documentId: "d" }
      }];
    }
  });
  const source = valid.sources[0]!;
  for (const tampered of [
    { ...source, text: "changed source" },
    { ...source, byteLength: source.byteLength + 1 },
    { ...source, text: undefined },
    {
      ...source,
      origins: [{
        kind: "file",
        sessionId: "s",
        documentId: "d",
        relativePath: "source.txt"
      }]
    }
  ]) {
    assert.throws(
      () => parseStoreEnvelope(JSON.stringify({
        ...valid,
        sources: [tampered]
      }), { workspaceId: "workspace" }),
      StoreFormatError
    );
  }
});

test("validates JSON envelope shape and source metadata defensively", () => {
  assert.throws(
    () => parseStoreEnvelope("{", { workspaceId: "workspace" }),
    /not valid JSON/
  );
  for (const value of [null, [], {}, { version: "2" }]) {
    assert.throws(
      () => parseStoreEnvelope(JSON.stringify(value), { workspaceId: "workspace" }),
      StoreFormatError
    );
  }

  const valid = migrateV1Store({ version: 1, sessions: [] }, { workspaceId: "workspace" });
  const invalidEnvelopes: unknown[] = [
    { ...valid, revision: -1 },
    { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, savedAt: 1 },
    { ...valid, workspaceId: 1 },
    { ...valid, checksumAlgorithm: "sha1" },
    { ...valid, fingerprintProfile: "" },
    { ...valid, sessions: null },
    { ...valid, sources: null },
    { ...valid, index: null },
    { ...valid, index: { strategy: "persistent", state: "warm" } },
    { ...valid, index: { strategy: "lazy-memory-only", state: "warm" } },
    {
      ...valid,
      sources: [{
        sourceId: "source_bad",
        checksumAlgorithm: "sha256",
        sha256: "bad",
        byteLength: -1,
        mediaType: "text/utf8",
        origins: [],
        legacyChecksums: []
      }]
    }
  ];
  for (const envelope of invalidEnvelopes) {
    assert.throws(
      () => parseStoreEnvelope(JSON.stringify(envelope), { workspaceId: "workspace" }),
      StoreFormatError
    );
  }

  const source = sourceRecordFromMaterial({
    bytes: Buffer.from("source", "utf8"),
    origin: { kind: "text", sessionId: "s", documentId: "d" }
  });
  assert.equal(parseStoreEnvelope(JSON.stringify({
    ...valid,
    sources: [{ ...source, legacyChecksums: ["legacy"] }]
  }), { workspaceId: "workspace" }).envelope.sources.length, 1);
  for (const badSource of [
    null,
    { ...source, sourceId: 1 },
    { ...source, checksumAlgorithm: "sha1" },
    { ...source, sha256: `${source.sha256.slice(0, 63)}z` },
    { ...source, sourceId: "source_mismatch" },
    { ...source, byteLength: -1 },
    { ...source, byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { ...source, mediaType: "application/octet-stream" },
    { ...source, origins: [] },
    { ...source, legacyChecksums: null },
    { ...source, legacyChecksums: [1] }
  ]) {
    assert.throws(
      () => parseStoreEnvelope(JSON.stringify({
        ...valid,
        sources: [badSource]
      }), { workspaceId: "workspace" }),
      StoreFormatError
    );
  }
  for (const badOrigin of [
    null,
    { kind: "text", sessionId: 1, documentId: "d" },
    { kind: "text", sessionId: "s", documentId: 1 },
    { kind: "unknown", sessionId: "s", documentId: "d" },
    { kind: "file", sessionId: "s", documentId: "d" }
  ]) {
    assert.throws(
      () => parseStoreEnvelope(JSON.stringify({
        ...valid,
        sources: [{ ...source, origins: [badOrigin] }]
      }), { workspaceId: "workspace" }),
      StoreFormatError
    );
  }
});

test("constructor and transaction boundary validation is explicit", () => {
  assert.throws(
    () => new TransactionalStoreV2({ persistent: true, workspaceId: "workspace" }),
    /requires storePath/
  );
  for (const workspaceId of ["", "   "]) {
    assert.throws(
      () => new TransactionalStoreV2({ persistent: false, workspaceId }),
      /workspaceId/
    );
  }
  assert.throws(
    () => new TransactionalStoreV2({
      persistent: false,
      workspaceId: "workspace",
      maxStoreBytes: 0
    }),
    /maxStoreBytes/
  );
  assert.throws(
    () => new TransactionalStoreV2({
      persistent: false,
      workspaceId: "workspace",
      lockTimeoutMs: -1
    }),
    /lockTimeoutMs/
  );

  const store = new TransactionalStoreV2<unknown>({ persistent: false, workspaceId: "workspace" });
  assert.equal(store.needsRefresh(), false);
  assert.equal(store.refreshIfChanged(), false);
  assert.throws(
    () => store.transact(null as never),
    {
      name: "TypeError",
      message: "ShapeLex store transaction requires a mutator function"
    }
  );
  assert.throws(
    () => store.transact(() => undefined, { expectedRevision: -1 }),
    /expectedRevision/
  );
  assert.throws(
    () => store.transact(() => undefined, { expectedRevision: 1 }),
    StoreRevisionConflictError
  );
  assert.throws(
    () => store.transact((draft) => {
      draft.sessions.push(1n);
    }),
    /cannot be serialized/
  );
  assert.throws(
    () => store.transact((draft) => {
      (draft as unknown as { index: null }).index = null;
    }),
    /invalid state/
  );
  assert.throws(
    () => store.transact((draft) => {
      draft.sources.push({ sourceId: "bad" } as never);
    }),
    /source record/
  );
});

test("rejects non-file store paths", () => {
  withTemporaryDirectory((directory) => {
    assert.throws(
      () => new TransactionalStoreV2({
        storePath: directory,
        workspaceId: "workspace"
      }),
      /not a regular file/
    );
  });
});

test("default PID checks recover a dead process and retain a live owner", () => {
  withTemporaryDirectory((directory) => {
    const liveStorePath = path.join(directory, "live.json");
    fs.writeFileSync(`${liveStorePath}.lock`, JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      ownerToken: "live"
    }));
    const live = new TransactionalStoreV2({
      storePath: liveStorePath,
      workspaceId: "workspace",
      lockTimeoutMs: 0
    });
    assert.throws(() => live.transact(() => undefined), StoreBusyError);
    fs.unlinkSync(`${liveStorePath}.lock`);

    const deadStorePath = path.join(directory, "dead.json");
    fs.writeFileSync(`${deadStorePath}.lock`, JSON.stringify({
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      ownerToken: "dead"
    }));
    const dead = new TransactionalStoreV2({
      storePath: deadStorePath,
      workspaceId: "workspace",
      lockTimeoutMs: 50
    });
    dead.transact(() => undefined);
    assert.equal(fs.existsSync(`${deadStorePath}.lock`), false);
  });
});

test("lock release never removes a lock that changed owners or already disappeared", () => {
  withTemporaryDirectory((directory) => {
    const replacedPath = path.join(directory, "replaced.json");
    const replacedLockPath = `${replacedPath}.lock`;
    const replaced = new TransactionalStoreV2({
      storePath: replacedPath,
      workspaceId: "workspace",
      onBeforeRename() {
        fs.writeFileSync(replacedLockPath, JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: new Date().toISOString(),
          ownerToken: "replacement"
        }));
      }
    });
    replaced.transact(() => undefined);
    assert.equal(JSON.parse(fs.readFileSync(replacedLockPath, "utf8")).ownerToken, "replacement");
    fs.unlinkSync(replacedLockPath);

    const missingPath = path.join(directory, "missing.json");
    const missingLockPath = `${missingPath}.lock`;
    const missing = new TransactionalStoreV2({
      storePath: missingPath,
      workspaceId: "workspace",
      onBeforeRename() {
        fs.unlinkSync(missingLockPath);
      }
    });
    missing.transact(() => undefined);
    assert.equal(fs.existsSync(missingLockPath), false);
  });
});

function withTemporaryDirectory(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-store-v2-validation-"));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
