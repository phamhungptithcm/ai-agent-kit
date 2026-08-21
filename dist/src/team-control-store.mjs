import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import Database from "better-sqlite3";

import { resolveRepositoryIdentity } from "./memory-contract.mjs";
import { PRINCIPAL_ROLES, TEAM_CAPABILITIES, safeTeamId, teamControlDigest, teamTimestamp } from "./team-control-contract.mjs";

export const TEAM_CONTROL_STORE_SCHEMA_VERSION = 1;
const MAX_ROWS = Object.freeze({
  tasks: 2_000,
  claims: 10_000,
  host_attestations: 10_000,
  packages: 10_000,
  reviews: 20_000,
  decisions: 20_000,
  completion_receipts: 10_000,
  events: 50_000,
  idempotency_keys: 50_000,
  action_nonces: 50_000,
  trusted_keys: 2_000
});

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function retryBusy(callback, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return callback(); } catch (error) {
      if (!["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error.code) && !/database is (?:locked|busy)/i.test(error.message ?? "")) throw error;
      lastError = error;
      const waitMs = 15 + ((process.pid + attempt * 11) % 31);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  throw lastError;
}

function safeRegularFile(file, label, maxBytes = null) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`${label} must be a non-linked regular file`);
  if (maxBytes != null && stat.size > maxBytes) throw new Error(`${label} exceeds its byte budget`);
  return true;
}

function readSafeRegularFile(file, label, maxBytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) throw new Error(`${label} must be a non-linked regular file`);
    if (stat.size > maxBytes) throw new Error(`${label} exceeds its byte budget`);
    const content = fs.readFileSync(descriptor);
    if (content.length !== stat.size) throw new Error(`${label} changed while it was being read`);
    return content;
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function assertSafeStatePath(commonGitDir, stateDirectory, file) {
  const relativeDirectory = path.relative(commonGitDir, stateDirectory);
  const relativeFile = path.relative(stateDirectory, file);
  if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory) || relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) {
    throw new Error("team control store must remain inside the Git common directory");
  }
  let current = commonGitDir;
  for (const part of relativeDirectory.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("team control store path cannot contain symbolic links");
  }
  safeRegularFile(file, "team control database");
}

export function resolveTeamControlStoreLocation(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const commonRaw = options.commonGitDir ?? git(root, ["rev-parse", "--git-common-dir"]);
  const commonPath = path.resolve(root, commonRaw);
  if (!fs.existsSync(commonPath) || !fs.lstatSync(commonPath).isDirectory() || fs.lstatSync(commonPath).isSymbolicLink()) throw new Error("Git common directory is unavailable or unsafe");
  const commonGitDir = fs.realpathSync(commonPath);
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity({ target: root });
  const stateDirectory = path.join(commonGitDir, "ai-agent-kit", "team-control");
  const databaseFile = options.database ?? path.join(stateDirectory, `${identity.repository_id}.sqlite3`);
  assertSafeStatePath(commonGitDir, stateDirectory, path.resolve(databaseFile));
  return {
    root,
    common_git_dir: commonGitDir,
    repository_id: identity.repository_id,
    state_directory: stateDirectory,
    database_file: path.resolve(databaseFile),
    legacy_registry_file: path.join(stateDirectory, `${identity.repository_id}.json`),
    legacy_queue_file: path.join(stateDirectory, "integration-queue.json")
  };
}

function parseJson(value, label) {
  try { return JSON.parse(value); } catch { throw new Error(`stored ${label} JSON is invalid`); }
}

function rowRecord(row, label) { return parseJson(row.record_json, label); }
function verifiedRecordRow(row, label) {
  const record = rowRecord(row, label);
  if (row.record_hash !== recordDigest(record)) throw new Error(`stored ${label} record hash mismatch`);
  return record;
}

function emptySnapshot(repositoryId, now) {
  return {
    schema_version: 2,
    repository_id: repositoryId,
    revision: 0,
    fencing_counter: 0,
    tasks: [],
    claims: [],
    host_attestations: [],
    packages: [],
    reviews: [],
    decisions: [],
    completion_receipts: [],
    events: [],
    created_at: now,
    updated_at: now
  };
}

function recordDigest(value) { return teamControlDigest(value); }

function verifyLegacyHash(value, hashField, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const copy = structuredClone(value);
  const supplied = copy[hashField];
  delete copy[hashField];
  if (!/^[a-f0-9]{64}$/.test(supplied ?? "") || supplied !== recordDigest(copy)) throw new Error(`${label} hash mismatch`);
  return value;
}

