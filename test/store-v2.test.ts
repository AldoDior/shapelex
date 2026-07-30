import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  StoreBusyError,
  StoreFormatError,
  StoreRevisionConflictError,
  StoreSizeLimitError,
  TransactionalStoreV2,
  UnsupportedStoreVersionError,
  migrateV1Store,
  parseStoreEnvelope,
  sha256Hex
} from "../src/storage/index.js";

interface TestSession {
  id: string;
  nextDocument?: number;
  documents?: Array<Record<string, unknown>>;
  handles?: string[];
}

test("migrates v1 without changing sessions or sx handles and deduplicates exact sources", () => {
  const sessions: TestSession[] = [{
    id: "migration",
    nextDocument: 3,
    handles: ["sx://migration/doc/doc_1", "sx://migration/span/span_1"],
    documents: [
      {
        id: "doc_1",
        uri: "sx://migration/doc/doc_1",
        text: "Do not approve invoice 4815.",
        checksum: "legacy-a"
      },
      {
        id: "doc_2",
        uri: "sx://migration/doc/doc_2",
        text: "Do not approve invoice 4815.",
        checksum: "legacy-b"
      }
    ]
  }];
  const original = structuredClone(sessions);

  const migrated = migrateV1Store(
    { version: 1, savedAt: "2026-01-01T00:00:00.000Z", sessions },
    { workspaceId: "workspace-1" }
  );

  assert.equal(migrated.version, 2);
  assert.equal(migrated.revision, 0);
  assert.deepEqual(migrated.sessions, original);
  assert.deepEqual(sessions, original);
  assert.equal(migrated.sources.length, 1);
  assert.equal(migrated.sources[0]!.sha256, sha256Hex("Do not approve invoice 4815."));
  assert.equal(migrated.sources[0]!.text, "Do not approve invoice 4815.");
  assert.equal(migrated.sources[0]!.origins.length, 2);
  assert.deepEqual(migrated.sources[0]!.legacyChecksums.sort(), ["legacy-a", "legacy-b"]);
});

test("migration hashes file-backed sources only through the explicit verification hook", () => {
  const bytes = Buffer.from("verified file bytes", "utf8");
  const migrated = migrateV1Store<TestSession>({
    version: 1,
    sessions: [{
      id: "files",
      documents: [{
        id: "doc_1",
        checksum: "legacy-file",
        source: { kind: "file", relativePath: "notes/important.txt" }
      }]
    }]
  }, {
    workspaceId: "workspace-1",
    resolveFileSource(context) {
      assert.equal(context.relativePath, "notes/important.txt");
      return bytes;
    }
  });

  assert.equal(migrated.sources.length, 1);
  assert.equal(migrated.sources[0]!.sha256, sha256Hex(bytes));
  assert.deepEqual(migrated.sources[0]!.origins[0], {
    kind: "file",
    sessionId: "files",
    documentId: "doc_1",
    relativePath: "notes/important.txt"
  });
});

test("rejects unknown future versions without rewriting the store", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const future = JSON.stringify({ version: 99, revision: 50, sessions: [] });
    fs.writeFileSync(storePath, future, "utf8");

    assert.throws(
      () => new TransactionalStoreV2<TestSession>({ storePath, workspaceId: "workspace-1" }),
      UnsupportedStoreVersionError
    );
    assert.equal(fs.readFileSync(storePath, "utf8"), future);
    assert.equal(fs.existsSync(`${storePath}.lock`), false);
  });
});

test("persists a migrated v1 envelope only after a successful mutation", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      sessions: [{ id: "legacy", handles: ["sx://legacy/span/span_1"] }]
    }), "utf8");
    const store = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1"
    });

    assert.equal(store.migrationPending, true);
    assert.equal(JSON.parse(fs.readFileSync(storePath, "utf8")).version, 1);

    store.transact((draft) => {
      draft.sessions.push({ id: "new" });
    });
    const persisted = JSON.parse(fs.readFileSync(storePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal(persisted.revision, 1);
    assert.equal(persisted.sessions[0].handles[0], "sx://legacy/span/span_1");
    assert.equal(store.migrationPending, false);
  });
});

