import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STORE_V2_VERSION = 2 as const;
export const STORE_V2_CHECKSUM_ALGORITHM = "sha256" as const;
export const DEFAULT_FINGERPRINT_PROFILE = "lexical-v1";
export const DEFAULT_STORE_LOCK_TIMEOUT_MS = 2_000;
export const DEFAULT_STORE_MAX_BYTES = 100 * 1024 * 1024;

export type SourceOrigin =
  | {
      kind: "text";
      sessionId: string;
      documentId: string;
    }
  | {
      kind: "file";
      sessionId: string;
      documentId: string;
      relativePath: string;
    };

export interface SourceMaterial {
  bytes: Uint8Array;
  origin: SourceOrigin;
  legacyChecksum?: string;
}

export interface StoreSourceRecord {
  sourceId: string;
  checksumAlgorithm: typeof STORE_V2_CHECKSUM_ALGORITHM;
  sha256: string;
  byteLength: number;
  mediaType: "text/utf8";
  /**
   * Exact UTF-8 content is stored once for sources with at least one text
   * origin. File-only records deliberately remain metadata-only.
   */
  text?: string;
  origins: SourceOrigin[];
  legacyChecksums: string[];
}

export interface LazyIndexManifest {
  strategy: "lazy-memory-only";
  state: "cold";
}

export interface StoreV1Envelope<TSession = unknown> {
  version: 1;
  savedAt?: string;
  sessions: TSession[];
}

export interface StoreV2Envelope<TSession = unknown> {
  version: typeof STORE_V2_VERSION;
  revision: number;
  savedAt: string;
  workspaceId: string;
  checksumAlgorithm: typeof STORE_V2_CHECKSUM_ALGORITHM;
  fingerprintProfile: string;
  index: LazyIndexManifest;
  sources: StoreSourceRecord[];
  sessions: TSession[];
}

export interface MutableStoreState<TSession> {
  sessions: TSession[];
  sources: StoreSourceRecord[];
  index: LazyIndexManifest;
}

export interface V1SourceContext {
  session: unknown;
  document: unknown;
  sessionId: string;
  documentId: string;
}

export interface MigrationOptions<TSession> {
  workspaceId: string;
  fingerprintProfile?: string;
  now?: () => Date;
  resolveFileSource?: (context: V1SourceContext & { relativePath: string }) => Uint8Array | undefined;
  enumerateSources?: (sessions: readonly TSession[]) => Iterable<SourceMaterial>;
}

export interface TransactionOptions {
  expectedRevision?: number;
}

export interface TransactionalStoreOptions<TSession> extends MigrationOptions<TSession> {
  storePath?: string;
  persistent?: boolean;
  maxStoreBytes?: number;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  hostname?: string;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  /**
   * Test/instrumentation hook. Throwing here proves the old store survives a
   * failed write because it runs after fsync and before the atomic rename.
   */
  onBeforeRename?: (temporaryPath: string, destinationPath: string) => void;
}

export interface StoreLoadResult<TSession> {
  envelope: StoreV2Envelope<TSession>;
  migratedFromV1: boolean;
}

interface LockRecord {
  pid: number;
  hostname: string;
  createdAt: string;
  ownerToken: string;
}

export class StoreBusyError extends Error {
  readonly code = "STORE_BUSY";

  constructor(_storePath?: string) {
    super("ShapeLex store is busy; retry the operation.");
    this.name = "StoreBusyError";
  }
}

export class StoreRevisionConflictError extends Error {
  readonly code = "STORE_REVISION_CONFLICT";
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`ShapeLex store revision conflict (${expectedRevision} expected, ${actualRevision} found)`);
    this.name = "StoreRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class StoreSizeLimitError extends Error {
  readonly code = "STORE_SIZE_LIMIT";
  readonly actualBytes: number;
  readonly maximumBytes: number;

  constructor(actualBytes: number, maximumBytes: number) {
    super(`ShapeLex store would exceed the configured maximum size (${actualBytes} > ${maximumBytes} bytes)`);
    this.name = "StoreSizeLimitError";
    this.actualBytes = actualBytes;
    this.maximumBytes = maximumBytes;
  }
}