export class TeamControlStore {
  constructor(options = {}) {
    this.location = resolveTeamControlStoreLocation(options);
    fs.mkdirSync(this.location.state_directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.location.state_directory, 0o700);
    try {
      this.database = new Database(this.location.database_file, { timeout: Number(options.timeoutMs ?? 5_000), fileMustExist: false });
      fs.chmodSync(this.location.database_file, 0o600);
      this.database.pragma("busy_timeout = 5000");
      retryBusy(() => this.database.pragma("journal_mode = WAL"));
      retryBusy(() => this.database.pragma("synchronous = FULL"));
      retryBusy(() => this.database.pragma("foreign_keys = ON"));
      retryBusy(() => this.database.pragma("trusted_schema = OFF"));
      retryBusy(() => this.#migrateSchema());
      this.#verifySchema();
      this.#initializeRepository(options.now);
    } catch (error) {
      this.database?.close();
      throw new Error(`team control database initialization failed closed: ${error.message}`);
    }
  }

  #migrateSchema() {
    const observed = this.database.pragma("user_version", { simple: true });
    if (observed > TEAM_CONTROL_STORE_SCHEMA_VERSION) throw new Error(`team control database schema ${observed} is newer than supported schema ${TEAM_CONTROL_STORE_SCHEMA_VERSION}`);
    if (observed === TEAM_CONTROL_STORE_SCHEMA_VERSION) return;
    const migrate = this.database.transaction(() => {
      const current = this.database.pragma("user_version", { simple: true });
      if (current > TEAM_CONTROL_STORE_SCHEMA_VERSION) throw new Error(`team control database schema ${current} is newer than supported schema ${TEAM_CONTROL_STORE_SCHEMA_VERSION}`);
      if (current === TEAM_CONTROL_STORE_SCHEMA_VERSION) return;
      this.database.exec(`
      CREATE TABLE repository_meta (
        repository_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 0),
        fencing_counter INTEGER NOT NULL CHECK (fencing_counter >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE claims (
        claim_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        assignment_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        fencing_token INTEGER NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX claims_active_surface_idx ON claims (status, expires_at, task_id);
      CREATE TABLE claim_surfaces (
        claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT,
        PRIMARY KEY (claim_id, ordinal)
      );
      CREATE INDEX claim_surface_lookup_idx ON claim_surfaces (kind, name, mode);
      CREATE TABLE host_attestations (
        attestation_hash TEXT PRIMARY KEY,
        nonce_key TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE packages (
        package_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        claim_id TEXT NOT NULL REFERENCES claims(claim_id),
        state TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        parent_commit TEXT NOT NULL,
        package_hash TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX packages_queue_idx ON packages (state, task_id, package_id);
      CREATE TABLE package_dependencies (
        package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
        dependency_id TEXT NOT NULL,
        PRIMARY KEY (package_id, dependency_id)
      );
      CREATE TABLE package_surfaces (
        package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT,
        PRIMARY KEY (package_id, ordinal)
      );
      CREATE TABLE reviews (
        review_id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES packages(package_id),
        status TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX reviews_package_idx ON reviews (package_id, status, input_hash);
      CREATE TABLE integration_decisions (
        decision_id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES packages(package_id),
        status TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        decision_hash TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      );
      CREATE TABLE completion_receipts (
        receipt_id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES claims(claim_id),
        package_id TEXT REFERENCES packages(package_id),
        receipt_hash TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      );
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        task_id TEXT,
        package_id TEXT,
        principal_id TEXT,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX events_type_time_idx ON events (event_type, created_at, sequence);
      CREATE TABLE idempotency_keys (
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (operation, idempotency_key)
      );
      CREATE TABLE action_nonces (
        key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        operation TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        task_id TEXT,
        consumed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (key_id, nonce)
      );
      CREATE TABLE trusted_keys (
        key_id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        roles_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        max_ttl_seconds INTEGER NOT NULL,
        status TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        record_hash TEXT NOT NULL
      );
      CREATE TABLE migration_journal (
        migration_id TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        backup_directory TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      `);
    });
    retryBusy(() => migrate.immediate());
  }

