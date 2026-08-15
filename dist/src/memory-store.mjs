import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { hasSymlinkComponent } from "./paths.mjs";
import { memoryDigest, stableValue, validateMemoryEntry } from "./memory-contract.mjs";

const STORE_PROTOCOL = "aak-memory-store-v1";
const REQUIRED_REMOTE_CAPABILITIES = ["repository_binding", "acl", "audit_receipts", "transport_encryption", "at_rest_encryption", "retention", "replay_protection"];
const MAX_ENTRIES = 10_000;

function stableJson(value) { return JSON.stringify(stableValue(value)); }
function timestamp(value = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("memory store timestamp is invalid");
  return new Date(value).toISOString();
}
function safeKey(value, label) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new Error(`${label} is invalid`);
  return value;
}

function retrySqliteBusy(callback, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return callback(); } catch (error) {
      if (!["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error.code) && !/database is (?:locked|busy)/i.test(error.message ?? "")) throw error;
      lastError = error;
      const wait = 20 + ((process.pid + attempt * 7) % 23);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
  throw lastError;
}

function defaultDatabasePath(root) {
  const rel = ".ai-agent-kit/runtime/memory/memory.sqlite3";
  if (hasSymlinkComponent(root, rel)) throw new Error("refusing memory database access through a symbolic link");
  return path.join(root, rel);
}

function assertSafeDatabasePath(root, requested) {
  const file = path.resolve(requested ?? defaultDatabasePath(root));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("memory database must remain inside a non-symlinked repository path");
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error("memory database must be a non-linked regular file");
  }
  return file;
}

export class MemoryStore {
  propose() { throw new Error("MemoryStore.propose is not implemented"); }
  approve() { throw new Error("MemoryStore.approve is not implemented"); }
  promote() { throw new Error("MemoryStore.promote is not implemented"); }
  transition() { throw new Error("MemoryStore.transition is not implemented"); }
  get() { throw new Error("MemoryStore.get is not implemented"); }
  list() { throw new Error("MemoryStore.list is not implemented"); }
  exportEntries() { throw new Error("MemoryStore.exportEntries is not implemented"); }
  importEntries() { throw new Error("MemoryStore.importEntries is not implemented"); }
  importPack() { throw new Error("MemoryStore.importPack is not implemented"); }
  applyMigration() { throw new Error("MemoryStore.applyMigration is not implemented"); }
  health() { throw new Error("MemoryStore.health is not implemented"); }
  capabilities() { throw new Error("MemoryStore.capabilities is not implemented"); }
  close() {}
}

export class LocalSqliteMemoryStore extends MemoryStore {
  constructor(options = {}) {
    super();
    this.root = path.resolve(options.target ?? process.cwd());
    this.file = assertSafeDatabasePath(this.root, options.database);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(this.file), 0o700);
    try {
      this.database = new Database(this.file, { timeout: Number(options.timeoutMs ?? 5000), fileMustExist: false });
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`memory database could not be opened safely: ${error.message}`);
    }
    try {
      this.database.pragma("busy_timeout = 5000");
      retrySqliteBusy(() => this.database.pragma("journal_mode = WAL"));
      retrySqliteBusy(() => this.database.pragma("synchronous = FULL"));
      retrySqliteBusy(() => this.database.pragma("foreign_keys = ON"));
      retrySqliteBusy(() => this.database.pragma("trusted_schema = OFF"));
      retrySqliteBusy(() => this.#migrate());
      this.#verifySchema();
    } catch (error) {
      this.database.close();
      throw new Error(`memory database initialization failed closed: ${error.message}`);
    }
  }

  #migrate() {
    const current = this.database.pragma("user_version", { simple: true });
    if (current > 1) throw new Error(`memory database schema ${current} is newer than supported schema 1`);
    if (current === 1) return;
    this.database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        branch TEXT,
        module_key TEXT,
        task_id TEXT,
        run_id TEXT,
        session_id TEXT,
        agent_id TEXT,
        title TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_scope_idx ON memory_entries (organization_id, repository_id, status, visibility);
      CREATE INDEX IF NOT EXISTS memory_title_idx ON memory_entries (organization_id, repository_id, title);
      CREATE TABLE IF NOT EXISTS memory_receipts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        entry_id TEXT,
        action TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        receipt_hash TEXT NOT NULL,
        previous_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS replay_keys (
        replay_key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS migration_journal (
        migration_id TEXT PRIMARY KEY,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  #verifySchema() {
    const expected = {
      memory_entries: ["id", "revision", "status", "organization_id", "repository_id", "visibility", "branch", "module_key", "task_id", "run_id", "session_id", "agent_id", "title", "content_hash", "record_json", "updated_at"],
      memory_receipts: ["sequence", "event_id", "entry_id", "action", "receipt_json", "receipt_hash", "previous_hash", "created_at"],
      replay_keys: ["replay_key", "created_at", "expires_at"],
      migration_journal: ["migration_id", "receipt_json", "created_at"]
    };
    const unsafeObjects = this.database.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('trigger', 'view')").all();
    if (unsafeObjects.length) throw new Error(`unexpected database objects: ${unsafeObjects.map((item) => `${item.type}:${item.name}`).join(", ")}`);
    for (const [table, columns] of Object.entries(expected)) {
      const actual = this.database.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
      if (actual.length !== columns.length || columns.some((column, index) => actual[index] !== column)) throw new Error(`memory database table ${table} does not match the supported schema`);
    }
  }

  #row(entry) {
    validateMemoryEntry(entry);
    return {
      id: entry.id,
      revision: entry.revision,
      status: entry.status,
      organization_id: entry.scope.organization_id,
      repository_id: entry.scope.repository_id,
      visibility: entry.scope.visibility,
      branch: entry.scope.branch,
      module_key: entry.scope.modules.join("\n"),
      task_id: entry.scope.task_id,
      run_id: entry.scope.run_id,
      session_id: entry.scope.session_id,
      agent_id: entry.scope.agent_id,
      title: entry.title,
      content_hash: entry.content_hash,
      record_json: stableJson(entry),
      updated_at: entry.updated_at
    };
  }

  #entryFromRow(row) {
    if (!row) return null;
    let entry;
    try { entry = validateMemoryEntry(JSON.parse(row.record_json)); } catch (error) { throw new Error(`stored memory entry is invalid: ${error.message}`); }
    const expected = this.#row(entry);
    for (const [key, value] of Object.entries(expected)) if (row[key] !== value) throw new Error(`stored memory row is inconsistent with its canonical record: ${key}`);
    return entry;
  }

  #put(entry, { create = false } = {}) {
    const row = this.#row(entry);
    if (create && this.database.prepare("SELECT COUNT(*) AS count FROM memory_entries").get().count >= MAX_ENTRIES) throw new Error(`memory store exceeds its ${MAX_ENTRIES}-entry budget`);
    const statement = create
      ? `INSERT INTO memory_entries (id, revision, status, organization_id, repository_id, visibility, branch, module_key, task_id, run_id, session_id, agent_id, title, content_hash, record_json, updated_at)
         VALUES (@id, @revision, @status, @organization_id, @repository_id, @visibility, @branch, @module_key, @task_id, @run_id, @session_id, @agent_id, @title, @content_hash, @record_json, @updated_at)`
      : `UPDATE memory_entries SET revision=@revision, status=@status, organization_id=@organization_id, repository_id=@repository_id,
         visibility=@visibility, branch=@branch, module_key=@module_key, task_id=@task_id, run_id=@run_id, session_id=@session_id,
         agent_id=@agent_id, title=@title, content_hash=@content_hash, record_json=@record_json, updated_at=@updated_at WHERE id=@id`;
    this.database.prepare(statement).run(row);
  }

  #receipt(action, entry, options = {}) {
    const prior = this.database.prepare("SELECT receipt_hash FROM memory_receipts ORDER BY sequence DESC LIMIT 1").get();
    const createdAt = timestamp(options.now);
    const data = {
      schema_version: 1,
      store_protocol: STORE_PROTOCOL,
      action,
      memory_id: entry?.id ?? null,
      revision: entry?.revision ?? null,
      status: entry?.status ?? null,
      content_hash: entry?.content_hash ?? null,
      actor_hash: options.actor ? memoryDigest(options.actor) : null,
      reason_code: options.reasonCode ?? null,
      selected: options.selected ?? null,
      excluded: options.excluded ?? null,
      previous_receipt_hash: prior?.receipt_hash ?? null,
      created_at: createdAt
    };
    const receiptHash = memoryDigest(data);
    const baseAction = action.replace(/_IDEMPOTENT$/, "");
    const eventId = options.eventId ?? (options.idempotencyKey
      ? memoryDigest({ action: baseAction, idempotency_key: options.idempotencyKey })
      : memoryDigest({ action, receipt_hash: receiptHash }));
    const existing = this.database.prepare("SELECT receipt_json FROM memory_receipts WHERE event_id = ?").get(eventId);
    if (existing) return JSON.parse(existing.receipt_json);
    const receipt = { ...data, receipt_hash: receiptHash };
    this.database.prepare("INSERT INTO memory_receipts (event_id, entry_id, action, receipt_json, receipt_hash, previous_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, entry?.id ?? null, action, stableJson(receipt), receiptHash, data.previous_receipt_hash, createdAt);
    return receipt;
  }

  #transaction(callback) { return retrySqliteBusy(() => this.database.transaction(callback)()); }

  #previewImport(entries) {
    const preview = { create: [], preserve: [], update: [], reject: [], conflict: [] };
    for (const entry of entries) {
      const current = this.get(entry.id);
      if (!current) preview.create.push(entry.id);
      else if (current.content_hash === entry.content_hash && current.revision === entry.revision) preview.preserve.push(entry.id);
      else if (current.content_hash === entry.content_hash && entry.revision > current.revision) preview.update.push(entry.id);
      else preview.conflict.push(entry.id);
    }
    return preview;
  }

  #applyImport(entries, preview) {
    if (preview.conflict.length) throw new Error(`memory import conflicts: ${preview.conflict.join(", ")}`);
    if (this.database.prepare("SELECT COUNT(*) AS count FROM memory_entries").get().count + preview.create.length > MAX_ENTRIES) throw new Error(`memory import exceeds the ${MAX_ENTRIES}-entry store budget`);
    for (const entry of entries) {
      if (preview.create.includes(entry.id)) this.#put(entry, { create: true });
      else if (preview.update.includes(entry.id)) this.#put(entry);
    }
  }

  propose(entry, options = {}) {
    validateMemoryEntry(entry);
    if (entry.status !== "PROPOSED") throw new Error("MemoryStore.propose accepts PROPOSED entries only");
    return this.#transaction(() => {
      const current = this.get(entry.id);
      if (current) {
        if (current.content_hash === entry.content_hash) return { entry: current, receipt: this.#receipt("PROPOSE_IDEMPOTENT", current, options), duplicate: true };
        throw new Error(`memory id conflict: ${entry.id}`);
      }
      this.#put(entry, { create: true });
      return { entry, receipt: this.#receipt("PROPOSE", entry, options), duplicate: false };
    });
  }

  approve(id, options = {}) {
    safeKey(id, "memory id");
    return this.#transaction(() => {
      const current = this.get(id);
      if (!current) throw new Error(`memory not found: ${id}`);
      if (current.status === "APPROVED" && current.approver === options.approver) return { entry: current, receipt: this.#receipt("APPROVE_IDEMPOTENT", current, options), duplicate: true };
      if (current.status !== "PROPOSED") throw new Error("only proposed memory can be approved");
      if (Number(options.expectedRevision ?? current.revision) !== current.revision) throw new Error(`memory revision conflict: expected ${options.expectedRevision}, current ${current.revision}`);
      if (!options.approver) throw new Error("memory approval requires a named approver");
      if (current.created_by === options.approver) throw new Error("memory creator cannot self-approve durable memory");
      const reviewDate = options.reviewDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate ?? "") || Date.parse(`${reviewDate}T00:00:00.000Z`) <= Date.now()) throw new Error("memory approval requires a future review date");
      if (!current.provenance.source_commit) throw new Error("memory approval requires a source commit");
      const approvedAt = timestamp(options.now);
      const approved = validateMemoryEntry({
        ...current,
        revision: current.revision + 1,
        status: "APPROVED",
        trust_tier: current.trust_tier === "provisional" ? "reviewed" : current.trust_tier,
        approver: options.approver,
        retention: { ...current.retention, review_date: reviewDate },
        approved_at: approvedAt,
        last_reviewed_at: approvedAt,
        updated_at: approvedAt
      });
      this.#put(approved);
      return { entry: approved, receipt: this.#receipt("APPROVE", approved, options), duplicate: false };
    });
  }

  promote(entry, options = {}) {
    validateMemoryEntry(entry);
    if (entry.status !== "APPROVED") throw new Error("MemoryStore.promote accepts approved entries only");
    return this.#transaction(() => {
      const current = this.get(entry.id);
      if (current) {
        if (current.status === "APPROVED" && current.provenance.candidate_hash === entry.provenance.candidate_hash) {
          return { entry: current, receipt: this.#receipt("PROMOTE_IDEMPOTENT", current, options), duplicate: true };
        }
        throw new Error(`memory promotion conflict: ${entry.id}`);
      }
      this.#put(entry, { create: true });
      return { entry, receipt: this.#receipt("PROMOTE", entry, options), duplicate: false };
    });
  }

  transition(id, action, options = {}) {
    const targetStatus = { revoke: "REVOKED", supersede: "SUPERSEDED", reject: "REJECTED", stale: "STALE" }[action];
    if (!targetStatus) throw new Error("memory transition is invalid");
    return this.#transaction(() => {
      const current = this.get(id);
      if (!current) throw new Error(`memory not found: ${id}`);
      if (current.status === targetStatus) return { entry: current, receipt: this.#receipt(`${action.toUpperCase()}_IDEMPOTENT`, current, options), duplicate: true };
      const allowedSource = action === "reject" ? "PROPOSED" : "APPROVED";
      if (current.status !== allowedSource) throw new Error(`${action} requires memory in ${allowedSource} status`);
      if (Number(options.expectedRevision ?? current.revision) !== current.revision) throw new Error(`memory revision conflict: expected ${options.expectedRevision}, current ${current.revision}`);
      if (!options.approver || !options.reason) throw new Error("memory transition requires approver and reason");
      if (action === "supersede") {
        if (!options.replacementId) throw new Error("supersede requires a replacement id");
        const replacement = this.get(options.replacementId);
        if (!replacement || replacement.status !== "APPROVED") throw new Error("supersede replacement must be approved memory");
      }
      const now = timestamp(options.now);
      const next = validateMemoryEntry({
        ...current,
        revision: current.revision + 1,
        status: targetStatus,
        lifecycle: { ...current.lifecycle, reason: options.reason, replacement_id: options.replacementId ?? null },
        updated_at: now
      });
      this.#put(next);
      return { entry: next, receipt: this.#receipt(action.toUpperCase(), next, options), duplicate: false };
    });
  }

  get(id) {
    safeKey(id, "memory id");
    return this.#entryFromRow(this.database.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id));
  }

  list(options = {}) {
    const clauses = [];
    const values = [];
    for (const [column, value] of [["organization_id", options.organizationId], ["repository_id", options.repositoryId], ["status", options.status]]) {
      if (value != null) { clauses.push(`${column} = ?`); values.push(value); }
    }
    const limit = Number(options.maxEntries ?? MAX_ENTRIES);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ENTRIES) throw new Error(`memory list limit must be from 1 to ${MAX_ENTRIES}`);
    const sql = `SELECT * FROM memory_entries${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id ASC LIMIT ?`;
    return this.database.prepare(sql).all(...values, limit).map((row) => this.#entryFromRow(row));
  }

  recordRetrieval(receipt, options = {}) {
    return this.#transaction(() => this.#receipt("RETRIEVE", null, {
      ...options,
      reasonCode: receipt.status,
      selected: receipt.selected,
      excluded: receipt.excluded,
      eventId: receipt.receipt_id
    }));
  }

  reserveReplayKey(key, options = {}) {
    safeKey(key, "replay key");
    return this.#transaction(() => {
      const existing = this.database.prepare("SELECT replay_key FROM replay_keys WHERE replay_key = ?").get(key);
      if (existing) return false;
      this.database.prepare("INSERT INTO replay_keys (replay_key, created_at, expires_at) VALUES (?, ?, ?)").run(key, timestamp(options.now), options.expiresAt ?? null);
      return true;
    });
  }

  deleteImported(ids, options = {}) {
    return this.#transaction(() => {
      const removed = [];
      for (const item of ids) {
        const current = this.get(item.id);
        if (!current || current.revision !== item.revision || current.content_hash !== item.content_hash) throw new Error(`rollback conflict for memory ${item.id}`);
        this.database.prepare("DELETE FROM memory_entries WHERE id = ?").run(item.id);
        removed.push(item.id);
      }
      this.#receipt("MIGRATION_ROLLBACK", null, { ...options, selected: removed.map((id) => ({ id })) });
      return removed;
    });
  }

  exportEntries(options = {}) {
    const entries = this.list(options);
    return entries.map((entry) => stableJson(entry)).join("\n") + (entries.length ? "\n" : "");
  }

  importEntries(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error("memory import must be a bounded array");
    const validated = entries.map(validateMemoryEntry);
    const preview = this.#previewImport(validated);
    if (!options.apply) return { status: preview.conflict.length ? "CONFLICT" : "PREVIEW", preview };
    return this.#transaction(() => {
      const currentPreview = this.#previewImport(validated);
      this.#applyImport(validated, currentPreview);
      const receipt = this.#receipt("IMPORT", null, { ...options, selected: [...currentPreview.create, ...currentPreview.update].map((id) => ({ id })) });
      return { status: "APPLIED", preview: currentPreview, receipt };
    });
  }

  importPack(entries, replayKey, options = {}) {
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error("memory pack import must be a bounded array");
    safeKey(replayKey, "replay key");
    const validated = entries.map(validateMemoryEntry);
    return this.#transaction(() => {
      if (this.database.prepare("SELECT replay_key FROM replay_keys WHERE replay_key = ?").get(replayKey)) throw new Error("memory pack replay was rejected");
      const preview = this.#previewImport(validated);
      this.#applyImport(validated, preview);
      this.database.prepare("INSERT INTO replay_keys (replay_key, created_at, expires_at) VALUES (?, ?, ?)").run(replayKey, timestamp(options.now), options.expiresAt ?? null);
      const receipt = this.#receipt("SIGNED_PACK_IMPORT", null, { ...options, selected: [...preview.create, ...preview.update].map((id) => ({ id })) });
      return { status: "APPLIED", preview, receipt };
    });
  }

  applyMigration(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error("memory migration must be a bounded array");
    const validated = entries.map(validateMemoryEntry);
    const migrationId = safeKey(options.migrationId, "migration id");
    return this.#transaction(() => {
      const existing = this.getMigrationReceipt(migrationId);
      if (existing) return existing;
      const preview = this.#previewImport(validated);
      this.#applyImport(validated, preview);
      const storeReceipt = this.#receipt("MIGRATION_IMPORT", null, { actor: options.actor, idempotencyKey: migrationId, selected: [...preview.create, ...preview.update].map((id) => ({ id })) });
      const receipt = {
        schema_version: 1,
        migration_id: migrationId,
        status: "APPLIED",
        source_hash: options.sourceHash,
        backup_path: options.backupPath ?? null,
        imported: [...preview.create, ...preview.update].map((id) => { const entry = this.get(id); return { id, revision: entry.revision, content_hash: entry.content_hash }; }),
        preserved: preview.preserve,
        store_receipt_hash: storeReceipt.receipt_hash,
        created_at: timestamp(options.now)
      };
      this.database.prepare("INSERT INTO migration_journal (migration_id, receipt_json, created_at) VALUES (?, ?, ?)").run(migrationId, stableJson(receipt), receipt.created_at);
      return receipt;
    });
  }

  saveMigrationReceipt(receipt) {
    const id = safeKey(receipt.migration_id, "migration id");
    this.database.prepare("INSERT INTO migration_journal (migration_id, receipt_json, created_at) VALUES (?, ?, ?) ON CONFLICT(migration_id) DO NOTHING")
      .run(id, stableJson(receipt), timestamp(receipt.created_at));
    return this.getMigrationReceipt(id);
  }

  getMigrationReceipt(id) {
    const row = this.database.prepare("SELECT receipt_json FROM migration_journal WHERE migration_id = ?").get(id);
    return row ? JSON.parse(row.receipt_json) : null;
  }

  health() {
    const integrity = this.database.pragma("integrity_check", { simple: true });
    const count = this.database.prepare("SELECT COUNT(*) AS count FROM memory_entries").get().count;
    const receiptCount = this.database.prepare("SELECT COUNT(*) AS count FROM memory_receipts").get().count;
    return {
      schema_version: 1,
      store_protocol: STORE_PROTOCOL,
      backend: "local-sqlite",
      status: integrity === "ok" ? "HEALTHY" : "REJECTED",
      integrity,
      wal: this.database.pragma("journal_mode", { simple: true }).toUpperCase() === "WAL",
      entries: count,
      receipts: receiptCount,
      database_path_hash: memoryDigest(this.file)
    };
  }

  capabilities() {
    return { protocol: STORE_PROTOCOL, backend: "local-sqlite", transactional: true, wal: true, offline: true, import_export: true, replay_protection: true, max_record_bytes: 64 * 1024 };
  }

  close() { if (this.database?.open) this.database.close(); }
}