export class UnsupportedStoreVersionError extends Error {
  readonly code = "UNSUPPORTED_STORE_VERSION";
  readonly version: unknown;

  constructor(version: unknown) {
    super(`Unsupported ShapeLex store version: ${String(version)}`);
    this.name = "UnsupportedStoreVersionError";
    this.version = version;
  }
}

export class StoreFormatError extends Error {
  readonly code = "INVALID_STORE_FORMAT";

  constructor(message: string) {
    super(message);
    this.name = "StoreFormatError";
  }
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sourceRecordFromMaterial(material: SourceMaterial): StoreSourceRecord {
  const sha256 = sha256Hex(material.bytes);
  const decodedText = decodeExactUtf8(material.bytes);
  const text = material.origin.kind === "text" ? decodedText : undefined;
  return {
    sourceId: `source_${sha256}`,
    checksumAlgorithm: STORE_V2_CHECKSUM_ALGORITHM,
    sha256,
    byteLength: material.bytes.byteLength,
    mediaType: "text/utf8",
    ...(text === undefined ? {} : { text }),
    origins: [cloneJson(material.origin)],
    legacyChecksums: material.legacyChecksum ? [material.legacyChecksum] : []
  };
}

export function migrateV1Store<TSession>(
  input: StoreV1Envelope<TSession>,
  options: MigrationOptions<TSession>
): StoreV2Envelope<TSession> {
  assertWorkspaceId(options.workspaceId);
  if (!isObject(input) || input.version !== 1 || !Array.isArray(input.sessions)) {
    throw new StoreFormatError("ShapeLex v1 store must contain a sessions array");
  }

  const sessions = cloneJson(input.sessions);
  if (input.savedAt !== undefined && typeof input.savedAt !== "string") {
    throw new StoreFormatError("ShapeLex v1 savedAt must be a string when present");
  }
  const materials = options.enumerateSources
    ? [...options.enumerateSources(sessions)]
    : collectDefaultV1Sources(sessions, options.resolveFileSource);

  return {
    version: STORE_V2_VERSION,
    revision: 0,
    savedAt: input.savedAt ?? (options.now ?? (() => new Date()))().toISOString(),
    workspaceId: options.workspaceId,
    checksumAlgorithm: STORE_V2_CHECKSUM_ALGORITHM,
    fingerprintProfile: options.fingerprintProfile ?? DEFAULT_FINGERPRINT_PROFILE,
    index: { strategy: "lazy-memory-only", state: "cold" },
    sources: deduplicateSourceMaterials(materials),
    sessions
  };
}

export function parseStoreEnvelope<TSession>(
  raw: string,
  options: MigrationOptions<TSession>
): StoreLoadResult<TSession> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreFormatError("ShapeLex store is not valid JSON");
  }
  if (!isObject(parsed) || typeof parsed.version !== "number") {
    throw new StoreFormatError("ShapeLex store has no numeric version");
  }
  if (parsed.version === 1) {
    return {
      envelope: migrateV1Store(parsed as unknown as StoreV1Envelope<TSession>, options),
      migratedFromV1: true
    };
  }
  if (parsed.version !== STORE_V2_VERSION) {
    throw new UnsupportedStoreVersionError(parsed.version);
  }
  return {
    envelope: validateV2Envelope<TSession>(parsed, options.workspaceId),
    migratedFromV1: false
  };
}

export class TransactionalStoreV2<TSession = unknown> {
  readonly persistent: boolean;
  readonly storePath?: string;
  readonly lockPath?: string;
  readonly maxStoreBytes: number;

