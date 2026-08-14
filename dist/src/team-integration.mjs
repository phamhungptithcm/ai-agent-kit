import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { analyzeTeamConflicts } from "./team-conflicts.mjs";
import { normalizeTeamSurface, rejectRestrictedTeamData, requireTeamCapability, safeTeamId, teamControlDigest, teamTimestamp, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";
import { resolveTeamRegistryLocation, validateRepositoryFence } from "./team-registry.mjs";
import { inspectTeamWorkspace } from "./team-workspace.mjs";

const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const PACKAGE_FIELDS = ["schema_version", "package_id", "task_id", "assignment_id", "commit", "parent_commit", "claim_id", "fencing_token", "author_id", "dependencies", "surfaces", "evidence_hashes", "rollback_ref", "created_at"];

export function createIntegrationPackage(options = {}) {
  rejectRestrictedTeamData(options, "integration package");
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const author = verifyTeamIdentityAuthentication(options.author, { now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey }); requireTeamCapability(author, "integration.enqueue");
  const commit = String(options.commit ?? ""); const parentCommit = String(options.parentCommit ?? "");
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-f0-9]{40,64}$/.test(parentCommit)) throw new Error("integration package requires full commit and parent commit digests");
  const evidenceHashes = [...new Set(options.evidenceHashes ?? [])].sort();
  if (!evidenceHashes.length || evidenceHashes.some((item) => !/^[a-f0-9]{64}$/.test(item))) throw new Error("integration package requires SHA-256 evidence hashes");
  const rollbackRef = String(options.rollbackRef ?? ""); if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(rollbackRef)) throw new Error("integration package rollback reference is invalid");
  const value = {
    schema_version: 1, package_id: safeTeamId(options.packageId ?? `pkg-${crypto.randomUUID()}`, "change package id"),
    task_id: safeTeamId(options.taskId, "task id"), assignment_id: safeTeamId(options.assignmentId, "assignment id"),
    commit, parent_commit: parentCommit, claim_id: safeTeamId(options.claimId, "repository claim id"), fencing_token: options.fencingToken,
    author_id: author.principal_id, dependencies: [...new Set((options.dependencies ?? []).map((item) => safeTeamId(item, "package dependency")))].sort(),
    surfaces: (options.surfaces ?? []).map(normalizeTeamSurface), evidence_hashes: evidenceHashes,
    rollback_ref: rollbackRef, created_at: now
  };
  if (!Number.isInteger(value.fencing_token) || value.fencing_token < 1) throw new Error("integration package fencing token is invalid");
  if (!value.surfaces.length || value.surfaces.length > 500) throw new Error("integration package requires 1-500 change surfaces");
  return { ...value, package_hash: teamControlDigest(value) };
}

export function verifyIntegrationPackage(value) {
  const copy = Object.fromEntries(PACKAGE_FIELDS.map((key) => [key, structuredClone(value[key])])); const claimed = value.package_hash;
  if (!claimed || claimed !== teamControlDigest(copy)) throw new Error("integration package hash mismatch");
  return value;
}

function queueLocation(options) {
  const registry = resolveTeamRegistryLocation(options); const dir = path.dirname(registry.registry_file);
  return { file: path.join(dir, "integration-queue.json"), lock: path.join(dir, "integration-queue.lock") };
}

function readQueue(location) {
  if (!fs.existsSync(location.file)) return { schema_version: 1, revision: 0, packages: [], decisions: [], updated_at: null, queue_hash: null };
  const stat = fs.lstatSync(location.file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_QUEUE_BYTES) throw new Error("integration queue must be a bounded regular file");
  const queue = JSON.parse(fs.readFileSync(location.file, "utf8")); const copy = structuredClone(queue); const claimed = copy.queue_hash; delete copy.queue_hash;
  if (!claimed || claimed !== teamControlDigest(copy)) throw new Error("integration queue hash mismatch"); return queue;
}

function withQueue(options, callback) {
  const location = queueLocation(options); fs.mkdirSync(path.dirname(location.file), { recursive: true, mode: 0o700 }); let descriptor;
  try { descriptor = fs.openSync(location.lock, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(location.lock); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("integration queue lock is unsafe");
    if (Date.now() - stat.mtimeMs <= (options.lockStaleMs ?? 30_000)) throw new Error("integration queue is being updated");
    fs.unlinkSync(location.lock); descriptor = fs.openSync(location.lock, "wx", 0o600);
  }
  try {
    const queue = readQueue(location); const result = callback(queue); const copy = structuredClone(queue); delete copy.queue_hash; queue.queue_hash = teamControlDigest(copy);
    const serialized = `${JSON.stringify(queue, null, 2)}\n`; if (Buffer.byteLength(serialized) > MAX_QUEUE_BYTES) throw new Error("integration queue exceeds its storage budget");
    const temporary = `${location.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`; fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, location.file); return { result, queue };
  } finally { fs.closeSync(descriptor); try { fs.unlinkSync(location.lock); } catch { /* next writer performs bounded recovery */ } }
}