export class RemoteMemoryStore extends MemoryStore {
  constructor(options = {}) {
    super();
    if (!options.transport || typeof options.transport.request !== "function") throw new Error("remote memory store requires an injected transport");
    if (typeof options.capabilityVerifier !== "function") throw new Error("remote memory store requires an independent capability verifier");
    this.transport = options.transport;
    this.repositoryIdentity = options.repositoryIdentity;
    if (!this.repositoryIdentity || typeof this.repositoryIdentity.organization_id !== "string" || !this.repositoryIdentity.organization_id || typeof this.repositoryIdentity.repository_id !== "string" || !this.repositoryIdentity.repository_id) throw new Error("remote memory store requires a repository identity");
    this.writeAuthorization = options.writeAuthorization ?? null;
    this.authorizationVerifier = options.authorizationVerifier ?? null;
    const advertised = this.transport.request({ action: "capabilities", protocol: STORE_PROTOCOL });
    if (advertised && typeof advertised.then === "function") throw new Error("asynchronous remote memory transports are not supported by this runtime");
    if (advertised?.protocol !== STORE_PROTOCOL) throw new Error("remote memory protocol is incompatible");
    const missing = REQUIRED_REMOTE_CAPABILITIES.filter((item) => advertised.capabilities?.[item] !== true);
    if (missing.length) throw new Error(`remote memory capabilities are unverified: ${missing.join(", ")}`);
    if (options.capabilityVerifier(advertised, { repositoryIdentity: this.repositoryIdentity, protocol: STORE_PROTOCOL }) !== true) throw new Error("remote memory capability proof was rejected");
    this.advertised = advertised;
  }