  #options: Required<
    Pick<TransactionalStoreOptions<TSession>, "lockTimeoutMs" | "lockRetryMs" | "hostname" | "pid" | "isProcessAlive">
  > & TransactionalStoreOptions<TSession>;
  #envelope: StoreV2Envelope<TSession>;
  #migratedFromV1 = false;

  constructor(options: TransactionalStoreOptions<TSession>) {
    assertWorkspaceId(options.workspaceId);
    this.persistent = options.persistent ?? Boolean(options.storePath);
    if (this.persistent && !options.storePath) {
      throw new TypeError("Persistent ShapeLex storage requires storePath");
    }
    this.storePath = this.persistent ? path.resolve(options.storePath!) : undefined;
    this.lockPath = this.storePath ? `${this.storePath}.lock` : undefined;
    this.maxStoreBytes = normalizePositiveInteger(
      options.maxStoreBytes ?? DEFAULT_STORE_MAX_BYTES,
      "maxStoreBytes"
    );
    this.#options = {
      ...options,
      lockTimeoutMs: normalizeNonNegativeInteger(
        options.lockTimeoutMs ?? DEFAULT_STORE_LOCK_TIMEOUT_MS,
        "lockTimeoutMs"
      ),
      lockRetryMs: normalizePositiveInteger(options.lockRetryMs ?? 20, "lockRetryMs"),
      hostname: options.hostname ?? os.hostname(),
      pid: options.pid ?? process.pid,
      isProcessAlive: options.isProcessAlive ?? isProcessAlive
    };
    const loaded = this.#loadFromDisk();
    this.#envelope = loaded.envelope;
    this.#migratedFromV1 = loaded.migratedFromV1;
  }

  get revision(): number {
    return this.#envelope.revision;
  }

  get migrationPending(): boolean {
    return this.#migratedFromV1;
  }

  snapshot({ refresh = true }: { refresh?: boolean } = {}): StoreV2Envelope<TSession> {
    if (refresh) {
      this.refreshIfChanged();
    }
    return cloneJson(this.#envelope);
  }

  needsRefresh(): boolean {
    if (!this.persistent || !this.storePath || !fs.existsSync(this.storePath)) {
      return false;
    }
    const loaded = this.#readStoreFile(this.storePath);
    return loaded.envelope.revision !== this.#envelope.revision
      || loaded.migratedFromV1 !== this.#migratedFromV1;
  }

  refreshIfChanged(): boolean {
    if (!this.persistent || !this.storePath || !fs.existsSync(this.storePath)) {
      return false;
    }
    const loaded = this.#readStoreFile(this.storePath);
    if (
      loaded.envelope.revision === this.#envelope.revision
      && loaded.migratedFromV1 === this.#migratedFromV1
    ) {
      return false;
    }
    this.#envelope = loaded.envelope;
    this.#migratedFromV1 = loaded.migratedFromV1;
    return true;
  }

  transact(
    mutator: (draft: MutableStoreState<TSession>) => void,
    options: TransactionOptions = {}
  ): StoreV2Envelope<TSession> {
    if (typeof mutator !== "function") {
      throw new TypeError("ShapeLex store transaction requires a mutator function");
    }
    if (!this.persistent) {
      const expected = options.expectedRevision ?? this.#envelope.revision;
      assertExpectedRevision(expected, this.#envelope.revision);
      const next = this.#createNextEnvelope(this.#envelope, mutator);
      this.#assertSerializedSize(next);
      this.#envelope = next;
      this.#migratedFromV1 = false;
      return cloneJson(next);
    }

    const release = this.#acquireLock();
    try {
      const latest = this.#loadFromDisk();
      const expected = options.expectedRevision ?? this.#envelope.revision;
      assertExpectedRevision(expected, latest.envelope.revision);
      const next = this.#createNextEnvelope(latest.envelope, mutator);
      this.#writeAtomically(next);
      this.#envelope = next;
      this.#migratedFromV1 = false;
      return cloneJson(next);
    } finally {
      release();
    }
  }

  #createNextEnvelope(
    base: StoreV2Envelope<TSession>,
    mutator: (draft: MutableStoreState<TSession>) => void
  ): StoreV2Envelope<TSession> {
    const draft: MutableStoreState<TSession> = {
      sessions: cloneJson(base.sessions),
      sources: cloneJson(base.sources),
      index: cloneJson(base.index)
    };
    mutator(draft);
    validateMutableState(draft);
    return {
      version: STORE_V2_VERSION,
      revision: base.revision + 1,
      savedAt: (this.#options.now ?? (() => new Date()))().toISOString(),
      workspaceId: base.workspaceId,
      checksumAlgorithm: STORE_V2_CHECKSUM_ALGORITHM,
      fingerprintProfile: base.fingerprintProfile,
      index: cloneJson(draft.index),
      sources: cloneJson(draft.sources),
      sessions: cloneJson(draft.sessions)
    };
  }

  #loadFromDisk(): StoreLoadResult<TSession> {
    if (!this.persistent || !this.storePath || !fs.existsSync(this.storePath)) {
      return {
        envelope: createEmptyEnvelope<TSession>(this.#options),
        migratedFromV1: false
      };
    }
    return this.#readStoreFile(this.storePath);
  }

  #readStoreFile(storePath: string): StoreLoadResult<TSession> {
    const stat = fs.statSync(storePath);
    if (!stat.isFile()) {
      throw new StoreFormatError(`ShapeLex store is not a regular file: ${storePath}`);
    }
    if (stat.size > this.maxStoreBytes) {
      throw new StoreSizeLimitError(stat.size, this.maxStoreBytes);
    }
    return parseStoreEnvelope<TSession>(fs.readFileSync(storePath, "utf8"), this.#options);
  }

  #assertSerializedSize(envelope: StoreV2Envelope<TSession>): string {
    let serialized: string;
    try {
      serialized = JSON.stringify(envelope);
    } catch {
      throw new StoreFormatError("ShapeLex store contains values that cannot be serialized");
    }
    if (serialized === undefined) {
      throw new StoreFormatError("ShapeLex store could not be serialized");
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.maxStoreBytes) {
      throw new StoreSizeLimitError(bytes, this.maxStoreBytes);
    }
    return serialized;
  }

  #writeAtomically(envelope: StoreV2Envelope<TSession>): void {
    const serialized = this.#assertSerializedSize(envelope);
    const storePath = this.storePath!;
    const directory = path.dirname(storePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${storePath}.${this.#options.pid}.${crypto.randomUUID()}.tmp`;
    let temporaryFd: number | undefined;
    try {
      temporaryFd = fs.openSync(temporaryPath, "wx", 0o600);
      writeAllSync(temporaryFd, serialized);
      fs.fsyncSync(temporaryFd);
      fs.closeSync(temporaryFd);
      temporaryFd = undefined;
      this.#options.onBeforeRename?.(temporaryPath, storePath);
      renameWithRetry(temporaryPath, storePath, this.#options.lockTimeoutMs);
      fsyncDirectoryBestEffort(directory);
    } catch (error) {
      if (temporaryFd !== undefined) {
        fs.closeSync(temporaryFd);
      }
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
  }

  #acquireLock(): () => void {
    const lockPath = this.lockPath!;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    const record: LockRecord = {
      pid: this.#options.pid,
      hostname: this.#options.hostname,
      createdAt: new Date().toISOString(),
      ownerToken: crypto.randomUUID()
    };
    const serializedRecord = JSON.stringify(record);

    while (true) {
      try {
        const fd = fs.openSync(lockPath, "wx", 0o600);
        let lockIdentity: FileIdentity | undefined;
        let acquisitionError: unknown;
        try {
          lockIdentity = fileIdentity(fs.fstatSync(fd));
          writeAllSync(fd, serializedRecord);
          fs.fsyncSync(fd);
        } catch (error) {
          acquisitionError = error;
        }
        try {
          fs.closeSync(fd);
        } catch (error) {
          acquisitionError ??= error;
        }
        if (acquisitionError !== undefined) {
          if (lockIdentity) {
            removeFileWithIdentity(lockPath, lockIdentity, serializedRecord);
          }
          throw acquisitionError;
        }
        return () => releaseOwnedLock(
          lockPath,
          record.ownerToken,
          this.#options.lockTimeoutMs
        );
      } catch (error) {
        if (!isNodeError(error) || !isTransientLockError(error.code)) {
          throw error;
        }

        if (error.code === "EEXIST" && this.#recoverDeadSameHostLock(lockPath)) {
          continue;
        }
      }
      if (Date.now() - startedAt >= this.#options.lockTimeoutMs) {
        throw new StoreBusyError(this.storePath!);
      }
      sleepSync(Math.min(this.#options.lockRetryMs, this.#options.lockTimeoutMs));
    }
  }

  #recoverDeadSameHostLock(lockPath: string): boolean {
    const raw = readFileIfPresent(lockPath);
    if (raw === undefined) {
      return true;
    }
    const lock = parseLockRecord(raw);
    if (!lock || lock.hostname !== this.#options.hostname || this.#options.isProcessAlive(lock.pid)) {
      return false;
    }

    const currentRaw = readFileIfPresent(lockPath);
    if (currentRaw !== raw) {
      return false;
    }
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (error) {
      return isNodeError(error) && error.code === "ENOENT";
    }
  }
}

function createEmptyEnvelope<TSession>(
  options: MigrationOptions<TSession>
): StoreV2Envelope<TSession> {
  return {
    version: STORE_V2_VERSION,
    revision: 0,
    savedAt: (options.now ?? (() => new Date()))().toISOString(),
    workspaceId: options.workspaceId,
    checksumAlgorithm: STORE_V2_CHECKSUM_ALGORITHM,
    fingerprintProfile: options.fingerprintProfile ?? DEFAULT_FINGERPRINT_PROFILE,
    index: { strategy: "lazy-memory-only", state: "cold" },
    sources: [],
    sessions: []
  };
}

function collectDefaultV1Sources<TSession>(
  sessions: readonly TSession[],
  resolveFileSource?: MigrationOptions<TSession>["resolveFileSource"]
): SourceMaterial[] {
  const materials: SourceMaterial[] = [];
  for (const session of sessions) {
    if (!isObject(session) || !Array.isArray(session.documents)) {
      continue;
    }
    const sessionId = typeof session.id === "string" ? session.id : "";
    for (const document of session.documents) {
      if (!isObject(document)) {
        continue;
      }
      const documentId = typeof document.id === "string" ? document.id : "";
      const legacyChecksum = typeof document.checksum === "string" ? document.checksum : undefined;
      if (typeof document.text === "string") {
        materials.push({
          bytes: Buffer.from(document.text, "utf8"),
          origin: { kind: "text", sessionId, documentId },
          legacyChecksum
        });
        continue;
      }
      if (
        resolveFileSource
        && isObject(document.source)
        && document.source.kind === "file"
        && typeof document.source.relativePath === "string"
      ) {
        const relativePath = document.source.relativePath;
        const context = { session, document, sessionId, documentId, relativePath };
        const bytes = resolveFileSource(context);
        if (bytes) {
          materials.push({
            bytes,
            origin: { kind: "file", sessionId, documentId, relativePath },
            legacyChecksum
          });
        }
      }
    }
  }
  return materials;
}

function deduplicateSourceMaterials(materials: Iterable<SourceMaterial>): StoreSourceRecord[] {
  const records = new Map<string, StoreSourceRecord>();
  const exactBytes = new Map<string, Buffer>();
  for (const material of materials) {
    if (!(material.bytes instanceof Uint8Array)) {
      throw new StoreFormatError("Migrated ShapeLex source bytes must be a Uint8Array");
    }
    const candidate = sourceRecordFromMaterial(material);
    const bytes = Buffer.from(material.bytes);
    const current = records.get(candidate.sha256);
    if (!current) {
      records.set(candidate.sha256, candidate);
      exactBytes.set(candidate.sha256, bytes);
      continue;
    }
    if (!exactBytes.get(candidate.sha256)?.equals(bytes)) {
      throw new StoreFormatError("ShapeLex source SHA-256 collision detected during migration");
    }
    if (!current.origins.some((origin) => sameOrigin(origin, material.origin))) {
      current.origins.push(cloneJson(material.origin));
    }
    if (current.text === undefined && candidate.text !== undefined) {
      current.text = candidate.text;
    }
    if (material.legacyChecksum && !current.legacyChecksums.includes(material.legacyChecksum)) {
      current.legacyChecksums.push(material.legacyChecksum);
    }
  }
  return [...records.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function validateV2Envelope<TSession>(value: Record<string, unknown>, workspaceId: string): StoreV2Envelope<TSession> {
  if (
    !Number.isSafeInteger(value.revision)
    || Number(value.revision) < 0
    || typeof value.savedAt !== "string"
    || typeof value.workspaceId !== "string"
    || value.checksumAlgorithm !== STORE_V2_CHECKSUM_ALGORITHM
    || typeof value.fingerprintProfile !== "string"
    || value.fingerprintProfile.length === 0
    || !Array.isArray(value.sessions)
    || !Array.isArray(value.sources)
    || !isObject(value.index)
    || value.index.strategy !== "lazy-memory-only"
    || value.index.state !== "cold"
  ) {
    throw new StoreFormatError("ShapeLex v2 store envelope is invalid");
  }
  if (value.workspaceId !== workspaceId) {
    throw new StoreFormatError("ShapeLex store belongs to a different workspace");
  }
  for (const source of value.sources) {
    validateSourceRecord(source);
  }
  return cloneJson(value) as unknown as StoreV2Envelope<TSession>;
}

function validateSourceRecord(value: unknown): asserts value is StoreSourceRecord {
  if (
    !isObject(value)
    || typeof value.sourceId !== "string"
    || value.checksumAlgorithm !== STORE_V2_CHECKSUM_ALGORITHM
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || value.sourceId !== `source_${value.sha256}`
    || !Number.isSafeInteger(value.byteLength)
    || Number(value.byteLength) < 0
    || value.mediaType !== "text/utf8"
    || !Array.isArray(value.origins)
    || value.origins.length === 0
    || value.origins.some((origin) => !isSourceOrigin(origin))
    || !Array.isArray(value.legacyChecksums)
    || value.legacyChecksums.some((checksum) => typeof checksum !== "string")
  ) {
    throw new StoreFormatError("ShapeLex v2 source record is invalid");
  }
  const hasTextOrigin = value.origins.some((origin) => (
    isObject(origin) && origin.kind === "text"
  ));
  if (hasTextOrigin) {
    if (typeof value.text !== "string") {
      throw new StoreFormatError("ShapeLex text source record is missing exact UTF-8 content");
    }
    const bytes = Buffer.from(value.text, "utf8");
    if (bytes.byteLength !== value.byteLength || sha256Hex(bytes) !== value.sha256) {
      throw new StoreFormatError("ShapeLex text source record failed SHA-256 verification");
    }
  } else if (value.text !== undefined) {
    throw new StoreFormatError("ShapeLex file-only source record must not persist exact text");
  }
}

function validateMutableState<TSession>(state: MutableStoreState<TSession>): void {
  if (
    !Array.isArray(state.sessions)
    || !Array.isArray(state.sources)
    || !isObject(state.index)
    || state.index.strategy !== "lazy-memory-only"
    || state.index.state !== "cold"
  ) {
    throw new StoreFormatError("ShapeLex store transaction produced invalid state");
  }
  for (const source of state.sources) {
    validateSourceRecord(source);
  }
}

function assertExpectedRevision(expected: number, actual: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new TypeError("expectedRevision must be a non-negative safe integer");
  }
  if (expected !== actual) {
    throw new StoreRevisionConflictError(expected, actual);
  }
}

function releaseOwnedLock(lockPath: string, ownerToken: string, timeoutMs: number): void {
  try {
    const raw = readFileIfPresent(lockPath);
    if (raw === undefined) {
      return;
    }
    const lock = parseLockRecord(raw);
    if (lock?.ownerToken !== ownerToken) {
      return;
    }
    const releasedPath = `${lockPath}.released.${ownerToken}`;
    renameWithRetry(lockPath, releasedPath, timeoutMs);
    try {
      fs.rmSync(releasedPath, { force: true });
    } catch {
      // The canonical lock is already released; a uniquely named remnant is safe.
    }
  } catch {
    // The transaction has already committed (or already failed for another
    // reason). Lock cleanup must never replace that outcome with a false
    // rollback report. A canonical remnant remains conservative: other
    // processes will not remove it unless its same-machine PID is proven dead.
  }
}

function renameWithRetry(sourcePath: string, destinationPath: string, timeoutMs: number): void {
  const startedAt = Date.now();
  while (true) {
    try {
      fs.renameSync(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (
        !isNodeError(error)
        || !isTransientRenameError(error.code)
        || Date.now() - startedAt >= timeoutMs
      ) {
        throw error;
      }
      sleepSync(Math.min(10, timeoutMs));
    }
  }
}

function isTransientRenameError(code: string | undefined): boolean {
  return code !== undefined && ["EACCES", "EBUSY", "EPERM"].includes(code);
}

function isTransientLockError(code: string | undefined): boolean {
  return code !== undefined && ["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(code);
}

function parseLockRecord(raw: string): LockRecord | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isObject(value)
      && Number.isSafeInteger(value.pid)
      && Number(value.pid) > 0
      && typeof value.hostname === "string"
      && typeof value.createdAt === "string"
      && typeof value.ownerToken === "string"
    ) {
      return value as unknown as LockRecord;
    }
  } catch {
    // An unreadable lock cannot be proven stale and must be left in place.
  }
  return undefined;
}

function readFileIfPresent(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

interface FileIdentity {
  dev: number;
  ino: number;
}

function fileIdentity(stat: fs.Stats): FileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino
  };
}

function removeFileWithIdentity(
  filePath: string,
  expected: FileIdentity,
  expectedContent: string
): void {
  try {
    const current = fileIdentity(fs.statSync(filePath));
    const content = fs.readFileSync(filePath, "utf8");
    const confirmed = fileIdentity(fs.statSync(filePath));
    if (
      !expectedContent.startsWith(content)
      || current.dev !== expected.dev
      || current.ino !== expected.ino
      || confirmed.dev !== current.dev
      || confirmed.ino !== current.ino
    ) {
      return;
    }
    fs.rmSync(filePath, { force: true });
  } catch {
    // Preserve the lock-acquisition error. A replacement file or a cleanup
    // failure must remain untouched rather than risk deleting another owner.
  }
}

function writeAllSync(fd: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
  }
}

function fsyncDirectoryBestEffort(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } catch {
    // The file has already been atomically renamed. Directory fsync support
    // varies by platform, so failure here cannot safely turn a committed
    // transaction into a reported rollback.
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== "ESRCH";
  }
}

function sameOrigin(left: SourceOrigin, right: SourceOrigin): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decodeExactUtf8(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) {
    throw new StoreFormatError("ShapeLex text source must contain valid UTF-8 bytes");
  }
  return text;
}

function isSourceOrigin(value: unknown): value is SourceOrigin {
  if (
    !isObject(value)
    || typeof value.sessionId !== "string"
    || typeof value.documentId !== "string"
  ) {
    return false;
  }
  if (value.kind === "text") {
    return true;
  }
  return value.kind === "file" && typeof value.relativePath === "string";
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new TypeError("workspaceId must be a non-empty string");
  }
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