test("atomic write failure preserves the previous revision and removes temporary files", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const initial = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1"
    });
    initial.transact((draft) => {
      draft.sessions.push({ id: "stable" });
    });
    const before = fs.readFileSync(storePath, "utf8");

    const failing = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1",
      onBeforeRename() {
        throw new Error("simulated rename boundary failure");
      }
    });
    assert.throws(
      () => failing.transact((draft) => draft.sessions.push({ id: "must-rollback" })),
      /simulated rename boundary failure/
    );

    assert.equal(fs.readFileSync(storePath, "utf8"), before);
    assert.equal(failing.revision, 1);
    assert.equal(fs.existsSync(`${storePath}.lock`), false);
    assert.deepEqual(
      fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp")),
      []
    );
  });
});

test("mutator and validation failures roll back without leaving a lock", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const store = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1"
    });
    store.transact((draft) => {
      draft.sessions.push({ id: "stable" });
    });
    const before = fs.readFileSync(storePath, "utf8");

    assert.throws(
      () => store.transact(() => {
        throw new Error("mutator failed");
      }),
      /mutator failed/
    );
    assert.equal(fs.readFileSync(storePath, "utf8"), before);
    assert.equal(store.revision, 1);
    assert.equal(fs.existsSync(`${storePath}.lock`), false);

    assert.throws(
      () => store.transact((draft) => {
        (draft as unknown as { sessions: null }).sessions = null;
      }),
      StoreFormatError
    );
    assert.equal(fs.readFileSync(storePath, "utf8"), before);
    assert.equal(store.revision, 1);
    assert.equal(fs.existsSync(`${storePath}.lock`), false);
  });
});

test("partial writes are completed before commit and directory fsync failure is best effort", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const mutableFs = fs as unknown as {
      writeSync: (...args: unknown[]) => number;
      fsyncSync: (...args: unknown[]) => void;
    };
    const originalWriteSync = mutableFs.writeSync;
    const originalFsyncSync = mutableFs.fsyncSync;
    let partialWrites = 0;
    let ignoredDirectoryFsyncFailure = false;
    try {
      mutableFs.writeSync = (...args: unknown[]) => {
        const requestedLength = Number(args[3]);
        const limitedLength = Math.min(requestedLength, 7);
        if (limitedLength < requestedLength) {
          partialWrites += 1;
        }
        return originalWriteSync(args[0], args[1], args[2], limitedLength);
      };
      mutableFs.fsyncSync = (...args: unknown[]) => {
        const fd = Number(args[0]);
        if (fs.fstatSync(fd).isDirectory()) {
          ignoredDirectoryFsyncFailure = true;
          throw errnoError("EINVAL");
        }
        originalFsyncSync(fd);
      };

      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1"
      });
      store.transact((draft) => {
        draft.sessions.push({ id: "written-in-small-chunks", handles: ["x".repeat(100)] });
      });

      assert.ok(partialWrites > 0);
      assert.equal(ignoredDirectoryFsyncFailure, true);
      assert.equal(JSON.parse(fs.readFileSync(storePath, "utf8")).revision, 1);
      assert.equal(fs.existsSync(`${storePath}.lock`), false);
    } finally {
      mutableFs.writeSync = originalWriteSync;
      mutableFs.fsyncSync = originalFsyncSync;
    }
  });
});

test("failed lock-file writes clean up only the newly created lock", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    const mutableFs = fs as unknown as {
      writeSync: (...args: unknown[]) => number;
    };
    const originalWriteSync = mutableFs.writeSync;
    let failNextWrite = true;
    try {
      mutableFs.writeSync = (...args: unknown[]) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw errnoError("EIO");
        }
        return originalWriteSync(...args);
      };
      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1"
      });

      assert.throws(
        () => store.transact((draft) => {
          draft.sessions.push({ id: "not-committed" });
        }),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "EIO"
      );
      assert.equal(fs.existsSync(lockPath), false);

      store.transact((draft) => {
        draft.sessions.push({ id: "committed-after-retry" });
      });
      assert.deepEqual(store.snapshot().sessions, [{ id: "committed-after-retry" }]);
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      mutableFs.writeSync = originalWriteSync;
      fs.rmSync(lockPath, { force: true });
    }
  });
});