  #verifySchema() {
    const expected = {
      repository_meta: ["repository_id", "revision", "fencing_counter", "created_at", "updated_at"],
      tasks: ["task_id", "status", "record_hash", "record_json"],
      claims: ["claim_id", "task_id", "assignment_id", "principal_id", "status", "fencing_token", "expires_at", "record_hash", "record_json"],
      claim_surfaces: ["claim_id", "ordinal", "kind", "name", "mode", "source"],
      host_attestations: ["attestation_hash", "nonce_key", "expires_at", "record_hash", "record_json"],
      packages: ["package_id", "task_id", "claim_id", "state", "commit_hash", "parent_commit", "package_hash", "record_json"],
      package_dependencies: ["package_id", "dependency_id"],
      package_surfaces: ["package_id", "ordinal", "kind", "name", "mode", "source"],
      reviews: ["review_id", "package_id", "status", "input_hash", "reviewer_id", "record_hash", "record_json"],
      integration_decisions: ["decision_id", "package_id", "status", "owner_id", "decision_hash", "record_json"],
      completion_receipts: ["receipt_id", "claim_id", "package_id", "receipt_hash", "record_json"],
      events: ["sequence", "event_id", "event_type", "task_id", "package_id", "principal_id", "previous_hash", "event_hash", "created_at", "record_json"],
      idempotency_keys: ["operation", "idempotency_key", "request_hash", "response_json", "created_at", "expires_at"],
      action_nonces: ["key_id", "nonce", "operation", "repository_id", "task_id", "consumed_at", "expires_at"],
      trusted_keys: ["key_id", "issuer", "principal_id", "public_key_pem", "roles_json", "capabilities_json", "max_ttl_seconds", "status", "valid_from", "valid_until", "record_hash"],
      migration_journal: ["migration_id", "source_hash", "backup_directory", "receipt_json", "created_at"]
    };
    const unsafe = this.database.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')").all();
    if (unsafe.length) throw new Error(`unexpected database objects: ${unsafe.map((item) => `${item.type}:${item.name}`).join(", ")}`);
    for (const [table, columns] of Object.entries(expected)) {
      const actual = this.database.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
      if (actual.length !== columns.length || columns.some((column, index) => actual[index] !== column)) throw new Error(`team control table ${table} does not match the supported schema`);
    }
  }

  #initializeRepository(nowValue) {
    const now = teamTimestamp(nowValue ?? new Date().toISOString());
    const observed = this.database.prepare("SELECT repository_id FROM repository_meta").all();
    if (observed.length > 1 || (observed.length === 1 && observed[0].repository_id !== this.location.repository_id)) throw new Error("team control database repository binding mismatch");
    if (observed.length === 1) return;
    const initialize = this.database.transaction(() => {
      const rows = this.database.prepare("SELECT repository_id FROM repository_meta").all();
      if (rows.length > 1 || (rows.length === 1 && rows[0].repository_id !== this.location.repository_id)) throw new Error("team control database repository binding mismatch");
      if (!rows.length) this.database.prepare("INSERT INTO repository_meta (repository_id, revision, fencing_counter, created_at, updated_at) VALUES (?, 0, 0, ?, ?)").run(this.location.repository_id, now, now);
    });
    retryBusy(() => initialize.immediate());
  }

  #snapshot() {
    const meta = this.database.prepare("SELECT repository_id, revision, fencing_counter, created_at, updated_at FROM repository_meta WHERE repository_id = ?").get(this.location.repository_id);
    if (!meta) throw new Error("team control repository metadata is missing");
    const tasks = this.database.prepare("SELECT record_hash, record_json FROM tasks ORDER BY task_id").all().map((row) => verifiedRecordRow(row, "task"));
    const claims = this.database.prepare("SELECT record_hash, record_json FROM claims ORDER BY fencing_token, claim_id").all().map((row) => verifiedRecordRow(row, "claim"));
    const hostAttestations = this.database.prepare("SELECT record_hash, record_json FROM host_attestations ORDER BY attestation_hash").all().map((row) => verifiedRecordRow(row, "host attestation"));
    const packages = this.database.prepare("SELECT package_id, task_id, claim_id, state, commit_hash, parent_commit, package_hash, record_json FROM packages ORDER BY package_id").all().map((row) => {
      const record = rowRecord(row, "package");
      if (record.package_id !== row.package_id || record.task_id !== row.task_id || record.claim_id !== row.claim_id || record.state !== row.state || record.commit !== row.commit_hash || record.parent_commit !== row.parent_commit || record.package_hash !== row.package_hash) throw new Error("stored package row is inconsistent with its canonical record");
      return record;
    });
    const reviews = this.database.prepare("SELECT record_hash, record_json FROM reviews ORDER BY review_id").all().map((row) => verifiedRecordRow(row, "review"));
    const decisions = this.database.prepare("SELECT decision_hash, record_json FROM integration_decisions ORDER BY rowid").all().map((row) => {
      const record = rowRecord(row, "integration decision"); const copy = structuredClone(record); const supplied = copy.decision_hash; delete copy.decision_hash;
      if (supplied !== row.decision_hash || supplied !== recordDigest(copy)) throw new Error("stored integration decision hash mismatch");
      return record;
    });
    const completionReceipts = this.database.prepare("SELECT receipt_hash, record_json FROM completion_receipts ORDER BY receipt_id").all().map((row) => {
      const record = rowRecord(row, "completion receipt"); const copy = structuredClone(record); const supplied = copy.receipt_hash; delete copy.receipt_hash; delete copy.package_id;
      if (supplied !== row.receipt_hash || supplied !== recordDigest(copy)) throw new Error("stored completion receipt hash mismatch");
      return record;
    });
    const events = this.database.prepare("SELECT sequence, event_hash, previous_hash, record_json FROM events ORDER BY sequence").all().map((row) => {
      const record = rowRecord(row, "event"); const copy = structuredClone(record); const supplied = copy.event_hash; delete copy.event_hash;
      if (record.sequence !== row.sequence || supplied !== row.event_hash || record.previous_hash !== row.previous_hash || supplied !== recordDigest(copy)) throw new Error("stored team event hash mismatch");
      return record;
    });
    for (let index = 1; index < events.length; index += 1) if (events[index].previous_hash !== events[index - 1].event_hash) throw new Error("stored team event chain is discontinuous");
    return {
      schema_version: 2,
      ...meta,
      tasks,
      claims,
      host_attestations: hostAttestations,
      packages,
      reviews,
      decisions,
      completion_receipts: completionReceipts,
      events
    };
  }

  #bounded(snapshot) {
    for (const [name, limit] of Object.entries(MAX_ROWS)) {
      if (Array.isArray(snapshot[name]) && snapshot[name].length > limit) throw new Error(`team control ${name} exceeds its ${limit}-row budget`);
    }
  }

  #replaceSnapshot(snapshot) {
    this.#bounded(snapshot);
    const repositoryId = this.location.repository_id;
    if (snapshot.repository_id !== repositoryId || snapshot.schema_version !== 2) throw new Error("team control snapshot repository binding is invalid");
    this.database.prepare("UPDATE repository_meta SET revision = ?, fencing_counter = ?, updated_at = ? WHERE repository_id = ?")
      .run(snapshot.revision, snapshot.fencing_counter, snapshot.updated_at, repositoryId);
    for (const table of ["completion_receipts", "integration_decisions", "reviews", "package_surfaces", "package_dependencies", "packages", "claim_surfaces", "host_attestations", "claims", "tasks"]) this.database.prepare(`DELETE FROM ${table}`).run();
    const taskInsert = this.database.prepare("INSERT INTO tasks (task_id, status, record_hash, record_json) VALUES (?, ?, ?, ?)");
    for (const item of snapshot.tasks) taskInsert.run(item.task_id, item.status, recordDigest(item), JSON.stringify(item));
    const claimInsert = this.database.prepare("INSERT INTO claims (claim_id, task_id, assignment_id, principal_id, status, fencing_token, expires_at, record_hash, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const claimSurfaceInsert = this.database.prepare("INSERT INTO claim_surfaces (claim_id, ordinal, kind, name, mode, source) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of snapshot.claims) {
      claimInsert.run(item.claim_id, item.task_id, item.assignment_id, item.principal?.principal_id, item.status, item.fencing_token, item.expires_at, recordDigest(item), JSON.stringify(item));
      for (const [index, surface] of (item.surfaces ?? []).entries()) claimSurfaceInsert.run(item.claim_id, index, surface.kind, surface.name, surface.mode, surface.source ?? null);
    }
    const attestationInsert = this.database.prepare("INSERT INTO host_attestations (attestation_hash, nonce_key, expires_at, record_hash, record_json) VALUES (?, ?, ?, ?, ?)");
    for (const item of snapshot.host_attestations) attestationInsert.run(item.attestation_hash, item.nonce_key, item.expires_at, recordDigest(item), JSON.stringify(item));
    const packageInsert = this.database.prepare("INSERT INTO packages (package_id, task_id, claim_id, state, commit_hash, parent_commit, package_hash, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const dependencyInsert = this.database.prepare("INSERT INTO package_dependencies (package_id, dependency_id) VALUES (?, ?)");
    const packageSurfaceInsert = this.database.prepare("INSERT INTO package_surfaces (package_id, ordinal, kind, name, mode, source) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of snapshot.packages) {
      packageInsert.run(item.package_id, item.task_id, item.claim_id, item.state, item.commit, item.parent_commit, item.package_hash, JSON.stringify(item));
      for (const dependency of item.dependencies ?? []) dependencyInsert.run(item.package_id, dependency);
      for (const [index, surface] of (item.surfaces ?? []).entries()) packageSurfaceInsert.run(item.package_id, index, surface.kind, surface.name, surface.mode, surface.source ?? null);
    }
    const reviewInsert = this.database.prepare("INSERT INTO reviews (review_id, package_id, status, input_hash, reviewer_id, record_hash, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const item of snapshot.reviews) reviewInsert.run(item.review_id, item.package_id, item.status, item.input_hash, item.reviewer_id, recordDigest(item), JSON.stringify(item));
    const decisionInsert = this.database.prepare("INSERT INTO integration_decisions (decision_id, package_id, status, owner_id, decision_hash, record_json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of snapshot.decisions) decisionInsert.run(item.decision_id ?? `decision-${item.decision_hash}`, item.package_id, item.status, item.decided_by, item.decision_hash, JSON.stringify(item));
    const receiptInsert = this.database.prepare("INSERT INTO completion_receipts (receipt_id, claim_id, package_id, receipt_hash, record_json) VALUES (?, ?, ?, ?, ?)");
    for (const item of snapshot.completion_receipts) receiptInsert.run(item.receipt_id, item.claim_id, item.package_id ?? null, item.receipt_hash, JSON.stringify(item));
    const minimumEventSequence = snapshot.events[0]?.sequence ?? null;
    const maximumEventSequence = snapshot.events.at(-1)?.sequence ?? null;
    if (minimumEventSequence == null) this.database.prepare("DELETE FROM events").run();
    else {
      this.database.prepare("DELETE FROM events WHERE sequence < ? OR sequence > ?").run(minimumEventSequence, maximumEventSequence);
      const existingEvents = new Map(this.database.prepare("SELECT sequence, event_hash FROM events").all().map((row) => [row.sequence, row.event_hash]));
      const eventInsert = this.database.prepare("INSERT INTO events (sequence, event_id, event_type, task_id, package_id, principal_id, previous_hash, event_hash, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const item of snapshot.events) {
        const existingHash = existingEvents.get(item.sequence);
        if (existingHash && existingHash !== item.event_hash) throw new Error("immutable team event changed during mutation");
        if (!existingHash) eventInsert.run(item.sequence, item.event_id, item.type, item.task_id ?? null, item.package_id ?? null, item.principal_id ?? null, item.previous_hash ?? null, item.event_hash, item.timestamp, JSON.stringify(item));
      }
    }
  }

  #insertDirectEvent(type, data, nowValue) {
    const now = teamTimestamp(nowValue ?? new Date().toISOString());
    const prior = this.database.prepare("SELECT sequence, event_hash FROM events ORDER BY sequence DESC LIMIT 1").get();
    const base = { schema_version: 1, sequence: (prior?.sequence ?? 0) + 1, event_id: `evt-${crypto.randomUUID()}`, type, timestamp: now, previous_hash: prior?.event_hash ?? null, ...data };
    const event = { ...base, event_hash: recordDigest(base) };
    this.database.prepare("INSERT INTO events (sequence, event_id, event_type, task_id, package_id, principal_id, previous_hash, event_hash, created_at, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.sequence, event.event_id, event.type, event.task_id ?? null, event.package_id ?? null, event.principal_id ?? null, event.previous_hash, event.event_hash, event.timestamp, JSON.stringify(event));
    return event;
  }

  inspect() { return structuredClone(this.#snapshot()); }

  mutate(callback, options = {}) {
    if (typeof callback !== "function") throw new Error("team control mutation callback is required");
    const execute = this.database.transaction(() => {
      const snapshot = this.#snapshot();
      const before = recordDigest(snapshot);
      if (options.expectedRevision != null && options.expectedRevision !== snapshot.revision) throw new Error(`team control revision conflict: expected ${options.expectedRevision}, current ${snapshot.revision}`);
      const result = callback(snapshot);
      const changed = recordDigest(snapshot) !== before;
      if (changed) {
        const requestedRevision = snapshot.revision;
        if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error("team control revision is invalid");
        // Callers may advance the revision explicitly; otherwise the store does so once.
        const originalRevision = this.database.prepare("SELECT revision FROM repository_meta WHERE repository_id = ?").get(this.location.repository_id).revision;
        if (snapshot.revision === originalRevision) snapshot.revision += 1;
        else if (snapshot.revision !== originalRevision + 1) throw new Error(`team control mutation must advance revision exactly once (was ${originalRevision}, became ${requestedRevision})`);
        snapshot.updated_at = teamTimestamp(options.now ?? snapshot.updated_at ?? new Date().toISOString());
        this.#replaceSnapshot(snapshot);
      }
      return { result, snapshot: structuredClone(snapshot), changed };
    });
    return retryBusy(() => execute.immediate());
  }

  appendEvent(snapshot, type, data = {}, nowValue = new Date().toISOString()) {
    const now = teamTimestamp(nowValue);
    const priorHash = snapshot.events.at(-1)?.event_hash ?? null;
    const base = {
      schema_version: 1,
      sequence: (snapshot.events.at(-1)?.sequence ?? 0) + 1,
      event_id: data.event_id ?? `evt-${crypto.randomUUID()}`,
      type,
      timestamp: now,
      previous_hash: priorHash,
      ...data
    };
    delete base.event_hash;
    const event = { ...base, event_hash: recordDigest(base) };
    snapshot.events.push(event);
    if (snapshot.events.length > MAX_ROWS.events) snapshot.events.splice(0, snapshot.events.length - MAX_ROWS.events);
    return event;
  }

  consumeNonce(options = {}) {
    const keyId = String(options.keyId ?? "");
    const nonce = String(options.nonce ?? "");
    const operation = String(options.operation ?? "");
    const expiresAt = teamTimestamp(options.expiresAt, "action nonce expiry");
    const consumedAt = teamTimestamp(options.now ?? new Date().toISOString());
    if (!keyId || !nonce || !operation) throw new Error("action nonce requires key id, nonce, and operation");
    if (Date.parse(expiresAt) <= Date.parse(consumedAt)) throw new Error("action nonce is expired");
    try {
      retryBusy(() => {
        this.database.prepare("DELETE FROM action_nonces WHERE expires_at <= ?").run(consumedAt);
        const count = this.database.prepare("SELECT COUNT(*) AS count FROM action_nonces").get().count;
        if (count >= MAX_ROWS.action_nonces) throw new Error(`team control action nonces exceed the ${MAX_ROWS.action_nonces}-row budget`);
        this.database.prepare("INSERT INTO action_nonces (key_id, nonce, operation, repository_id, task_id, consumed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(keyId, nonce, operation, this.location.repository_id, options.taskId ?? null, consumedAt, expiresAt);
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") throw new Error("signed action nonce was replayed");
      throw error;
    }
  }

  putTrustedKey(record, options = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("trusted team key record is required");
    if (Object.keys(record).some((key) => /private|secret/i.test(key))) throw new Error("trusted team key record cannot contain private or secret material");
    const roles = [...new Set(record.roles ?? [])].sort();
    const capabilities = [...new Set(record.capabilities ?? [])].sort();
    const maxTtlSeconds = Number(record.max_ttl_seconds ?? 300);
    const validFrom = teamTimestamp(record.valid_from ?? options.now ?? new Date().toISOString());
    const validUntil = record.valid_until ? teamTimestamp(record.valid_until) : null;
    if (!Array.isArray(record.roles) || roles.length > 20 || roles.some((item) => !PRINCIPAL_ROLES.has(item))) throw new Error("trusted team key roles are invalid");
    if (!Array.isArray(record.capabilities) || capabilities.length > 50 || capabilities.some((item) => !TEAM_CAPABILITIES.has(item))) throw new Error("trusted team key capabilities are invalid");
    if (typeof record.public_key_pem !== "string" || record.public_key_pem.length > 8_192 || !record.public_key_pem.includes("PUBLIC KEY")) throw new Error("trusted team key requires a bounded PEM public key");
    let publicKey;
    try { publicKey = crypto.createPublicKey(record.public_key_pem); } catch { throw new Error("trusted team key public key is invalid"); }
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("trusted team key must use Ed25519");
    if (!Number.isInteger(maxTtlSeconds) || maxTtlSeconds < 30 || maxTtlSeconds > 86_400) throw new Error("trusted team key max TTL must be 30-86400 seconds");
    if (validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) throw new Error("trusted team key validity window is invalid");
    const normalized = {
      key_id: safeTeamId(record.key_id, "trusted team key id"),
      issuer: safeTeamId(record.issuer, "trusted team key issuer"),
      principal_id: safeTeamId(record.principal_id, "trusted team key principal"),
      public_key_pem: record.public_key_pem,
      roles,
      capabilities,
      max_ttl_seconds: maxTtlSeconds,
      status: record.status ?? "ACTIVE",
      valid_from: validFrom,
      valid_until: validUntil
    };
    if (!normalized.key_id || !normalized.issuer || !normalized.principal_id || !["ACTIVE", "REVOKED"].includes(normalized.status)) throw new Error("trusted team key identity or status is invalid");
    const hash = recordDigest(normalized);
    const execute = this.database.transaction(() => {
      const existing = this.database.prepare("SELECT record_hash FROM trusted_keys WHERE key_id = ?").get(normalized.key_id);
      if (existing && existing.record_hash === hash) return { ...normalized, record_hash: hash, duplicate: true };
      if (existing && !options.replace) throw new Error("trusted team key already exists with different policy");
      this.database.prepare(`INSERT INTO trusted_keys (key_id, issuer, principal_id, public_key_pem, roles_json, capabilities_json, max_ttl_seconds, status, valid_from, valid_until, record_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key_id) DO UPDATE SET issuer=excluded.issuer, principal_id=excluded.principal_id, public_key_pem=excluded.public_key_pem,
        roles_json=excluded.roles_json, capabilities_json=excluded.capabilities_json, max_ttl_seconds=excluded.max_ttl_seconds,
        status=excluded.status, valid_from=excluded.valid_from, valid_until=excluded.valid_until, record_hash=excluded.record_hash`)
        .run(normalized.key_id, normalized.issuer, normalized.principal_id, normalized.public_key_pem, JSON.stringify(roles), JSON.stringify(capabilities), maxTtlSeconds, normalized.status, validFrom, validUntil, hash);
      this.database.prepare("UPDATE repository_meta SET revision = revision + 1, updated_at = ? WHERE repository_id = ?").run(options.now ?? validFrom, this.location.repository_id);
      if (!/^[a-f0-9]{64}$/.test(options.authorizationEvidenceHash ?? "")) throw new Error("trusted team key mutation requires authorization evidence");
      this.#insertDirectEvent(normalized.status === "REVOKED" ? "TRUST_KEY_REVOKED" : existing ? "TRUST_KEY_UPDATED" : "TRUST_KEY_REGISTERED", { principal_id: options.administeredBy ?? null, key_id: normalized.key_id, trusted_principal_id: normalized.principal_id, record_hash: hash, authorization_evidence_hash: options.authorizationEvidenceHash }, options.now ?? validFrom);
      return { ...normalized, record_hash: hash, duplicate: false };
    });
    return retryBusy(() => execute.immediate());
  }

  getTrustedKey(keyId) {
    const row = this.database.prepare("SELECT key_id, issuer, principal_id, public_key_pem, roles_json, capabilities_json, max_ttl_seconds, status, valid_from, valid_until, record_hash FROM trusted_keys WHERE key_id = ?").get(String(keyId ?? ""));
    if (!row) return null;
    const record = { ...row, roles: parseJson(row.roles_json, "trusted key roles"), capabilities: parseJson(row.capabilities_json, "trusted key capabilities") };
    delete record.roles_json; delete record.capabilities_json;
    const claimed = record.record_hash; delete record.record_hash;
    if (claimed !== recordDigest(record)) throw new Error("trusted team key record hash mismatch");
    return { ...record, record_hash: claimed };
  }

  listTrustedKeys(options = {}) {
    const limit = Number(options.limit ?? 2_000);
    if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) throw new Error("trusted team key list limit must be 1-2000");
    return this.database.prepare("SELECT key_id FROM trusted_keys ORDER BY key_id LIMIT ?").all(limit).map((row) => this.getTrustedKey(row.key_id));
  }

  revokeTrustedKey(keyId, options = {}) {
    const current = this.getTrustedKey(keyId);
    if (!current) throw new Error("trusted team key does not exist");
    if (current.status === "REVOKED") return { ...current, duplicate: true };
    const { record_hash: ignored, ...record } = current;
    return this.putTrustedKey({ ...record, status: "REVOKED" }, { ...options, replace: true });
  }

  previewLegacyMigration() {
    const files = [this.location.legacy_registry_file, this.location.legacy_queue_file].filter((file) => safeRegularFile(file, "legacy team control file", 8 * 1024 * 1024));
    const current = this.#snapshot();
    const hasCurrentData = current.tasks.length || current.claims.length || current.packages.length || current.decisions.length;
    const sources = files.map((file) => {
      const content = readSafeRegularFile(file, "legacy team control file", 8 * 1024 * 1024);
      return { file, bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
    });
    const sourceHash = recordDigest(sources);
    const applied = files.length ? this.database.prepare("SELECT migration_id, backup_directory, created_at FROM migration_journal WHERE source_hash = ? ORDER BY created_at DESC LIMIT 1").get(sourceHash) : null;
    return {
      schema_version: 1,
      status: !files.length ? "NOT_REQUIRED" : applied ? "APPLIED" : hasCurrentData ? "CONFLICT" : "READY",
      sources,
      target: this.location.database_file,
      legacy_files_retained: true,
      prior_migration: applied ?? null
    };
  }

  applyLegacyMigration(options = {}) {
    const preview = this.previewLegacyMigration();
    if (["NOT_REQUIRED", "APPLIED"].includes(preview.status)) return { ...preview, applied: false };
    if (preview.status !== "READY") throw new Error("legacy team control migration conflicts with existing SQLite state");
    const migrationId = String(options.migrationId ?? `team-control-${crypto.randomUUID()}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(migrationId)) throw new Error("legacy migration id must be a safe path segment");
    const backupRoot = path.join(this.location.state_directory, "legacy-backups");
    if (fs.existsSync(backupRoot) && fs.lstatSync(backupRoot).isSymbolicLink()) throw new Error("legacy backup root cannot be a symbolic link");
    const backupDirectory = path.join(backupRoot, migrationId);
    if (fs.existsSync(backupDirectory)) throw new Error("legacy migration backup directory already exists");
    const sourceBuffers = new Map(preview.sources.map((source) => {
      const content = readSafeRegularFile(source.file, "legacy team control source", 8 * 1024 * 1024);
      const current = { file: source.file, bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
      if (current.bytes !== source.bytes || current.sha256 !== source.sha256) throw new Error("legacy team control source changed after migration preview");
      return [source.file, content];
    }));
    const registryContent = sourceBuffers.get(this.location.legacy_registry_file);
    const queueContent = sourceBuffers.get(this.location.legacy_queue_file);
    const registry = registryContent ? verifyLegacyHash(JSON.parse(registryContent.toString("utf8")), "registry_hash", "legacy registry") : null;
    const queue = queueContent ? verifyLegacyHash(JSON.parse(queueContent.toString("utf8")), "queue_hash", "legacy integration queue") : null;
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    for (const source of preview.sources) fs.writeFileSync(path.join(backupDirectory, path.basename(source.file)), sourceBuffers.get(source.file), { flag: "wx", mode: 0o600 });
    const now = teamTimestamp(options.now ?? new Date().toISOString());
    const sourceHash = recordDigest(preview.sources);
    let receipt;
    const migrated = this.mutate((snapshot) => {
      snapshot.tasks = structuredClone(registry?.tasks ?? []);
      snapshot.claims = structuredClone(registry?.claims ?? []);
      snapshot.host_attestations = structuredClone(registry?.host_attestations ?? []);
      snapshot.packages = structuredClone(queue?.packages ?? []);
      snapshot.decisions = structuredClone(queue?.decisions ?? []);
      snapshot.fencing_counter = Number(registry?.fencing_counter ?? 0);
      snapshot.created_at = registry?.created_at ?? now;
      this.appendEvent(snapshot, "LEGACY_STATE_MIGRATED", { migration_id: migrationId, source_hash: sourceHash }, now);
      receipt = { schema_version: 1, migration_id: migrationId, source_hash: sourceHash, backup_directory: backupDirectory, database_file: this.location.database_file, legacy_files_retained: true, applied_at: now, revision: snapshot.revision + 1 };
      this.database.prepare("INSERT INTO migration_journal (migration_id, source_hash, backup_directory, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(migrationId, sourceHash, backupDirectory, JSON.stringify(receipt), now);
      return true;
    }, { now });
    if (receipt.revision !== migrated.snapshot.revision) throw new Error("legacy migration receipt revision mismatch");
    return { ...preview, status: "APPLIED", applied: true, receipt };
  }

  health() {
    const integrity = this.database.pragma("integrity_check", { simple: true });
    let schemaIntegrity = "ok";
    let canonicalIntegrity = "ok";
    let diagnostic = null;
    let migration = { schema_version: 1, status: "UNKNOWN", sources: [], target: this.location.database_file, legacy_files_retained: true, prior_migration: null };
    try { this.#verifySchema(); } catch (error) { schemaIntegrity = "failed"; diagnostic = error.message; }
    if (schemaIntegrity === "ok") {
      try { migration = this.previewLegacyMigration(); } catch (error) { canonicalIntegrity = "failed"; diagnostic = error.message; }
    }
    let revision = null;
    try { revision = this.database.prepare("SELECT revision FROM repository_meta WHERE repository_id = ?").get(this.location.repository_id)?.revision ?? null; } catch (error) { diagnostic ??= error.message; }
    const ready = integrity === "ok" && schemaIntegrity === "ok" && canonicalIntegrity === "ok" && migration.status !== "CONFLICT";
    return {
      schema_version: 1,
      status: ready ? (migration.status === "READY" ? "MIGRATION_REQUIRED" : "READY") : "DEGRADED",
      integrity,
      schema_integrity: schemaIntegrity,
      canonical_integrity: canonicalIntegrity,
      diagnostic,
      repository_id: this.location.repository_id,
      database_file: this.location.database_file,
      journal_mode: this.database.pragma("journal_mode", { simple: true }),
      synchronous: this.database.pragma("synchronous", { simple: true }),
      foreign_keys: this.database.pragma("foreign_keys", { simple: true }),
      revision,
      legacy_migration: migration
    };
  }

  close() { this.database.close(); }
}

export function withTeamControlStore(options, callback) {
  const store = new TeamControlStore(options);
  try { return callback(store); } finally { store.close(); }
}