export function enqueueIntegrationPackage(options = {}) {
  const packageValue = verifyIntegrationPackage(options.package); const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withQueue(options, (queue) => {
    if (options.expectedRevision != null && options.expectedRevision !== queue.revision) throw new Error(`integration queue revision conflict: expected ${options.expectedRevision}, current ${queue.revision}`);
    const existing = queue.packages.find((item) => item.package_id === packageValue.package_id);
    if (existing) { if (existing.package_hash !== packageValue.package_hash) throw new Error("change package id already exists with different content"); return existing; }
    const entry = { ...packageValue, state: "QUEUED", enqueued_at: now, admitted_at: null }; queue.packages.push(entry); queue.revision += 1; queue.updated_at = now; return entry;
  }).result;
}

export function evaluateIntegrationAdmission(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const owner = verifyTeamIdentityAuthentication(options.integrationOwner, { now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey }); requireTeamCapability(owner, "integration.admit");
  if (!owner.roles.includes("integration-owner")) throw new Error("integration admission requires the integration-owner role");
  const packages = (options.packages ?? []).map(verifyIntegrationPackage); const candidate = verifyIntegrationPackage(options.package);
  const blockers = [];
  const dependencies = new Set(packages.filter((item) => item.state === "ADMITTED").map((item) => item.package_id));
  for (const dependency of candidate.dependencies) if (!dependencies.has(dependency)) blockers.push(`DEPENDENCY_NOT_ADMITTED:${dependency}`);
  const fence = validateRepositoryFence({ ...options, claimId: candidate.claim_id, fencingToken: candidate.fencing_token, principalId: candidate.author_id, now });
  if (fence.status !== "VALID") blockers.push("STALE_OR_INVALID_FENCE");
  if (options.currentParentCommit !== candidate.parent_commit) blockers.push("PARENT_DRIFT");
  if (options.review?.status !== "ACCEPTED" || options.review?.package_id !== candidate.package_id) blockers.push("INDEPENDENT_REVIEW_REQUIRED");
  const conflict = analyzeTeamConflicts({ packages: [...packages.filter((item) => item.state === "ADMITTED"), candidate] });
  const resolutions = (options.conflictResolutions ?? []).map((item) => {
    const conflictId = safeTeamId(item.conflict_id, "conflict resolution id");
    if (item.decision !== "ACCEPT_ORDERED" || !/^[a-f0-9]{64}$/.test(item.evidence_hash ?? "")) throw new Error("conflict resolution requires ACCEPT_ORDERED and a SHA-256 evidence hash");
    return { conflict_id: conflictId, decision: item.decision, evidence_hash: item.evidence_hash };
  });
  const resolvedIds = new Set(resolutions.map((item) => item.conflict_id)); const unresolvedConflicts = conflict.conflicts.filter((item) => !resolvedIds.has(item.conflict_id));
  if (unresolvedConflicts.length || conflict.unknowns.length) blockers.push("CHANGE_CONFLICT");
  const decision = { schema_version: 1, package_id: candidate.package_id, status: blockers.length ? "BLOCKED" : "ADMITTED", blockers, conflict_analysis_hash: conflict.analysis_hash, resolved_conflicts: resolutions, unresolved_conflicts: unresolvedConflicts.map((item) => item.conflict_id), fence, decided_by: owner.principal_id, decided_at: now };
  return { ...decision, decision_hash: teamControlDigest(decision) };
}

export function recordIntegrationDecision(options = {}) {
  const decision = options.decision; if (!decision?.decision_hash || teamControlDigest(Object.fromEntries(Object.entries(decision).filter(([key]) => key !== "decision_hash"))) !== decision.decision_hash) throw new Error("integration decision hash mismatch");
  return withQueue(options, (queue) => {
    const entry = queue.packages.find((item) => item.package_id === decision.package_id); if (!entry) throw new Error("integration package is not queued");
    if (entry.state === "ADMITTED") return entry;
    if (decision.status === "ADMITTED") {
      const recordedAt = options.now ?? decision.decided_at;
      const fence = validateRepositoryFence({ ...options, claimId: entry.claim_id, fencingToken: entry.fencing_token, principalId: entry.author_id, now: recordedAt });
      if (fence.status !== "VALID") throw new Error("integration decision became stale before it was recorded");
      if (inspectTeamWorkspace({ target: options.target, now: recordedAt }).commit !== entry.parent_commit) throw new Error("integration parent drifted before admission was recorded");
    }
    entry.state = decision.status; if (decision.status === "ADMITTED") entry.admitted_at = decision.decided_at;
    queue.decisions.push(decision); queue.revision += 1; queue.updated_at = decision.decided_at; return entry;
  }).result;
}

export function inspectIntegrationQueue(options = {}) { return readQueue(queueLocation(options)); }