test("failed lock cleanup does not remove a replacement lock owner", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    const replacementOwner = JSON.stringify({
      pid: 515151,
      hostname: "replacement-host.example",
      createdAt: new Date().toISOString(),
      ownerToken: "replacement-owner"
    });
    const mutableFs = fs as unknown as {
      statSync: (...args: unknown[]) => fs.Stats;
      writeSync: (...args: unknown[]) => number;
    };
    const originalStatSync = mutableFs.statSync;
    const originalWriteSync = mutableFs.writeSync;
    let failNextWrite = true;
    let replaceBeforeCleanup = true;
    try {
      mutableFs.writeSync = (...args: unknown[]) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw errnoError("EIO");
        }
        return originalWriteSync(...args);
      };
      mutableFs.statSync = (...args: unknown[]) => {
        if (String(args[0]) === lockPath && replaceBeforeCleanup) {
          replaceBeforeCleanup = false;
          fs.rmSync(lockPath, { force: true });
          fs.writeFileSync(lockPath, replacementOwner, "utf8");
        }
        return originalStatSync(...args);
      };
      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1"
      });

      assert.throws(() => store.transact(() => undefined));
      assert.equal(fs.readFileSync(lockPath, "utf8"), replacementOwner);
    } finally {
      mutableFs.statSync = originalStatSync;
      mutableFs.writeSync = originalWriteSync;
      fs.rmSync(lockPath, { force: true });
    }
  });
});

test("live or foreign lock owners produce typed STORE_BUSY and are never removed", () => {
  withTemporaryDirectory((directory) => {
    for (const lockHostname of [os.hostname(), "different-host.example"]) {
      const storePath = path.join(directory, `${lockHostname.replace(/\W/g, "_")}.json`);
      const lockPath = `${storePath}.lock`;
      const lock = {
        pid: 424242,
        hostname: lockHostname,
        createdAt: new Date().toISOString(),
        ownerToken: "existing-owner"
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock), "utf8");
      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1",
        hostname: os.hostname(),
        lockTimeoutMs: 15,
        lockRetryMs: 2,
        isProcessAlive: () => true
      });

      assert.throws(
        () => store.transact((draft) => draft.sessions.push({ id: "blocked" })),
        (error: unknown) => error instanceof StoreBusyError && error.code === "STORE_BUSY"
      );
      assert.equal(fs.readFileSync(lockPath, "utf8"), JSON.stringify(lock));
      fs.unlinkSync(lockPath);
    }
  });
});

test("recovers a dead same-host lock but not an unreadable lock", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 424242,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      ownerToken: "dead-owner"
    }), "utf8");
    const store = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1",
      hostname: os.hostname(),
      lockTimeoutMs: 20,
      lockRetryMs: 2,
      isProcessAlive: () => false
    });

    store.transact((draft) => draft.sessions.push({ id: "after-recovery" }));
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(store.revision, 1);

    fs.writeFileSync(lockPath, "not-json", "utf8");
    assert.throws(
      () => store.transact(() => undefined),
      StoreBusyError
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), "not-json");
  });
});

test("dead-lock recovery refuses to remove a lock that changes owners while inspected", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    const firstOwner = JSON.stringify({
      pid: 424242,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      ownerToken: "first-dead-owner"
    });
    const replacementOwner = JSON.stringify({
      pid: 434343,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      ownerToken: "replacement-owner"
    });
    fs.writeFileSync(lockPath, firstOwner, "utf8");

    const mutableFs = fs as unknown as {
      readFileSync: (...args: unknown[]) => unknown;
    };
    const originalReadFileSync = mutableFs.readFileSync;
    let lockReads = 0;
    try {
      mutableFs.readFileSync = (...args: unknown[]) => {
        if (String(args[0]) === lockPath && ++lockReads === 2) {
          fs.writeFileSync(lockPath, replacementOwner, "utf8");
        }
        return originalReadFileSync(...args);
      };
      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1",
        hostname: os.hostname(),
        lockTimeoutMs: 0,
        isProcessAlive: () => false
      });

      assert.throws(() => store.transact(() => undefined), StoreBusyError);
      assert.equal(fs.readFileSync(lockPath, "utf8"), replacementOwner);
    } finally {
      mutableFs.readFileSync = originalReadFileSync;
      fs.rmSync(lockPath, { force: true });
    }
  });
});