  #request(action, payload, { write = false } = {}) {
    if (write) {
      if (!this.writeAuthorization) throw new Error("remote memory write requires separate authorization");
      const authorization = this.writeAuthorization;
      const structurallyValid = authorization && typeof authorization === "object" && !Array.isArray(authorization)
        && typeof authorization.authorization_id === "string" && authorization.authorization_id.length > 0 && authorization.authorization_id.length <= 512
        && authorization.repository_id === this.repositoryIdentity?.repository_id
        && (!authorization.organization_id || authorization.organization_id === this.repositoryIdentity?.organization_id)
        && Number.isFinite(Date.parse(authorization.expires_at)) && Date.parse(authorization.expires_at) > Date.now()
        && Array.isArray(authorization.actions) && (authorization.actions.includes("*") || authorization.actions.includes(action));
      if (!structurallyValid || typeof this.authorizationVerifier !== "function" || this.authorizationVerifier(authorization, { action, repositoryIdentity: this.repositoryIdentity, protocol: STORE_PROTOCOL }) !== true) {
        throw new Error("remote memory write authorization is invalid or unverified");
      }
    }
    const result = this.transport.request({ protocol: STORE_PROTOCOL, action, repository_identity: this.repositoryIdentity, write_authorization: write ? this.writeAuthorization : null, payload });
    if (result && typeof result.then === "function") throw new Error("asynchronous remote memory transports are not supported by this runtime");
    if (!result || !["OK", "DEGRADED", "REJECTED"].includes(result.status)) throw new Error("remote memory response is invalid");
    if (result.status === "REJECTED") throw new Error(`remote memory request rejected: ${result.reason_code ?? "UNSPECIFIED"}`);
    if (result.status === "DEGRADED") throw new Error(`remote memory request is degraded: ${result.reason_code ?? "UNSPECIFIED"}`);
    return result;
  }

  #entry(entry) {
    const validated = validateMemoryEntry(entry);
    if (validated.scope.organization_id !== this.repositoryIdentity.organization_id || validated.scope.repository_id !== this.repositoryIdentity.repository_id) throw new Error("remote memory response belongs to a foreign organization or repository");
    return validated;
  }

  #writeResult(result) {
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("remote memory write result is invalid");
    return { ...result, entry: this.#entry(result.entry) };
  }

  propose(entry, options) { return this.#writeResult(this.#request("propose", { entry, options }, { write: true }).result); }
  approve(id, options) { return this.#writeResult(this.#request("approve", { id, options }, { write: true }).result); }
  promote(entry, options) { return this.#writeResult(this.#request("promote", { entry, options }, { write: true }).result); }
  transition(id, action, options) { return this.#writeResult(this.#request("transition", { id, action, options }, { write: true }).result); }
  get(id) { const result = this.#request("get", { id }).result; return result == null ? null : this.#entry(result); }
  list(options) {
    const result = this.#request("list", options).result;
    if (!Array.isArray(result) || result.length > MAX_ENTRIES) throw new Error("remote memory list result is invalid or unbounded");
    return result.map((entry) => this.#entry(entry));
  }
  exportEntries(options) { return this.#request("export", options).result; }
  importEntries(entries, options) { return this.#request("import", { entries, options }, { write: true }).result; }
  importPack(entries, replayKey, options) { return this.#request("import-pack", { entries, replayKey, options }, { write: true }).result; }
  applyMigration(entries, options) { return this.#request("apply-migration", { entries, options }, { write: true }).result; }
  reserveReplayKey(key, options) { return this.#request("reserve-replay", { key, options }, { write: true }).result; }
  health() {
    try { return this.#request("health", {}).result; }
    catch (error) { return { schema_version: 1, store_protocol: STORE_PROTOCOL, backend: "remote", status: "DEGRADED", reason_code: "REMOTE_UNAVAILABLE", error: error.message }; }
  }
  capabilities() { return this.advertised; }
}

export class ResilientMemoryStore extends MemoryStore {
  constructor({ local, remote }) { super(); this.local = local; this.remote = remote; }
  list(options) {
    try { return this.remote.list(options); }
    catch { return this.local.list(options); }
  }
  health() {
    const local = this.local.health(); const remote = this.remote.health();
    return { schema_version: 1, status: remote.status === "HEALTHY" ? "HEALTHY" : "DEGRADED", mode: remote.status === "HEALTHY" ? "REMOTE_AND_LOCAL" : "LOCAL_FALLBACK", local, remote };
  }
  capabilities() { return { local: this.local.capabilities(), remote: this.remote.capabilities() }; }
  close() { this.local.close(); this.remote.close?.(); }
}

export function openMemoryStore(options = {}) {
  if (options.store) return { store: options.store, owned: false };
  return { store: new LocalSqliteMemoryStore(options), owned: true };
}

export function withMemoryStore(options, callback) {
  const { store, owned } = openMemoryStore(options);
  try { return callback(store); } finally { if (owned) store.close(); }
}
