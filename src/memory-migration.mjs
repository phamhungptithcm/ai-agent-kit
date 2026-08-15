import fs from "node:fs";
import path from "node:path";

import { hasSymlinkComponent } from "./paths.mjs";
import { memoryDigest, normalizeLegacyMemoryEntry, resolveRepositoryIdentity } from "./memory-contract.mjs";
import { withMemoryStore } from "./memory-store.mjs";

function ledgerPath(root) {
  const rel = ".ai-agent-kit/runtime/memory/entries.jsonl";
  if (hasSymlinkComponent(root, rel)) throw new Error("legacy memory ledger path is unsafe");
  return path.join(root, rel);
}

function migrationId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("migration id must be a safe bounded identifier");
  return value;
}

function inspectLedger(root, options) {
  const file = ledgerPath(root);
  if (!fs.existsSync(file)) return { file, source_hash: memoryDigest(""), entries: [], rejected: [] };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("legacy memory ledger must be a bounded regular file");
  const content = fs.readFileSync(file, "utf8");
  const identity = resolveRepositoryIdentity({ ...options, target: root });
  const latest = new Map(); const rejected = [];
  content.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeLegacyMemoryEntry(parsed, { ...options, target: root, repositoryIdentity: identity });
      latest.set(normalized.id, normalized);
    } catch (error) {
      rejected.push({ line: index + 1, reason: error.message, line_hash: memoryDigest(line) });
    }
  });
  return { file, source_hash: memoryDigest(content), entries: [...latest.values()].sort((a, b) => a.id.localeCompare(b.id)), rejected };
}

export function migrateLegacyMemory(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const inspected = inspectLedger(root, options);
  return withMemoryStore({ ...options, target: root }, (store) => {
    const imported = store.importEntries(inspected.entries, { apply: false });
    const preview = { ...imported.preview, reject: inspected.rejected };
    const migrationIdentifier = migrationId(options.migrationId ?? `v2-to-v3-${inspected.source_hash.slice(0, 16)}`);
    if (!options.apply) return { schema_version: 1, migration_id: migrationIdentifier, status: preview.conflict.length || preview.reject.length ? "BLOCKED" : "PREVIEW", source_hash: inspected.source_hash, preview };
    if (preview.conflict.length || preview.reject.length) throw new Error("memory migration cannot apply while rejected or conflicting records remain");
    const backup = `${inspected.file}.backup-${migrationIdentifier}`;
    if (fs.existsSync(inspected.file)) {
      if (fs.existsSync(backup)) {
        const existing = fs.readFileSync(backup); const current = fs.readFileSync(inspected.file);
        if (!existing.equals(current)) throw new Error("memory migration backup path already contains different data");
      } else fs.copyFileSync(inspected.file, backup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backup, 0o600);
    }
    return store.applyMigration(inspected.entries, {
      migrationId: migrationIdentifier,
      sourceHash: inspected.source_hash,
      backupPath: fs.existsSync(backup) ? path.relative(root, backup).replaceAll("\\", "/") : null,
      actor: options.actor ?? "migration-operator"
    });
  });
}

export function rollbackMemoryMigration(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  if (!options.migrationId) throw new Error("memory migration rollback requires a migration id");
  const migrationIdentifier = migrationId(options.migrationId);
  return withMemoryStore({ ...options, target: root }, (store) => {
    const receipt = store.getMigrationReceipt(migrationIdentifier);
    if (!receipt || receipt.status !== "APPLIED") throw new Error("applied memory migration receipt was not found");
    const removed = store.deleteImported(receipt.imported, { actor: options.actor ?? "migration-operator", reasonCode: "MIGRATION_ROLLBACK" });
    return { schema_version: 1, migration_id: receipt.migration_id, status: "ROLLED_BACK", removed, preserved_legacy_backup: receipt.backup_path, rolled_back_at: new Date().toISOString() };
  });
}