test("retries transient Windows lock-open, rename, and dead-lock unlink failures", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    const mutableFs = fs as unknown as {
      openSync: (...args: unknown[]) => number;
      renameSync: (...args: unknown[]) => void;
      unlinkSync: (...args: unknown[]) => void;
    };
    const originalOpenSync = mutableFs.openSync;
    const originalRenameSync = mutableFs.renameSync;
    const originalUnlinkSync = mutableFs.unlinkSync;
    let lockOpenFailures = 2;
    let storeRenameFailures = 2;
    try {
      mutableFs.openSync = (...args: unknown[]) => {
        if (String(args[0]) === lockPath && args[1] === "wx" && lockOpenFailures-- > 0) {
          throw errnoError("EPERM");
        }
        return originalOpenSync(...args);
      };
      mutableFs.renameSync = (...args: unknown[]) => {
        if (String(args[1]) === storePath && storeRenameFailures-- > 0) {
          throw errnoError("EBUSY");
        }
        originalRenameSync(...args);
      };

      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1",
        lockTimeoutMs: 100,
        lockRetryMs: 1
      });
      store.transact((draft) => draft.sessions.push({ id: "after-transient-errors" }));

      assert.equal(store.revision, 1);
      assert.equal(JSON.parse(fs.readFileSync(storePath, "utf8")).revision, 1);
      assert.equal(lockOpenFailures, -1);
      assert.equal(storeRenameFailures, -1);

      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 424242,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        ownerToken: "dead-owner"
      }), "utf8");
      let unlinkFailures = 2;
      mutableFs.unlinkSync = (...args: unknown[]) => {
        if (String(args[0]) === lockPath && unlinkFailures-- > 0) {
          throw errnoError("EPERM");
        }
        originalUnlinkSync(...args);
      };
      const recoveringStore = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1",
        lockTimeoutMs: 100,
        lockRetryMs: 1,
        isProcessAlive: () => false
      });
      recoveringStore.transact((draft) => draft.sessions.push({ id: "after-dead-lock" }), {
        expectedRevision: 1
      });
      assert.equal(recoveringStore.revision, 2);
      assert.equal(unlinkFailures, -1);
    } finally {
      mutableFs.openSync = originalOpenSync;
      mutableFs.renameSync = originalRenameSync;
      mutableFs.unlinkSync = originalUnlinkSync;
    }
  });
});

test("post-commit lock cleanup failures never report a rollback", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const lockPath = `${storePath}.lock`;
    const mutableFs = fs as unknown as {
      readFileSync: (...args: unknown[]) => unknown;
      rmSync: (...args: unknown[]) => void;
    };
    const originalReadFileSync = mutableFs.readFileSync;
    const originalRmSync = mutableFs.rmSync;

    let committed = false;
    try {
      mutableFs.readFileSync = (...args: unknown[]) => {
        if (committed && String(args[0]) === lockPath) {
          throw errnoError("EPERM");
        }
        return originalReadFileSync(...args);
      };
      const store = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1",
        lockTimeoutMs: 10,
        onBeforeRename() {
          committed = true;
        }
      });
      const result = store.transact((draft) => draft.sessions.push({ id: "committed" }));
      assert.equal(result.revision, 1);
      assert.equal(store.revision, 1);
    } finally {
      mutableFs.readFileSync = originalReadFileSync;
    }
    assert.equal(JSON.parse(fs.readFileSync(storePath, "utf8")).revision, 1);
    assert.equal(fs.existsSync(lockPath), true);
    fs.unlinkSync(lockPath);

    let cleanupFailureInjected = false;
    try {
      mutableFs.rmSync = (...args: unknown[]) => {
        if (String(args[0]).includes(".lock.released.")) {
          cleanupFailureInjected = true;
          throw errnoError("EBUSY");
        }
        originalRmSync(...args);
      };
      const nextStore = new TransactionalStoreV2<TestSession>({
        storePath,
        workspaceId: "workspace-1"
      });
      nextStore.transact((draft) => draft.sessions.push({ id: "second-commit" }), {
        expectedRevision: 1
      });
      assert.equal(nextStore.revision, 2);
    } finally {
      mutableFs.rmSync = originalRmSync;
    }
    assert.equal(cleanupFailureInjected, true);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(JSON.parse(fs.readFileSync(storePath, "utf8")).revision, 2);
  });
});

test("detects revision conflicts and refreshes another process snapshot", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const first = new TransactionalStoreV2<TestSession>({ storePath, workspaceId: "workspace-1" });
    const second = new TransactionalStoreV2<TestSession>({ storePath, workspaceId: "workspace-1" });

    first.transact((draft) => draft.sessions.push({ id: "first" }));
    assert.equal(second.needsRefresh(), true);
    assert.throws(
      () => second.transact((draft) => draft.sessions.push({ id: "lost-update" })),
      (error: unknown) => (
        error instanceof StoreRevisionConflictError
        && error.expectedRevision === 0
        && error.actualRevision === 1
      )
    );
    assert.equal(fs.existsSync(`${storePath}.lock`), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(storePath, "utf8")).sessions.map((session: TestSession) => session.id),
      ["first"]
    );

    assert.equal(second.refreshIfChanged(), true);
    assert.equal(second.snapshot({ refresh: false }).sessions[0]!.id, "first");
    second.transact((draft) => draft.sessions.push({ id: "second" }));
    assert.equal(first.snapshot().revision, 2);
    assert.deepEqual(first.snapshot().sessions.map((session) => session.id), ["first", "second"]);
  });
});

test("enforces maximum bytes on load and transaction without replacing valid data", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "shapelex-store.json");
    const store = new TransactionalStoreV2<TestSession>({
      storePath,
      workspaceId: "workspace-1",
      maxStoreBytes: 700
    });
    store.transact((draft) => draft.sessions.push({ id: "small" }));
    const before = fs.readFileSync(storePath, "utf8");

    assert.throws(
      () => store.transact((draft) => draft.sessions.push({
        id: "huge",
        handles: ["x".repeat(2_000)]
      })),
      StoreSizeLimitError
    );
    assert.equal(fs.readFileSync(storePath, "utf8"), before);
    assert.equal(store.revision, 1);

    fs.writeFileSync(path.join(directory, "oversized.json"), "x".repeat(701), "utf8");
    assert.throws(
      () => new TransactionalStoreV2<TestSession>({
        storePath: path.join(directory, "oversized.json"),
        workspaceId: "workspace-1",
        maxStoreBytes: 700
      }),
      StoreSizeLimitError
    );
  });
});

test("memory-only mode performs transactions without creating store or lock files", () => {
  withTemporaryDirectory((directory) => {
    const storePath = path.join(directory, "must-not-exist.json");
    const store = new TransactionalStoreV2<TestSession>({
      persistent: false,
      storePath,
      workspaceId: "workspace-1"
    });

    store.transact((draft) => draft.sessions.push({ id: "memory" }));
    assert.equal(store.revision, 1);
    assert.equal(store.migrationPending, false);
    assert.equal(store.snapshot().sessions[0]!.id, "memory");
    assert.deepEqual(fs.readdirSync(directory), []);
  });
});

test("rejects malformed v1 and workspace-mismatched v2 envelopes", () => {
  assert.throws(
    () => parseStoreEnvelope(JSON.stringify({ version: 1, sessions: null }), {
      workspaceId: "workspace-1"
    }),
    StoreFormatError
  );

  const valid = migrateV1Store<TestSession>({ version: 1, sessions: [] }, {
    workspaceId: "workspace-1"
  });
  assert.throws(
    () => parseStoreEnvelope(JSON.stringify(valid), { workspaceId: "workspace-2" }),
    /different workspace/
  );
});

function withTemporaryDirectory(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shapelex-store-v2-"));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`simulated ${code}`), { code });
}
