import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { hasSymlinkComponent, sameFilesystemPath } from "./paths.mjs";
import { requireTeamCapability, teamControlDigest, verifySignedTeamAction, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";
import { resolveTeamControlStoreLocation, withTeamControlStore } from "./team-control-store.mjs";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 20_000;
const MAX_QUESTIONS = 1_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const PRODUCT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PRODUCT_GITHUB_SYNC_OPERATION = "product.github.sync";
const PRODUCT_GITHUB_SYNC_CAPABILITY = "product.github.write";

export const PRODUCT_PROFILES = Object.freeze(["LEAN", "STANDARD", "HIGH_ASSURANCE"]);
export const PRODUCT_STAGES = Object.freeze([
  "IDEA", "DISCOVERY", "RESEARCHED", "EXPERIMENTING", "ALPHA_REVIEW", "ALPHA_APPROVED",
  "INVESTMENT_REVIEW", "INVESTMENT_APPROVED", "BRD_DRAFT", "BRD_APPROVED", "SPEC_DRAFT",
  "DESIGN_DRAFT", "SPEC_APPROVED", "DELIVERY_PLANNED", "ITERATING", "IMPLEMENTING",
  "VERIFIED", "RELEASE_CANDIDATE", "PRODUCTION_REVIEW", "RELEASE_DECISION", "OPERATING",
  "MONITORING", "RETIREMENT_REVIEW", "NEEDS_DECISION", "CHANGES_REQUESTED", "PAUSED",
  "REJECTED", "RETIRED"
]);

const ARTIFACT_TYPES = new Set([
  "idea", "research", "brd", "business-rules", "specification", "design", "delivery",
  "verification", "outcome", "discovery-validation", "business-viability", "trust-compliance",
  "data-lifecycle", "iteration-plan", "iteration-review", "production-readiness",
  "product-analytics", "support-readiness", "retirement", "pilot-evaluation"
]);
const APPROVAL_TYPES = new Set([
  "DISCOVERY_DECISION", "ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS",
  "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS",
  "RELEASE_DECISION", "RETIREMENT_DECISION"
]);
const APPROVAL_DECISIONS = new Set(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]);
export const PRODUCT_EVIDENCE_TRUST_LEVELS = Object.freeze([
  "SELF_DECLARED", "LOCAL_VERIFIED", "REPOSITORY_BOUND", "PROVIDER_VERIFIED", "SIGNED_ATTESTATION"
]);
const EVIDENCE_TRUST_RANK = Object.freeze(Object.fromEntries(PRODUCT_EVIDENCE_TRUST_LEVELS.map((value, index) => [value, index])));
const EVIDENCE_KINDS = new Set([
  "FILE", "GIT_COMMIT", "CI_RUN", "TEST_REPORT", "SECURITY_SCAN", "ACCESSIBILITY_REVIEW",
  "PRIVACY_LEGAL_REVIEW", "THREAT_MODEL", "DEPLOYMENT", "ENVIRONMENT", "MIGRATION",
  "RETAINED_DATA", "LOAD_TEST", "BACKUP_RESTORE", "ROLLBACK_DRILL", "OBSERVABILITY",
  "INCIDENT_DRILL", "ANALYTICS", "CUSTOMER_RESEARCH", "USABILITY_TEST", "SUPPORT",
  "DATA_DELETION", "OTHER"
]);
const EVIDENCE_STATUSES = new Set(["PASSED", "FAILED", "PARTIAL", "OBSERVED", "NOT_APPLICABLE"]);
const ENVIRONMENT_CLASSES = new Set(["LOCAL", "SYNTHETIC", "STAGING", "PILOT", "PRODUCTION"]);
const PRODUCTION_CHECK_EVIDENCE_KINDS = Object.freeze({
  ci_cd: new Set(["CI_RUN", "TEST_REPORT"]), infrastructure: new Set(["DEPLOYMENT", "ENVIRONMENT"]),
  acceptance: new Set(["TEST_REPORT"]),
  security: new Set(["SECURITY_SCAN"]), accessibility: new Set(["ACCESSIBILITY_REVIEW"]),
  privacy_legal: new Set(["PRIVACY_LEGAL_REVIEW"]),
  observability: new Set(["OBSERVABILITY"]), incident_readiness: new Set(["INCIDENT_DRILL"]),
  migration: new Set(["MIGRATION", "RETAINED_DATA"]), capacity: new Set(["LOAD_TEST"]),
  backup_restore: new Set(["BACKUP_RESTORE"]), rollback: new Set(["ROLLBACK_DRILL"])
});
const PROFESSIONAL_ARTIFACTS = Object.freeze([
  "discovery-validation", "business-viability", "trust-compliance", "data-lifecycle",
  "iteration-plan", "iteration-review", "production-readiness", "product-analytics",
  "support-readiness", "retirement"
]);
const REQUIRED_DESIGN_TRACKS = Object.freeze({
  LEAN: ["ux", "architecture", "test"],
  STANDARD: ["ux", "domain", "data", "architecture", "security", "operations", "test", "rollout"],
  HIGH_ASSURANCE: ["ux", "domain", "data", "architecture", "security", "privacy", "compliance", "capacity", "operations", "test", "rollout", "disaster_recovery"]
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function productDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function timestamp(value = new Date().toISOString()) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("timestamp must be ISO-compatible");
  return new Date(parsed).toISOString();
}

function text(value, label, maximum = 16_384) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (Buffer.byteLength(normalized) > maximum) throw new Error(`${label} exceeds ${maximum} bytes`);
  return normalized;
}

function list(value, label, { allowEmpty = false, maximum = 1_000 } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > maximum) throw new Error(`${label} must contain ${allowEmpty ? "0" : "1"}-${maximum} items`);
  return value;
}

function values(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const CREDENTIAL_FIELD = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key|client[_-]?secret)$/i;
const PRIVATE_REASONING_FIELD = /^(chain[_-]?of[_-]?thought|raw[_-]?prompt)$/i;
const SECRET_LIKE_VALUE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b)/;

function restrictedDataPath(value, current = "$") {
  if (typeof value === "string") return SECRET_LIKE_VALUE.test(value) ? current : null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = restrictedDataPath(value[index], `${current}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_REASONING_FIELD.test(key)) return `${current}.${key}`;
    if (CREDENTIAL_FIELD.test(key) && typeof item === "string" && (SECRET_LIKE_VALUE.test(item) || (/^[A-Za-z0-9_+/=-]{24,}$/.test(item) && !/^(redacted|placeholder|not[_ -]?stored|configured[_ -]?externally)$/i.test(item.trim())))) return `${current}.${key}`;
    const found = restrictedDataPath(item, `${current}.${key}`);
    if (found) return found;
  }
  return null;
}

function assertNoRestrictedData(value, label) {
  const found = restrictedDataPath(value);
  if (found) throw new Error(`${label} contains restricted secret or private-reasoning data at ${found}`);
}

function safeProductId(value) {
  const id = text(value, "product id", 64).toLowerCase();
  if (!PRODUCT_ID.test(id)) throw new Error("product id must use 2-64 lowercase letters, digits, dots, underscores, or hyphens");
  return id;
}

function safeArtifactType(value) {
  const type = text(value, "artifact type", 64).toLowerCase();
  if (!ARTIFACT_TYPES.has(type)) throw new Error(`unsupported product artifact type: ${type}`);
  return type;
}

function rootOf(value) {
  const root = path.resolve(value ?? process.cwd());
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) throw new Error("product target must be an existing directory");
  return root;
}

function relativeInside(root, requested, label) {
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the repository`);
  if (hasSymlinkComponent(root, relative)) throw new Error(`${label} cannot traverse a symbolic link`);
  return { absolute, relative: relative.split(path.sep).join("/") };
}

function location(options = {}) {
  const root = rootOf(options.target);
  const id = safeProductId(options.id);
  const product = relativeInside(root, path.join(".ai", "products", id), "product workspace");
  return {
    root, id, directory: product.absolute,
    state: path.join(product.absolute, "product.json"),
    questions: path.join(product.absolute, "questions.json"),
    events: path.join(product.absolute, "events.jsonl"),
    lock: path.join(root, ".ai", "products", ".locks", `${id}.lock`)
  };
}

function rejectUnsafeExisting(file, label, maximum = MAX_STATE_BYTES) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) throw new Error(`${label} must be a bounded non-linked regular file`);
}

function atomicJson(file, value, maximum = MAX_STATE_BYTES) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  rejectUnsafeExisting(file, "product workspace artifact", maximum);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > maximum) throw new Error("product workspace artifact exceeds its byte budget");
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* preserve original error */ }
    throw error;
  }
}

function boundedJson(root, requested, label) {
  const file = relativeInside(root, text(requested, `${label} path`, 4_096), label).absolute;
  rejectUnsafeExisting(file, label, MAX_JSON_BYTES);
  if (!fs.existsSync(file)) throw new Error(`${label} is missing`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function gitValue(root, args, label) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} is unavailable: ${String(result.stderr || result.stdout || "git failed").replace(/[\r\n]+/g, " ").slice(0, 256)}`);
  return String(result.stdout).trim();
}

function normalizedRemote(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalizePath = (candidate) => {
    const clean = candidate.replace(/^\/+/, "").replace(/\.git$/i, "");
    const segments = clean.split("/");
    if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === ".." || /[?#\\\s]/.test(segment))) return null;
    return segments.join("/");
  };
  const scp = raw.includes("://") ? null : raw.match(/^(?:[^@\s]+@)?([A-Za-z0-9.-]+):([^\s]+)$/);
  if (scp) {
    const repositoryPath = normalizePath(scp[2]);
    return repositoryPath ? `${scp[1].toLowerCase()}/${repositoryPath}` : null;
  }
  try {
    const parsed = new URL(raw);
    if (!parsed.hostname || parsed.password || parsed.search || parsed.hash) return null;
    const repositoryPath = normalizePath(parsed.pathname);
    const host = `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}`;
    return repositoryPath ? `${host}/${repositoryPath}` : null;
  } catch {
    return null;
  }
}

function currentRepository(root) {
  const top = fs.realpathSync(path.resolve(gitValue(root, ["rev-parse", "--show-toplevel"], "repository root")));
  const realRoot = fs.realpathSync(root);
  if (!sameFilesystemPath(top, realRoot)) throw new Error("product target must be the Git repository root for evidence binding");
  const commit = gitValue(root, ["rev-parse", "HEAD"], "repository commit").toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("repository commit is not a full hexadecimal revision");
  const remoteResult = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  const remote = remoteResult.status === 0 ? normalizedRemote(remoteResult.stdout) : null;
  return { commit, remote, root_hash: productDigest({ protocol: "aak-repository-root-v1", root: realRoot }) };
}

function sha256File(file, maximum = 64 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) throw new Error("evidence subject must be a bounded non-linked regular file");
  return { sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), size: stat.size };
}

function ensureProfessionalState(state) {
  state.evidence_receipts ??= {};
  state.environment_attestations ??= {};
  state.iterations ??= {};
  state.release_candidate ??= null;
  return state;
}

function evidenceId(value, label = "evidence id") {
  const id = text(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(id)) throw new Error(`${label} must use 2-128 safe identifier characters`);
  return id;
}

function evidenceTrust(value) {
  const trust = text(value, "evidence trust level", 64).toUpperCase();
  if (!(trust in EVIDENCE_TRUST_RANK)) throw new Error(`evidence trust level must be one of ${PRODUCT_EVIDENCE_TRUST_LEVELS.join(", ")}`);
  return trust;
}

function evidenceReferenceValues(value, label = "evidence receipt ids") {
  const ids = list(value ?? [], label, { allowEmpty: true, maximum: 1_000 }).map((item) => evidenceId(item, `${label} item`));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ids`);
  return ids;
}

function integrityCheckedReceipt(loc, state, id) {
  ensureProfessionalState(state);
  const summary = state.evidence_receipts[id];
  if (!summary?.path || !SHA256.test(summary.receipt_hash ?? "")) throw new Error(`evidence receipt ${id} does not exist`);
  const receipt = boundedJson(loc.root, summary.path, `evidence receipt ${id}`);
  const copy = structuredClone(receipt), claimed = copy.receipt_hash; delete copy.receipt_hash;
  if (claimed !== summary.receipt_hash || productDigest(copy) !== claimed || receipt.id !== id) throw new Error(`evidence receipt ${id} integrity verification failed`);
  return receipt;
}

function validateReceiptCurrent(loc, receipt, now, minimumTrust = "SELF_DECLARED", { requireCurrentCommit = false } = {}) {
  const reasons = [];
  const currentTime = Date.parse(now);
  if (!Number.isFinite(currentTime)) throw new Error("evidence verification timestamp is invalid");
  if (Date.parse(receipt.collected_at) > currentTime) reasons.push("COLLECTED_IN_FUTURE");
  if (receipt.expires_at && Date.parse(receipt.expires_at) <= currentTime) reasons.push("EXPIRED");
  if (EVIDENCE_TRUST_RANK[receipt.trust_level] < EVIDENCE_TRUST_RANK[minimumTrust]) reasons.push("INSUFFICIENT_TRUST");
  let repository;
  try { repository = currentRepository(loc.root); }
  catch { reasons.push("REPOSITORY_UNAVAILABLE"); }
  if (receipt.repository?.commit && repository?.commit !== receipt.repository.commit) {
    if (requireCurrentCommit) reasons.push("COMMIT_DRIFT");
    else {
      const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", receipt.repository.commit, repository?.commit ?? ""], { cwd: loc.root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
      if (ancestor.status !== 0) reasons.push("COMMIT_NOT_ANCESTOR");
    }
  }
  if (receipt.repository?.remote && repository?.remote !== receipt.repository.remote) reasons.push("REPOSITORY_MISMATCH");
  if (!receipt.repository?.remote && receipt.repository?.root_hash && repository?.root_hash !== receipt.repository.root_hash) reasons.push("REPOSITORY_ROOT_MISMATCH");
  if (receipt.subject?.path) {
    try {
      const subject = relativeInside(loc.root, receipt.subject.path, "evidence subject");
      const current = sha256File(subject.absolute);
      if (current.sha256 !== receipt.subject.sha256 || current.size !== receipt.subject.size) reasons.push("FILE_DRIFT");
    } catch { reasons.push("FILE_UNAVAILABLE_OR_UNSAFE"); }
  }
  return { status: reasons.length ? "STALE" : "VERIFIED", reasons, repository };
}

function requireEvidenceReceipts(loc, state, ids, now, { minimumTrust = "REPOSITORY_BOUND", kinds = null, environmentAttestationId = null, requireCurrentCommit = false } = {}) {
  const results = [];
  for (const id of evidenceReferenceValues(ids)) {
    const receipt = integrityCheckedReceipt(loc, state, id);
    const checked = validateReceiptCurrent(loc, receipt, now, minimumTrust, { requireCurrentCommit });
    if (checked.status !== "VERIFIED") throw new Error(`evidence receipt ${id} is stale or insufficient: ${checked.reasons.join(", ")}`);
    if (receipt.status !== "PASSED" && receipt.status !== "OBSERVED") throw new Error(`evidence receipt ${id} has non-passing status ${receipt.status}`);
    if (kinds && !kinds.has(receipt.kind)) throw new Error(`evidence receipt ${id} has kind ${receipt.kind}, expected ${[...kinds].join(" or ")}`);
    if (environmentAttestationId && receipt.environment_attestation_id !== environmentAttestationId) throw new Error(`evidence receipt ${id} is not bound to environment attestation ${environmentAttestationId}`);
    results.push({ id, kind: receipt.kind, trust_level: receipt.trust_level, receipt_hash: receipt.receipt_hash });
  }
  return results;
}

function withLock(loc, options, callback) {
  fs.mkdirSync(path.dirname(loc.lock), { recursive: true, mode: 0o700 });
  if (fs.existsSync(loc.lock) && fs.lstatSync(loc.lock).isSymbolicLink()) throw new Error("product workspace lock cannot be a symbolic link");
  const staleMs = Number(options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS);
  if (!Number.isInteger(staleMs) || staleMs < 1_000 || staleMs > 3_600_000) throw new Error("product workspace lock stale interval must be 1000-3600000 milliseconds");
  let descriptor;
  try { descriptor = fs.openSync(loc.lock, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(loc.lock);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 4_096) throw new Error("product workspace lock is unsafe");
    let activeOwner = false;
    try {
      const owner = JSON.parse(fs.readFileSync(loc.lock, "utf8"));
      if (owner.hostname === os.hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); activeOwner = true; }
        catch (ownerError) { activeOwner = ownerError.code === "EPERM"; }
      }
    } catch { /* malformed abandoned locks remain age-gated */ }
    if (activeOwner || Date.now() - stat.mtimeMs <= staleMs) throw new Error("product workspace is being updated; retry after the active transaction completes");
    const current = fs.lstatSync(loc.lock);
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error("product workspace lock changed during stale-lock recovery");
    fs.unlinkSync(loc.lock);
    descriptor = fs.openSync(loc.lock, "wx", 0o600);
  }
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString() }));
  const owned = fs.fstatSync(descriptor);
  try { return callback(); }
  finally {
    fs.closeSync(descriptor);
    try {
      const current = fs.lstatSync(loc.lock);
      if (current.dev === owned.dev && current.ino === owned.ino) fs.unlinkSync(loc.lock);
    } catch { /* a later writer performs bounded recovery */ }
  }
}

function sealState(state) {
  const copy = structuredClone(state);
  delete copy.state_hash;
  return { ...copy, state_hash: productDigest(copy) };
}

function verifyState(state, loc) {
  if (!state || state.schema_version !== 1 || state.id !== loc.id || !PRODUCT_STAGES.includes(state.stage) || !PRODUCT_PROFILES.includes(state.profile) || !state.artifact_heads || typeof state.artifact_heads !== "object" || !state.approvals || typeof state.approvals !== "object" || !state.context || !["confirmed", "assumptions", "unknowns", "changed"].every((key) => Array.isArray(state.context[key]))) throw new Error("product workspace state contract is invalid");
  for (const field of ["evidence_receipts", "environment_attestations", "iterations"]) if (state[field] !== undefined && (!state[field] || typeof state[field] !== "object" || Array.isArray(state[field]))) throw new Error(`product workspace ${field} contract is invalid`);
  const copy = structuredClone(state);
  const claimed = copy.state_hash;
  delete copy.state_hash;
  if (!claimed || claimed !== productDigest(copy)) throw new Error("product workspace state hash mismatch");
  return state;
}

function verifyStateReferences(state, loc) {
  ensureProfessionalState(state);
  for (const [type, head] of Object.entries(state.artifact_heads)) {
    if (!ARTIFACT_TYPES.has(type) || head?.type !== type || !head?.path || !SHA256.test(head?.hash ?? "")) throw new Error("product artifact reference contract is invalid");
    const artifact = readHead(loc, state, type);
    if (artifact.id !== head.id || artifact.version !== head.version) throw new Error(`${type} artifact reference integrity verification failed`);
  }
  for (const [type, summary] of Object.entries(state.approvals)) {
    if (!APPROVAL_TYPES.has(type) || !summary?.path) throw new Error("product approval reference contract is invalid");
    const record = boundedJson(loc.root, summary.path, `${type} approval`);
    const copy = structuredClone(record), claimed = copy.approval_hash; delete copy.approval_hash;
    if (!claimed || claimed !== productDigest(copy) || claimed !== summary.approval_hash || record.id !== summary.id || record.artifact_type !== type || record.artifact_hash !== summary.artifact_hash || record.decision !== summary.decision || record.approver !== summary.approver) throw new Error(`${type} approval integrity verification failed`);
  }
  if (state.convergence) {
    const report = boundedJson(loc.root, state.convergence.path, "product convergence report");
    const copy = structuredClone(report), claimed = copy.convergence_hash; delete copy.convergence_hash;
    if (!claimed || claimed !== productDigest(copy) || claimed !== state.convergence.hash || report.status !== state.convergence.status || (state.convergence.implementation_commit && report.implementation_commit !== state.convergence.implementation_commit)) throw new Error("product convergence report integrity verification failed");
  }
  if (state.github_plan) readGitHubPlan(loc, state);
  for (const id of Object.keys(state.evidence_receipts)) integrityCheckedReceipt(loc, state, id);
  for (const [id, summary] of Object.entries(state.environment_attestations)) {
    if (!summary?.path || !SHA256.test(summary.attestation_hash ?? "")) throw new Error("environment attestation reference contract is invalid");
    const attestation = boundedJson(loc.root, summary.path, `environment attestation ${id}`);
    const copy = structuredClone(attestation), claimed = copy.attestation_hash; delete copy.attestation_hash;
    if (claimed !== summary.attestation_hash || productDigest(copy) !== claimed || attestation.id !== id) throw new Error(`environment attestation ${id} integrity verification failed`);
  }
  if (state.release_candidate) {
    const candidate = boundedJson(loc.root, state.release_candidate.path, "release candidate dossier");
    const copy = structuredClone(candidate), claimed = copy.candidate_hash; delete copy.candidate_hash;
    if (claimed !== state.release_candidate.hash || productDigest(copy) !== claimed) throw new Error("release candidate dossier integrity verification failed");
  }
  return state;
}

function readState(loc) {
  rejectUnsafeExisting(loc.state, "product workspace state");
  if (!fs.existsSync(loc.state)) throw new Error(`product workspace ${loc.id} does not exist`);
  try { return verifyStateReferences(verifyState(JSON.parse(fs.readFileSync(loc.state, "utf8")), loc), loc); }
  catch (error) { if (error instanceof SyntaxError) throw new Error("product workspace state is not valid JSON"); throw error; }
}

function writeState(loc, state, now) {
  state.revision += 1;
  state.updated_at = now;
  const sealed = sealState(state);
  atomicJson(loc.state, sealed);
  return sealed;
}

function readEvents(loc) {
  if (!fs.existsSync(loc.events)) return [];
  rejectUnsafeExisting(loc.events, "product event ledger", 16 * 1024 * 1024);
  const lines = fs.readFileSync(loc.events, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length > MAX_EVENTS) throw new Error("product event ledger exceeds its record budget");
  let previous = null;
  return lines.map((line, index) => {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error("product event ledger contains invalid JSON"); }
    const copy = structuredClone(record); const claimed = copy.event_hash; delete copy.event_hash;
    if (record.offset !== index + 1 || record.previous_hash !== previous || !claimed || productDigest(copy) !== claimed) throw new Error("product event ledger integrity verification failed");
    previous = claimed;
    return record;
  });
}

function appendEvent(loc, type, data, now) {
  const records = readEvents(loc);
  if (records.length >= MAX_EVENTS) throw new Error("product event ledger record budget is exhausted");
  const base = { schema_version: 1, offset: records.length + 1, timestamp: now, type, data, previous_hash: records.at(-1)?.event_hash ?? null };
  const record = { ...base, event_hash: productDigest(base) };
  fs.mkdirSync(path.dirname(loc.events), { recursive: true, mode: 0o700 });
  fs.appendFileSync(loc.events, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

function sealQuestions(questions) {
  const copy = structuredClone(questions); delete copy.questions_hash;
  return { ...copy, questions_hash: productDigest(copy) };
}

function readQuestions(loc) {
  rejectUnsafeExisting(loc.questions, "product question ledger");
  if (!fs.existsSync(loc.questions)) throw new Error("product question ledger is missing");
  let questions;
  try { questions = JSON.parse(fs.readFileSync(loc.questions, "utf8")); }
  catch (error) { throw new Error(`product question ledger is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const copy = structuredClone(questions); const claimed = copy.questions_hash; delete copy.questions_hash;
  if (questions.schema_version !== 1 || questions.product_id !== loc.id || !Array.isArray(questions.items) || questions.items.length > MAX_QUESTIONS || claimed !== productDigest(copy)) throw new Error("product question ledger integrity verification failed");
  return questions;
}

function writeQuestions(loc, questions, now) {
  questions.revision += 1;
  questions.updated_at = now;
  const sealed = sealQuestions(questions);
  atomicJson(loc.questions, sealed);
  return sealed;
}

function questionRound(questions) {
  return questions.items.filter((item) => ["OPEN", "ACTIVE"].includes(item.status)).sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at)).slice(0, 3);
}

function normalizeQuestion(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function artifactHead(state, type) { return state.artifact_heads[type] ?? null; }

function readHead(loc, state, type) {
  const head = artifactHead(state, type);
  if (!head) return null;
  const artifact = boundedJson(loc.root, head.path, `${type} artifact`);
  const copy = structuredClone(artifact); const claimed = copy.content_hash; delete copy.content_hash;
  if (claimed !== head.hash || productDigest(copy) !== claimed) throw new Error(`${type} artifact hash mismatch`);
  return artifact;
}

function uniqueIds(items, field, findings, code) {
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id.trim()) findings.push({ severity: "BLOCKER", code, message: `${field} contains an item without an id` });
    else if (seen.has(item.id)) findings.push({ severity: "BLOCKER", code, message: `${field} contains duplicate id ${item.id}` });
    else seen.add(item.id);
  }
  return seen;
}

function requireStringFields(item, fields, blocker, code, label) {
  for (const field of fields) if (typeof item?.[field] !== "string" || !item[field].trim()) blocker(code, `${label} requires ${field}`);
}

function requireArrayFields(item, fields, blocker, code, label, { nonEmpty = false } = {}) {
  for (const field of fields) if (!Array.isArray(item?.[field]) || (nonEmpty && !item[field].length)) blocker(code, `${label} requires ${field}${nonEmpty ? " with at least one item" : ""}`);
}

function standaloneFindings(type, artifact) {
  const findings = [];
  const blocker = (code, message) => findings.push({ severity: "BLOCKER", code, message });
  const lifecycle = new Set(["DRAFT", "READY_FOR_APPROVAL", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "SUPERSEDED"]);
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || artifact.schema_version !== 1) return [{ severity: "BLOCKER", code: "ARTIFACT_CONTRACT", message: `${type} must be a schema_version 1 object` }];
  if (typeof artifact.id !== "string" || !artifact.id.trim()) blocker("ARTIFACT_ID", `${type} requires an id`);
  if (!Number.isInteger(artifact.version) || artifact.version < 1) blocker("ARTIFACT_VERSION", `${type} requires a positive integer version`);
  if (!["idea", "research"].includes(type) && !lifecycle.has(artifact.status)) blocker("ARTIFACT_STATUS", `${type} requires a supported lifecycle status`);
  if (type === "idea") {
    if (!new Set(["IDEA", "DISCOVERY", "SUPERSEDED"]).has(artifact.status)) blocker("IDEA_STATUS", "idea requires IDEA, DISCOVERY, or SUPERSEDED status");
    requireStringFields(artifact, ["created_at", "created_by"], blocker, "IDEA_FIELDS", "idea");
    if (!artifact.raw_idea?.trim()) blocker("IDEA_RAW", "idea requires the user's raw idea");
    for (const field of ["people", "desired_outcomes", "constraints", "assumptions", "unknowns", "parent_versions"]) if (!Array.isArray(artifact[field])) blocker("IDEA_KNOWLEDGE", `idea requires ${field}`);
    if (typeof artifact.problem !== "string") blocker("IDEA_PROBLEM", "idea requires a problem string, even when not known yet");
  }
  if (type === "research") {
    requireStringFields(artifact, ["idea_version"], blocker, "RESEARCH_FIELDS", "research");
    if (!Array.isArray(artifact.questions) || !artifact.questions.length) blocker("RESEARCH_QUESTIONS", "research requires bounded questions");
    if (!Array.isArray(artifact.evidence)) blocker("RESEARCH_EVIDENCE", "research requires an evidence ledger");
    if (!Array.isArray(artifact.findings) || !Array.isArray(artifact.limitations)) blocker("RESEARCH_FIELDS", "research requires findings and limitations arrays");
    if (!new Set(["PROCEED", "PIVOT", "PAUSE", "STOP"]).has(artifact.decision?.recommendation)) blocker("RESEARCH_DECISION", "research requires PROCEED, PIVOT, PAUSE, or STOP");
    uniqueIds(artifact.questions ?? [], "research questions", findings, "RESEARCH_QUESTION_ID");
    for (const item of artifact.questions ?? []) requireStringFields(item, ["id", "question", "decision_criterion"], blocker, "RESEARCH_QUESTION_FIELDS", `research question ${item?.id ?? "unknown"}`);
    if (Array.isArray(artifact.evidence)) {
      uniqueIds(artifact.evidence, "research evidence", findings, "RESEARCH_EVIDENCE_ID");
      for (const item of artifact.evidence) {
        requireStringFields(item, ["id", "kind", "source", "retrieved_at", "claim", "confidence"], blocker, "RESEARCH_EVIDENCE_FIELDS", `research evidence ${item?.id ?? "unknown"}`);
        requireArrayFields(item, ["limitations"], blocker, "RESEARCH_EVIDENCE_FIELDS", `research evidence ${item?.id ?? "unknown"}`);
      }
    }
    uniqueIds(artifact.findings ?? [], "research findings", findings, "RESEARCH_FINDING_ID");
    for (const item of artifact.findings ?? []) { requireStringFields(item, ["id", "statement"], blocker, "RESEARCH_FINDING_FIELDS", `research finding ${item?.id ?? "unknown"}`); requireArrayFields(item, ["evidence_ids"], blocker, "RESEARCH_FINDING_FIELDS", `research finding ${item?.id ?? "unknown"}`); }
    requireStringFields(artifact.decision, ["rationale"], blocker, "RESEARCH_DECISION", "research decision");
  }
  if (type === "brd") {
    requireStringFields(artifact, ["problem"], blocker, "BRD_FIELDS", "BRD");
    for (const field of ["source_versions", "stakeholders", "risks", "decisions"]) if (!Array.isArray(artifact[field])) blocker("BRD_FIELDS", `BRD requires ${field}`);
    for (const stakeholder of artifact.stakeholders ?? []) { requireStringFields(stakeholder, ["role"], blocker, "BRD_STAKEHOLDER_FIELDS", "BRD stakeholder"); requireArrayFields(stakeholder, ["decision_rights"], blocker, "BRD_STAKEHOLDER_FIELDS", "BRD stakeholder"); }
    if (!Array.isArray(artifact.goals) || !artifact.goals.length) blocker("BRD_GOALS", "BRD requires measurable goals");
    if (!Array.isArray(artifact.scope) || !artifact.scope.length || !Array.isArray(artifact.non_goals)) blocker("BRD_SCOPE", "BRD requires scope and non-goals");
    if (!Array.isArray(artifact.requirements) || !artifact.requirements.length) blocker("BRD_REQUIREMENTS", "BRD requires business requirements");
    else {
      uniqueIds(artifact.requirements, "BRD requirements", findings, "BRD_REQUIREMENT_ID");
      for (const item of artifact.requirements) {
        requireStringFields(item, ["id", "statement", "rationale", "priority", "status", "acceptance_method", "owner"], blocker, "BRD_REQUIREMENT_FIELDS", `business requirement ${item?.id ?? "unknown"}`);
        requireArrayFields(item, ["source_ids"], blocker, "BRD_REQUIREMENT_FIELDS", `business requirement ${item?.id ?? "unknown"}`, { nonEmpty: true });
        if (!new Set(["MUST", "SHOULD", "COULD", "WONT_NOW"]).has(item?.priority)) blocker("BRD_REQUIREMENT_PRIORITY", `business requirement ${item?.id ?? "unknown"} has invalid priority`);
      }
    }
    for (const goal of artifact.goals ?? []) requireStringFields(goal, ["id", "outcome", "metric", "window", "owner"], blocker, "BRD_GOAL_FIELDS", `business goal ${goal?.id ?? "unknown"}`);
  }
  if (type === "business-rules") {
    if (!Array.isArray(artifact.source_versions) || !artifact.source_versions.length) blocker("BUSINESS_RULE_SOURCES", "business-rule catalog requires source versions");
    if (!Array.isArray(artifact.rules) || !artifact.rules.length) blocker("BUSINESS_RULES", "business-rule catalog requires rules");
    else {
      uniqueIds(artifact.rules, "business rules", findings, "BUSINESS_RULE_ID");
      for (const rule of artifact.rules) {
        requireStringFields(rule, ["id", "name", "condition", "outcome", "owner"], blocker, "BUSINESS_RULE_FIELDS", `business rule ${rule?.id ?? "unknown"}`);
        requireArrayFields(rule, ["source_requirement_ids", "examples", "exceptions"], blocker, "BUSINESS_RULE_FIELDS", `business rule ${rule?.id ?? "unknown"}`);
      }
    }
  }
  if (type === "specification") {
    if (!artifact.approved_brd?.hash || !SHA256.test(artifact.approved_brd.hash)) blocker("SPEC_BRD", "specification requires an approved BRD hash");
    for (const field of ["journeys", "functional_requirements", "acceptance_criteria", "traceability"]) if (!Array.isArray(artifact[field]) || !artifact[field].length) blocker("SPEC_SECTION", `specification requires ${field}`);
    for (const field of ["non_functional_requirements", "data_and_integrations"]) if (!Array.isArray(artifact[field])) blocker("SPEC_SECTION", `specification requires ${field}`);
    if (Array.isArray(artifact.functional_requirements)) uniqueIds(artifact.functional_requirements, "functional requirements", findings, "SPEC_REQUIREMENT_ID");
    if (Array.isArray(artifact.non_functional_requirements)) uniqueIds(artifact.non_functional_requirements, "non-functional requirements", findings, "SPEC_REQUIREMENT_ID");
    if (Array.isArray(artifact.acceptance_criteria)) uniqueIds(artifact.acceptance_criteria, "acceptance criteria", findings, "ACCEPTANCE_ID");
    for (const journey of artifact.journeys ?? []) {
      requireStringFields(journey, ["id", "actor", "trigger", "outcome"], blocker, "JOURNEY_FIELDS", `journey ${journey?.id ?? "unknown"}`);
      requireArrayFields(journey, ["happy_path", "bad_paths", "requirement_ids"], blocker, "JOURNEY_FIELDS", `journey ${journey?.id ?? "unknown"}`);
    }
    for (const item of [...(artifact.functional_requirements ?? []), ...(artifact.non_functional_requirements ?? [])]) {
      requireStringFields(item, ["id", "statement"], blocker, "SPEC_ITEM_FIELDS", `specification item ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["source_requirement_ids", "verification_ids"], blocker, "SPEC_ITEM_FIELDS", `specification item ${item?.id ?? "unknown"}`, { nonEmpty: true });
    }
    for (const item of artifact.acceptance_criteria ?? []) {
      requireStringFields(item, ["id", "given", "when", "then"], blocker, "ACCEPTANCE_FIELDS", `acceptance criterion ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["verifies"], blocker, "ACCEPTANCE_FIELDS", `acceptance criterion ${item?.id ?? "unknown"}`, { nonEmpty: true });
    }
    for (const item of artifact.traceability ?? []) { requireStringFields(item, ["source_id"], blocker, "TRACE_FIELDS", "specification trace"); requireArrayFields(item, ["target_ids"], blocker, "TRACE_FIELDS", "specification trace", { nonEmpty: true }); }
    for (const item of artifact.data_and_integrations ?? []) { requireStringFields(item, ["id", "kind", "data", "owner", "failure_behavior"], blocker, "INTEGRATION_FIELDS", `integration ${item?.id ?? "unknown"}`); requireArrayFields(item, ["requirement_ids"], blocker, "INTEGRATION_FIELDS", `integration ${item?.id ?? "unknown"}`); }
    requireArrayFields(artifact.operations, ["service_levels", "observability", "support", "backup_restore", "rollback"], blocker, "OPERATIONS_FIELDS", "specification operations");
  }
  if (type === "design") {
    if (!SHA256.test(artifact.approved_brd?.hash ?? "") || !SHA256.test(artifact.specification?.hash ?? "")) blocker("DESIGN_BASELINES", "design bundle requires BRD and specification SHA-256 hashes");
    if (!Array.isArray(artifact.decisions) || !Array.isArray(artifact.risks)) blocker("DESIGN_FIELDS", "design bundle requires decisions and risks arrays");
    if (!PRODUCT_PROFILES.includes(artifact.risk_profile)) blocker("DESIGN_PROFILE", "design bundle requires a supported risk profile");
    if (!Array.isArray(artifact.tracks) || !artifact.tracks.length) blocker("DESIGN_TRACKS", "design bundle requires design tracks");
    else {
      uniqueIds(artifact.tracks, "design tracks", findings, "DESIGN_TRACK_ID");
      for (const track of artifact.tracks) {
        requireStringFields(track, ["id", "status", "summary", "rationale"], blocker, "DESIGN_TRACK_FIELDS", `design track ${track?.id ?? "unknown"}`);
        requireArrayFields(track, ["artifacts", "requirement_ids", "risks"], blocker, "DESIGN_TRACK_FIELDS", `design track ${track?.id ?? "unknown"}`);
      }
    }
  }
  if (type === "delivery") {
    requireStringFields(artifact, ["mvp_outcome"], blocker, "DELIVERY_FIELDS", "delivery");
    if (!Array.isArray(artifact.milestones)) blocker("DELIVERY_FIELDS", "delivery requires milestones");
    if (!Array.isArray(artifact.approved_baselines) || artifact.approved_baselines.length < 2) blocker("DELIVERY_BASELINES", "delivery requires approved baselines");
    if (!Array.isArray(artifact.items) || !artifact.items.length) blocker("DELIVERY_ITEMS", "delivery requires backlog items");
    else {
      if (artifact.items.length > 500) blocker("DELIVERY_ITEM_BUDGET", "delivery contains more than 500 items");
      uniqueIds(artifact.items, "delivery items", findings, "DELIVERY_ITEM_ID");
      for (const item of artifact.items) {
        requireStringFields(item, ["id", "type", "title", "outcome", "risk"], blocker, "DELIVERY_ITEM_FIELDS", `delivery item ${item?.id ?? "unknown"}`);
        requireArrayFields(item, ["requirement_ids", "acceptance_ids", "dependencies", "assurance"], blocker, "DELIVERY_ITEM_FIELDS", `delivery item ${item?.id ?? "unknown"}`);
        if (!Number.isFinite(item?.estimate?.low) || !Number.isFinite(item?.estimate?.high) || typeof item?.estimate?.unit !== "string" || !new Set(["LOW", "MEDIUM", "HIGH"]).has(item?.estimate?.confidence)) blocker("DELIVERY_ESTIMATE_FIELDS", `delivery item ${item?.id ?? "unknown"} has an invalid estimate`);
      }
    }
    for (const milestone of artifact.milestones ?? []) requireStringFields(milestone, ["id", "outcome"], blocker, "DELIVERY_MILESTONE_FIELDS", `delivery milestone ${milestone?.id ?? "unknown"}`);
    for (const baseline of artifact.approved_baselines ?? []) if (!baseline?.id || !SHA256.test(baseline?.hash ?? "")) blocker("DELIVERY_BASELINE_FIELDS", "delivery approved baseline requires id and SHA-256 hash");
    if (!Array.isArray(artifact.definition_of_ready) || !artifact.definition_of_ready.length || !Array.isArray(artifact.definition_of_done) || !artifact.definition_of_done.length) blocker("DELIVERY_DEFINITIONS", "delivery requires Definition of Ready and Definition of Done");
  }
  if (type === "verification") {
    if (!artifact.approved_delivery?.hash || !SHA256.test(artifact.approved_delivery.hash)) blocker("VERIFICATION_DELIVERY", "verification requires the approved delivery hash");
    if (!new Set(["LOCAL", "SYNTHETIC", "STAGING", "PILOT", "PRODUCTION"]).has(artifact.environment)) blocker("VERIFICATION_ENVIRONMENT", "verification requires a classified environment");
    for (const field of ["acceptance_status", "security_status"]) if (artifact[field] !== "PASSED") blocker("VERIFICATION_STATUS", `${field} must be PASSED`);
    for (const field of ["operational_status", "rollback_status"]) if (artifact[field] !== "READY") blocker("VERIFICATION_STATUS", `${field} must be READY`);
    if (!Array.isArray(artifact.evidence) || !artifact.evidence.length) blocker("EVIDENCE_REQUIRED", "verification requires evidence");
    uniqueIds(artifact.evidence ?? [], "verification evidence", findings, "VERIFICATION_EVIDENCE_ID");
    for (const item of artifact.evidence ?? []) requireStringFields(item, ["id", "kind", "environment", "status", "ref", "collected_at"], blocker, "VERIFICATION_EVIDENCE_FIELDS", `verification evidence ${item?.id ?? "unknown"}`);
  }
  if (type === "outcome") {
    if (!Array.isArray(artifact.evidence) || !artifact.evidence.length || !Array.isArray(artifact.metrics)) blocker("OUTCOME_EVIDENCE", "outcome requires evidence and metrics");
    if (!new Set(["RELEASE", "LIMITED_RELEASE", "HOLD", "ROLLBACK", "ITERATE", "RETIRE"]).has(artifact.recommendation)) blocker("OUTCOME_RECOMMENDATION", "outcome recommendation is invalid");
    requireStringFields(artifact, ["environment", "recommendation", "rationale"], blocker, "OUTCOME_FIELDS", "product outcome");
    uniqueIds(artifact.metrics ?? [], "outcome metrics", findings, "OUTCOME_METRIC_ID");
    for (const metric of artifact.metrics ?? []) {
      requireStringFields(metric, ["id", "window", "source"], blocker, "OUTCOME_METRIC_FIELDS", `outcome metric ${metric?.id ?? "unknown"}`);
      if (!("target" in (metric ?? {})) || !("actual" in (metric ?? {}))) blocker("OUTCOME_METRIC_FIELDS", `outcome metric ${metric?.id ?? "unknown"} requires target and actual`);
    }
  }
  if (type === "discovery-validation") {
    requireArrayFields(artifact, ["source_versions", "hypotheses", "experiments", "prototypes", "usability_tests", "customer_evidence"], blocker, "DISCOVERY_VALIDATION_FIELDS", "discovery validation");
    if (!(artifact.hypotheses?.length > 0)) blocker("HYPOTHESES_MISSING", "discovery validation requires hypotheses");
    if (!(artifact.experiments?.length > 0)) blocker("EXPERIMENTS_MISSING", "discovery validation requires at least one experiment");
    uniqueIds(artifact.hypotheses ?? [], "hypotheses", findings, "HYPOTHESIS_ID");
    for (const item of artifact.hypotheses ?? []) {
      requireStringFields(item, ["id", "statement", "risk", "success_criterion", "status"], blocker, "HYPOTHESIS_FIELDS", `hypothesis ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["evidence_receipt_ids"], blocker, "HYPOTHESIS_FIELDS", `hypothesis ${item?.id ?? "unknown"}`);
    }
    uniqueIds(artifact.experiments ?? [], "experiments", findings, "EXPERIMENT_ID");
    for (const item of artifact.experiments ?? []) {
      requireStringFields(item, ["id", "hypothesis_id", "method", "success_criterion", "result", "decision"], blocker, "EXPERIMENT_FIELDS", `experiment ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["evidence_receipt_ids"], blocker, "EXPERIMENT_FIELDS", `experiment ${item?.id ?? "unknown"}`, { nonEmpty: true });
    }
    for (const item of [...(artifact.prototypes ?? []), ...(artifact.usability_tests ?? []), ...(artifact.customer_evidence ?? [])]) {
      requireStringFields(item, ["id", "summary"], blocker, "DISCOVERY_EVIDENCE_FIELDS", `discovery evidence ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["evidence_receipt_ids"], blocker, "DISCOVERY_EVIDENCE_FIELDS", `discovery evidence ${item?.id ?? "unknown"}`, { nonEmpty: true });
    }
    if (!new Set(["CONTINUE", "PIVOT", "STOP"]).has(artifact.decision?.recommendation)) blocker("ALPHA_DECISION", "discovery validation requires CONTINUE, PIVOT, or STOP");
    requireStringFields(artifact.decision, ["rationale"], blocker, "ALPHA_DECISION", "alpha decision");
    requireArrayFields(artifact.decision, ["evidence_receipt_ids"], blocker, "ALPHA_DECISION", "alpha decision", { nonEmpty: true });
  }
  if (type === "business-viability") {
    requireArrayFields(artifact, ["source_versions", "assumptions", "pricing_options", "go_to_market", "risks"], blocker, "VIABILITY_FIELDS", "business viability");
    if (!(artifact.assumptions?.length > 0)) blocker("VIABILITY_ASSUMPTIONS", "business viability requires testable assumptions");
    if (!artifact.unit_economics || typeof artifact.unit_economics !== "object") blocker("UNIT_ECONOMICS", "business viability requires unit economics");
    else {
      requireStringFields(artifact.unit_economics, ["currency", "unit", "model", "confidence"], blocker, "UNIT_ECONOMICS", "unit economics");
      requireArrayFields(artifact.unit_economics, ["evidence_receipt_ids"], blocker, "UNIT_ECONOMICS", "unit economics");
    }
    if (!(artifact.pricing_options?.length > 0)) blocker("PRICING_OPTIONS", "business viability requires pricing options");
    if (!(artifact.go_to_market?.length > 0)) blocker("GO_TO_MARKET", "business viability requires a go-to-market approach");
    if (!new Set(["INVEST", "REVISE", "HOLD", "STOP"]).has(artifact.decision?.recommendation)) blocker("INVESTMENT_DECISION", "business viability requires INVEST, REVISE, HOLD, or STOP");
    requireStringFields(artifact.decision, ["rationale"], blocker, "INVESTMENT_DECISION", "investment decision");
  }
  if (type === "trust-compliance") {
    requireArrayFields(artifact, ["markets", "privacy_legal", "security_findings"], blocker, "TRUST_FIELDS", "trust and compliance");
    if (!(artifact.markets?.length > 0)) blocker("MARKETS_MISSING", "trust and compliance requires target markets");
    for (const field of ["accessibility", "threat_model"]) {
      const control = artifact[field];
      if (!control || typeof control !== "object" || !new Set(["READY", "OPEN", "NOT_APPLICABLE"]).has(control.status)) blocker("TRUST_CONTROL", `${field} requires READY, OPEN, or NOT_APPLICABLE status`);
      else {
        requireArrayFields(control, ["evidence_receipt_ids"], blocker, "TRUST_CONTROL", field);
        if (control.status === "NOT_APPLICABLE" && !control.rationale?.trim()) blocker("TRUST_NA_RATIONALE", `${field} NOT_APPLICABLE requires rationale`);
      }
    }
    for (const review of artifact.privacy_legal ?? []) {
      requireStringFields(review, ["market", "status", "owner", "rationale"], blocker, "PRIVACY_LEGAL_FIELDS", `privacy/legal review ${review?.market ?? "unknown"}`);
      requireArrayFields(review, ["evidence_receipt_ids", "requirements"], blocker, "PRIVACY_LEGAL_FIELDS", `privacy/legal review ${review?.market ?? "unknown"}`);
    }
    for (const finding of artifact.security_findings ?? []) {
      requireStringFields(finding, ["id", "severity", "status", "rationale"], blocker, "SECURITY_FINDING_FIELDS", `security finding ${finding?.id ?? "unknown"}`);
      requireArrayFields(finding, ["evidence_receipt_ids"], blocker, "SECURITY_FINDING_FIELDS", `security finding ${finding?.id ?? "unknown"}`);
    }
  }
  if (type === "data-lifecycle") {
    requireArrayFields(artifact, ["data_classes", "retention_rules", "migrations", "retained_data_validations", "deletion_workflows"], blocker, "DATA_LIFECYCLE_FIELDS", "data lifecycle");
    for (const field of ["data_classes", "retention_rules"]) if (!(artifact[field]?.length > 0)) blocker("DATA_LIFECYCLE_REQUIRED", `data lifecycle requires ${field}`);
    for (const migration of artifact.migrations ?? []) {
      requireStringFields(migration, ["id", "strategy", "rollback", "status"], blocker, "MIGRATION_FIELDS", `migration ${migration?.id ?? "unknown"}`);
      requireArrayFields(migration, ["evidence_receipt_ids"], blocker, "MIGRATION_FIELDS", `migration ${migration?.id ?? "unknown"}`);
    }
    for (const workflow of artifact.deletion_workflows ?? []) {
      requireStringFields(workflow, ["id", "trigger", "owner", "verification"], blocker, "DELETION_FIELDS", `deletion workflow ${workflow?.id ?? "unknown"}`);
      requireArrayFields(workflow, ["evidence_receipt_ids"], blocker, "DELETION_FIELDS", `deletion workflow ${workflow?.id ?? "unknown"}`);
    }
  }
  if (type === "iteration-plan") {
    requireStringFields(artifact, ["iteration_id", "goal", "starts_at", "ends_at"], blocker, "ITERATION_PLAN_FIELDS", "iteration plan");
    requireArrayFields(artifact, ["baseline_hashes", "item_ids", "definition_of_done"], blocker, "ITERATION_PLAN_FIELDS", "iteration plan", { nonEmpty: true });
    if (!Number.isFinite(artifact.capacity?.available) || !Number.isFinite(artifact.capacity?.committed) || artifact.capacity.committed > artifact.capacity.available || artifact.capacity.available <= 0) blocker("ITERATION_CAPACITY", "iteration capacity must be positive and committed cannot exceed available");
    requireStringFields(artifact.capacity, ["unit"], blocker, "ITERATION_CAPACITY", "iteration capacity");
  }
  if (type === "iteration-review") {
    requireStringFields(artifact, ["iteration_id", "goal_status", "review", "retrospective", "completed_at"], blocker, "ITERATION_REVIEW_FIELDS", "iteration review");
    requireArrayFields(artifact, ["progress", "acceptance", "changes", "evidence_receipt_ids"], blocker, "ITERATION_REVIEW_FIELDS", "iteration review");
    for (const item of artifact.acceptance ?? []) {
      requireStringFields(item, ["id", "status"], blocker, "ITERATION_ACCEPTANCE_FIELDS", `iteration acceptance ${item?.id ?? "unknown"}`);
      requireArrayFields(item, ["evidence_receipt_ids"], blocker, "ITERATION_ACCEPTANCE_FIELDS", `iteration acceptance ${item?.id ?? "unknown"}`);
    }
  }
  if (type === "production-readiness") {
    requireStringFields(artifact, ["environment_attestation_id", "release_scope", "decision"], blocker, "PRODUCTION_READINESS_FIELDS", "production readiness");
    if (!artifact.checks || typeof artifact.checks !== "object" || Array.isArray(artifact.checks)) blocker("PRODUCTION_CHECKS", "production readiness requires checks");
    for (const name of ["ci_cd", "acceptance", "infrastructure", "security", "accessibility", "privacy_legal", "observability", "incident_readiness", "migration", "capacity", "backup_restore", "rollback"]) {
      const check = artifact.checks?.[name];
      if (!check || !new Set(["READY", "BLOCKED", "NOT_APPLICABLE"]).has(check.status)) blocker("PRODUCTION_CHECK", `production check ${name} requires READY, BLOCKED, or NOT_APPLICABLE`);
      else {
        requireArrayFields(check, ["evidence_receipt_ids"], blocker, "PRODUCTION_CHECK", `production check ${name}`);
        if (check.status === "READY" && !check.evidence_receipt_ids.length) blocker("PRODUCTION_EVIDENCE", `production check ${name} requires evidence`);
        if (check.status === "NOT_APPLICABLE" && !check.rationale?.trim()) blocker("PRODUCTION_NA_RATIONALE", `production check ${name} NOT_APPLICABLE requires rationale`);
      }
    }
  }
  if (type === "product-analytics") {
    requireStringFields(artifact, ["environment_attestation_id", "measurement_window"], blocker, "ANALYTICS_FIELDS", "product analytics");
    requireArrayFields(artifact, ["instrumentation", "metrics", "evidence_receipt_ids"], blocker, "ANALYTICS_FIELDS", "product analytics");
    if (!(artifact.instrumentation?.length > 0) || !(artifact.metrics?.length > 0)) blocker("ANALYTICS_REQUIRED", "product analytics requires instrumentation and metrics");
    for (const metric of artifact.metrics ?? []) requireStringFields(metric, ["id", "definition", "source", "owner", "status"], blocker, "ANALYTICS_METRIC_FIELDS", `analytics metric ${metric?.id ?? "unknown"}`);
  }
  if (type === "support-readiness") {
    requireArrayFields(artifact, ["channels", "escalations", "evidence_receipt_ids"], blocker, "SUPPORT_FIELDS", "support readiness");
    requireStringFields(artifact, ["owner", "runbook", "service_window", "customer_success_workflow"], blocker, "SUPPORT_FIELDS", "support readiness");
    if (!(artifact.channels?.length > 0) || !(artifact.escalations?.length > 0)) blocker("SUPPORT_REQUIRED", "support readiness requires channels and escalations");
  }
  if (type === "retirement") {
    requireStringFields(artifact, ["trigger", "owner", "customer_communication", "dependency_shutdown", "rollback", "decision"], blocker, "RETIREMENT_FIELDS", "retirement plan");
    requireArrayFields(artifact, ["data_deletion", "evidence_receipt_ids"], blocker, "RETIREMENT_FIELDS", "retirement plan");
    if (!new Set(["PLAN", "RETIRE", "HOLD"]).has(artifact.decision)) blocker("RETIREMENT_DECISION", "retirement decision must be PLAN, RETIRE, or HOLD");
  }
  if (type === "pilot-evaluation") {
    requireStringFields(artifact, ["pilot_id", "cohort", "window", "recommendation", "rationale"], blocker, "PILOT_FIELDS", "pilot evaluation");
    requireArrayFields(artifact, ["tasks", "metrics", "evidence_receipt_ids", "limitations"], blocker, "PILOT_FIELDS", "pilot evaluation");
    if (!new Set(["CONTINUE", "PIVOT", "STOP", "INCONCLUSIVE"]).has(artifact.recommendation)) blocker("PILOT_RECOMMENDATION", "pilot recommendation is invalid");
  }
  return findings;
}

export function validateProductArtifact(typeValue, artifact) {
  const type = safeArtifactType(typeValue);
  assertNoRestrictedData(artifact, `${type} artifact`);
  const findings = standaloneFindings(type, artifact);
  return { schema_version: 1, type, status: findings.some((item) => item.severity === "BLOCKER") ? "INVALID" : "VALID", findings };
}

function artifactReference(type, artifact, relative) {
  return { type, id: artifact.id, version: artifact.version, hash: artifact.content_hash, status: artifact.status ?? null, path: relative };
}

function approved(state, type, targetHash = null) {
  const record = state.approvals[type];
  return Boolean(record && record.decision === "APPROVED" && record.status === "CURRENT" && (!targetHash || record.artifact_hash === targetHash));
}

function solutionMembers(state) {
  return ["brd", "business-rules", "specification", "design"].map((type) => artifactHead(state, type)).filter(Boolean).map(({ type, id, version, hash }) => ({ type, id, version, hash }));
}

function businessRequirementsMembers(state) {
  return [artifactHead(state, "brd"), artifactHead(state, "business-rules")].filter(Boolean).map(({ type, id, version, hash }) => ({ type, id, version, hash }));
}

function businessRequirementsHash(state) {
  const members = businessRequirementsMembers(state);
  return members.length ? productDigest({ protocol: "aak-product-business-requirements-baseline-v1", members }) : null;
}

function approvedBusinessRequirements(state) {
  return approved(state, "BUSINESS_REQUIREMENTS", businessRequirementsHash(state));
}

function staleApprovals(state, types) {
  for (const type of types) if (state.approvals[type]) state.approvals[type].status = "STALE";
}

function invalidateApprovalsForDiscoveryChange(state) {
  const invalidatesDecision = Object.values(state.approvals).some((item) => item?.decision === "APPROVED" && item?.status === "CURRENT");
  staleApprovals(state, APPROVAL_TYPES);
  if (invalidatesDecision) state.stage = "NEEDS_DECISION";
}

function solutionHash(state) {
  const members = solutionMembers(state);
  return members.length ? productDigest({ protocol: "aak-product-solution-baseline-v1", members }) : null;
}

function discoveryHash(state, questions) {
  const members = [artifactHead(state, "idea"), artifactHead(state, "research")].filter(Boolean).map(({ type, id, version, hash }) => ({ type, id, version, hash }));
  return productDigest({ protocol: "aak-product-discovery-baseline-v1", members, questions_hash: questions.questions_hash, context_hash: productDigest(state.context) });
}

function baselineBundleHash(protocol, state, types) {
  const members = types.map((type) => artifactHead(state, type)).filter(Boolean).map(({ type, id, version, hash }) => ({ type, id, version, hash }));
  return members.length === types.length ? productDigest({ protocol, members }) : null;
}

function alphaHash(state) {
  return baselineBundleHash("aak-product-alpha-baseline-v1", state, ["discovery-validation"]);
}

function investmentHash(state) {
  return baselineBundleHash("aak-product-investment-baseline-v1", state, ["business-viability", "trust-compliance", "data-lifecycle"]);
}

function productionReadinessMembers(state) {
  return ["verification", "iteration-review", "production-readiness", "product-analytics", "support-readiness"]
    .map((type) => artifactHead(state, type)).filter(Boolean).map(({ type, id, version, hash }) => ({ type, id, version, hash }));
}

function productionReadinessHash(state) {
  const members = productionReadinessMembers(state);
  return members.length === 5 ? productDigest({ protocol: "aak-product-production-readiness-v1", members, convergence_hash: state.convergence?.hash ?? null }) : null;
}

function artifactEvidenceIds(artifact) {
  const ids = [];
  const visit = (value) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "evidence_receipt_ids" && Array.isArray(item)) ids.push(...item);
      else visit(item);
    }
  };
  visit(artifact);
  return [...new Set(ids)];
}

function nextActionFrom(state, questions) {
  const active = questionRound(questions);
  if (active.some((item) => item.priority >= 80)) return { skill: "discuss-product-idea", reason: "Resolve the highest-impact discovery questions", questions: active, requires_human: true };
  const research = artifactHead(state, "research");
  if (!research) return { skill: "research-product-opportunity", reason: "Test the material desirability, viability, feasibility, and risk assumptions", questions: active, requires_human: false };
  if (!approved(state, "DISCOVERY_DECISION", discoveryHash(state, questions))) return { skill: "approve-product-baseline", reason: "Approve or revise the discovery decision before drafting business requirements", approval_type: "DISCOVERY_DECISION", requires_human: true };
  const discoveryValidation = artifactHead(state, "discovery-validation");
  if (!discoveryValidation) return { skill: "validate-product-discovery", reason: "Test hypotheses with experiments, prototypes, usability, and customer evidence before committing to a large specification", requires_human: false };
  if (!approved(state, "ALPHA_DECISION", alphaHash(state))) return { skill: "approve-product-baseline", reason: "Approve a continue, pivot, or stop Alpha decision bound to current validation evidence", approval_type: "ALPHA_DECISION", requires_human: true };
  const viability = artifactHead(state, "business-viability"), trust = artifactHead(state, "trust-compliance"), data = artifactHead(state, "data-lifecycle");
  if (!viability) return { skill: "assess-product-viability", reason: "Complete the business case, unit economics, pricing, and go-to-market decision before the BRD", requires_human: false };
  if (!trust || !data) return { skill: "assure-product-trust", reason: "Complete accessibility, privacy/legal, threat/security, and data-lifecycle assurance before the BRD", requires_human: false };
  if (!approved(state, "INVESTMENT_DECISION", investmentHash(state))) return { skill: "approve-product-baseline", reason: "Approve the exact investment, trust, and data-lifecycle baseline", approval_type: "INVESTMENT_DECISION", requires_human: true };
  const brd = artifactHead(state, "brd");
  if (!brd || (state.profile !== "LEAN" && !artifactHead(state, "business-rules"))) return { skill: "write-business-requirements", reason: "Create the BRD and explicit business-rule catalog from approved discovery evidence", requires_human: false };
  if (!approvedBusinessRequirements(state)) return { skill: "approve-product-baseline", reason: "Analyze and approve the exact BRD and business-rule baseline", approval_type: "BUSINESS_REQUIREMENTS", requires_human: true };
  const spec = artifactHead(state, "specification"), design = artifactHead(state, "design");
  if (!spec || !design) return { skill: "write-product-specification", reason: "Complete the product specification and risk-adaptive design bundle", requires_human: false };
  const currentSolution = solutionHash(state);
  if (!approved(state, "SOLUTION_BASELINE", currentSolution)) return { skill: "approve-product-baseline", reason: "Run cross-artifact analysis and approve the exact solution baseline", approval_type: "SOLUTION_BASELINE", requires_human: true };
  const delivery = artifactHead(state, "delivery");
  if (!delivery) return { skill: "plan-product-delivery", reason: "Create the smallest traceable vertical delivery plan", requires_human: false };
  if (!approved(state, "DELIVERY_BASELINE", delivery.hash)) return { skill: "approve-product-baseline", reason: "Approve the delivery baseline and implementation scope", approval_type: "DELIVERY_BASELINE", requires_human: true };
  const iterationPlan = artifactHead(state, "iteration-plan"), iterationReview = artifactHead(state, "iteration-review");
  if (!iterationPlan || !iterationReview) return { skill: "run-product-iteration", reason: "Execute and review a capacity-bounded iteration with acceptance and change propagation", requires_human: false };
  const readiness = artifactHead(state, "production-readiness"), analytics = artifactHead(state, "product-analytics"), support = artifactHead(state, "support-readiness");
  if (!readiness || !analytics || !support) return { skill: "prepare-production-readiness", reason: "Bind CI/CD, infrastructure, operations, migration, capacity, restore, rollback, analytics, and support evidence", requires_human: false };
  if (!approved(state, "PRODUCTION_READINESS", productionReadinessHash(state))) return { skill: "approve-product-baseline", reason: "Approve the exact evidence-backed production-readiness dossier", approval_type: "PRODUCTION_READINESS", requires_human: true };
  if (!state.release_candidate) return { skill: "prepare-production-readiness", reason: "Generate the immutable release-candidate dossier from current approved baselines and evidence", requires_human: false };
  if (!approved(state, "RELEASE_DECISION", state.release_candidate.hash)) return { skill: "approve-product-baseline", reason: "Make a human release decision on the exact release-candidate dossier", approval_type: "RELEASE_DECISION", requires_human: true };
  const retirement = artifactHead(state, "retirement");
  if (retirement && !approved(state, "RETIREMENT_DECISION", retirement.hash)) return { skill: "approve-product-baseline", reason: "Approve, revise, or reject the exact retirement and data-deletion plan", approval_type: "RETIREMENT_DECISION", requires_human: true };
  if (state.stage === "RETIRED") return { skill: "retire-product", reason: "Verify external shutdown and deletion receipts without claiming actions that were not executed", requires_human: false };
  if (state.stage === "OPERATING") return { skill: "review-product-outcome", reason: "Measure production outcomes and create the next evidence-backed version", requires_human: false };
  return { skill: "run-product-iteration", reason: "Implement only the approved vertical slice and preserve intent traceability inside a bounded iteration", requires_human: false };
}

function gateFindings(loc, state, questions, gate, now = timestamp()) {
  const findings = [];
  const add = (severity, code, message, refs = []) => findings.push({ severity, code, message, refs });
  const active = questionRound(questions).filter((item) => item.priority >= 80);
  if (["DISCOVERY_DECISION", "ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) for (const item of active) add("BLOCKER", "CRITICAL_QUESTION_OPEN", item.text, [item.id]);
  const research = readHead(loc, state, "research");
  if (["DISCOVERY_DECISION", "ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) {
    if (!research) add("BLOCKER", "RESEARCH_MISSING", "Discovery must include an explicit opportunity decision");
    else {
      if (research.decision?.recommendation !== "PROCEED") add("BLOCKER", "RESEARCH_NOT_PROCEED", `Research recommendation is ${research.decision?.recommendation ?? "UNKNOWN"}`);
      const idea = artifactHead(state, "idea"), expectedIdeaVersion = idea ? `${idea.id}@${idea.version}` : null;
      if (expectedIdeaVersion && research.idea_version !== expectedIdeaVersion) add("BLOCKER", "RESEARCH_IDEA_STALE", `Research references ${research.idea_version ?? "no idea version"}, not ${expectedIdeaVersion}`);
    }
  }
  const discoveryValidation = readHead(loc, state, "discovery-validation");
  if (["ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) {
    if (!approved(state, "DISCOVERY_DECISION", discoveryHash(state, questions))) add("BLOCKER", "DISCOVERY_APPROVAL_STALE", "Current discovery baseline is not approved");
    if (!discoveryValidation) add("BLOCKER", "DISCOVERY_VALIDATION_MISSING", "Hypothesis, experiment, prototype, usability, and customer validation is missing");
    else {
      findings.push(...standaloneFindings("discovery-validation", discoveryValidation));
      if (discoveryValidation.decision?.recommendation !== "CONTINUE") add("BLOCKER", "ALPHA_NOT_CONTINUE", `Alpha recommendation is ${discoveryValidation.decision?.recommendation ?? "UNKNOWN"}`);
      const requiredCollections = state.profile === "LEAN" ? [] : ["prototypes", "usability_tests", "customer_evidence"];
      for (const field of requiredCollections) if (!discoveryValidation[field]?.length) add("BLOCKER", "ALPHA_EVIDENCE_DEPTH", `${state.profile} discovery validation requires ${field}`);
      try { requireEvidenceReceipts(loc, state, artifactEvidenceIds(discoveryValidation), now, { minimumTrust: "REPOSITORY_BOUND" }); }
      catch (error) { add("BLOCKER", "ALPHA_EVIDENCE_INVALID", error.message); }
      for (const [field, kinds] of [["usability_tests", new Set(["USABILITY_TEST"])], ["customer_evidence", new Set(["CUSTOMER_RESEARCH"])]] ) for (const item of discoveryValidation[field] ?? []) {
        try { requireEvidenceReceipts(loc, state, item.evidence_receipt_ids, now, { minimumTrust: "REPOSITORY_BOUND", kinds }); }
        catch (error) { add("BLOCKER", "ALPHA_EVIDENCE_KIND", `${field}: ${error.message}`); }
      }
    }
  }
  const viability = readHead(loc, state, "business-viability"), trust = readHead(loc, state, "trust-compliance"), dataLifecycle = readHead(loc, state, "data-lifecycle");
  if (["INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) {
    if (!approved(state, "ALPHA_DECISION", alphaHash(state))) add("BLOCKER", "ALPHA_APPROVAL_STALE", "Current Alpha decision is not approved");
    for (const [type, artifact] of [["business-viability", viability], ["trust-compliance", trust], ["data-lifecycle", dataLifecycle]]) {
      if (!artifact) add("BLOCKER", `${type.toUpperCase().replaceAll("-", "_")}_MISSING`, `${type} artifact is missing`);
      else {
        findings.push(...standaloneFindings(type, artifact));
        try { requireEvidenceReceipts(loc, state, artifactEvidenceIds(artifact), now, { minimumTrust: "REPOSITORY_BOUND" }); }
        catch (error) { add("BLOCKER", "INVESTMENT_EVIDENCE_INVALID", `${type}: ${error.message}`); }
      }
    }
    if (viability && viability.decision?.recommendation !== "INVEST") add("BLOCKER", "INVESTMENT_NOT_APPROVED", `Business viability recommendation is ${viability.decision?.recommendation ?? "UNKNOWN"}`);
    if (trust) {
      if (trust.threat_model?.status !== "READY") add("BLOCKER", "THREAT_MODEL_NOT_READY", "Threat model must be READY and cannot be waived for implementation");
      if (!new Set(["READY", "NOT_APPLICABLE"]).has(trust.accessibility?.status)) add("BLOCKER", "ACCESSIBILITY_NOT_READY", "Accessibility review is open");
      if (trust.threat_model?.status === "READY" && !trust.threat_model.evidence_receipt_ids?.length) add("BLOCKER", "THREAT_EVIDENCE_MISSING", "Ready threat model requires bound evidence");
      if (trust.accessibility?.status === "READY" && !trust.accessibility.evidence_receipt_ids?.length) add("BLOCKER", "ACCESSIBILITY_EVIDENCE_MISSING", "Ready accessibility review requires bound evidence");
      for (const review of trust.privacy_legal ?? []) {
        if (review.status === "OPEN" || (state.profile === "HIGH_ASSURANCE" && review.status !== "READY")) add("BLOCKER", "PRIVACY_LEGAL_NOT_READY", `Privacy/legal review for ${review.market} is not ready`);
        if (review.status === "NOT_APPLICABLE" && !review.rationale?.trim()) add("BLOCKER", "PRIVACY_LEGAL_NA", `Privacy/legal review for ${review.market} lacks an applicability rationale`);
        if (review.status === "READY" && !review.evidence_receipt_ids?.length) add("BLOCKER", "PRIVACY_LEGAL_EVIDENCE_MISSING", `Ready privacy/legal review for ${review.market} requires bound evidence`);
      }
      for (const finding of trust.security_findings ?? []) if (["CRITICAL", "HIGH"].includes(finding.severity) && !["RESOLVED", "ACCEPTED_BY_HUMAN"].includes(finding.status)) add("BLOCKER", "SECURITY_FINDING_OPEN", `${finding.id} remains ${finding.status}`, [finding.id]);
      try { requireEvidenceReceipts(loc, state, trust.accessibility?.evidence_receipt_ids ?? [], now, { minimumTrust: "REPOSITORY_BOUND", kinds: new Set(["ACCESSIBILITY_REVIEW"]) }); }
      catch (error) { add("BLOCKER", "ACCESSIBILITY_EVIDENCE_INVALID", error.message); }
      try { requireEvidenceReceipts(loc, state, trust.threat_model?.evidence_receipt_ids ?? [], now, { minimumTrust: "REPOSITORY_BOUND", kinds: new Set(["THREAT_MODEL", "SECURITY_SCAN"]) }); }
      catch (error) { add("BLOCKER", "THREAT_EVIDENCE_INVALID", error.message); }
      for (const review of trust.privacy_legal ?? []) {
        try { requireEvidenceReceipts(loc, state, review.evidence_receipt_ids ?? [], now, { minimumTrust: "REPOSITORY_BOUND", kinds: new Set(["PRIVACY_LEGAL_REVIEW"]) }); }
        catch (error) { add("BLOCKER", "PRIVACY_LEGAL_EVIDENCE_INVALID", `${review.market}: ${error.message}`); }
      }
      for (const finding of trust.security_findings ?? []) if (finding.evidence_receipt_ids?.length) {
        try { requireEvidenceReceipts(loc, state, finding.evidence_receipt_ids, now, { minimumTrust: "REPOSITORY_BOUND", kinds: new Set(["SECURITY_SCAN"]) }); }
        catch (error) { add("BLOCKER", "SECURITY_FINDING_EVIDENCE_INVALID", `${finding.id}: ${error.message}`); }
      }
    }
  }
  const brd = readHead(loc, state, "brd");
  const rules = readHead(loc, state, "business-rules");
  if (["BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) {
    if (!approved(state, "INVESTMENT_DECISION", investmentHash(state))) add("BLOCKER", "INVESTMENT_APPROVAL_STALE", "Current business viability, trust, and data-lifecycle baseline is not approved");
    if (!brd) add("BLOCKER", "BRD_MISSING", "Business requirements are missing");
    else {
      findings.push(...standaloneFindings("brd", brd));
      for (const sourceType of ["idea", "research"]) {
        const head = artifactHead(state, sourceType), expected = head ? `${head.id}@${head.version}` : null;
        if (expected && !brd.source_versions?.includes(expected)) add("BLOCKER", "BRD_SOURCE_STALE", `BRD does not reference current ${sourceType} version ${expected}`, [expected]);
      }
    }
    if (state.profile !== "LEAN" && !rules) add("BLOCKER", "BUSINESS_RULES_MISSING", `${state.profile} products require an explicit business-rule catalog`);
    if (rules) {
      findings.push(...standaloneFindings("business-rules", rules));
      const expectedBrd = artifactHead(state, "brd") ? `${artifactHead(state, "brd").id}@${artifactHead(state, "brd").version}` : null;
      if (expectedBrd && !rules.source_versions?.includes(expectedBrd)) add("BLOCKER", "BUSINESS_RULES_BRD_STALE", `Business rules do not reference current BRD version ${expectedBrd}`, [expectedBrd]);
    }
  }
  const spec = readHead(loc, state, "specification");
  const design = readHead(loc, state, "design");
  if (["SOLUTION_BASELINE", "DELIVERY_BASELINE"].includes(gate)) {
    if (!approvedBusinessRequirements(state)) add("BLOCKER", "BRD_APPROVAL_STALE", "Current BRD and business-rule baseline is not approved");
    if (!spec) add("BLOCKER", "SPEC_MISSING", "Product specification is missing");
    else findings.push(...standaloneFindings("specification", spec));
    if (!design) add("BLOCKER", "DESIGN_MISSING", "Solution design bundle is missing");
    else findings.push(...standaloneFindings("design", design));
    if (brd && spec) {
      if (spec.approved_brd?.hash !== artifactHead(state, "brd").hash) add("BLOCKER", "SPEC_BRD_STALE", "Specification references a stale BRD hash");
      const requirementIds = new Set(brd.requirements.map((item) => item.id));
      const requiredIds = new Set(brd.requirements.filter((item) => ["MUST", "SHOULD"].includes(item.priority)).map((item) => item.id));
      const specItems = [...(spec.functional_requirements ?? []), ...(spec.non_functional_requirements ?? [])];
      const traced = new Set();
      for (const item of specItems) for (const id of item.source_requirement_ids ?? []) {
        if (!requirementIds.has(id)) add("BLOCKER", "UNKNOWN_BRD_TRACE", `${item.id} references unknown business requirement ${id}`, [item.id, id]);
        else traced.add(id);
      }
      for (const id of requiredIds) if (!traced.has(id)) add("BLOCKER", "UNTRACED_BUSINESS_REQUIREMENT", `${id} has no specification trace`, [id]);
      const acceptanceIds = new Set((spec.acceptance_criteria ?? []).map((item) => item.id));
      const specItemIds = new Set(specItems.map((item) => item.id));
      for (const item of specItems) for (const id of item.verification_ids ?? []) if (!acceptanceIds.has(id)) add("BLOCKER", "UNKNOWN_VERIFICATION", `${item.id} references unknown acceptance criterion ${id}`, [item.id, id]);
      for (const criterion of spec.acceptance_criteria ?? []) for (const id of criterion.verifies ?? []) if (!specItemIds.has(id)) add("BLOCKER", "UNKNOWN_SPEC_ITEM", `${criterion.id} verifies unknown specification item ${id}`, [criterion.id, id]);
      for (const journey of spec.journeys ?? []) for (const id of journey.requirement_ids ?? []) if (!requirementIds.has(id)) add("BLOCKER", "UNKNOWN_JOURNEY_REQUIREMENT", `${journey.id} references unknown business requirement ${id}`, [journey.id, id]);
      for (const rule of rules?.rules ?? []) for (const id of rule.source_requirement_ids ?? []) if (!requirementIds.has(id)) add("BLOCKER", "UNKNOWN_RULE_REQUIREMENT", `${rule.id} references unknown business requirement ${id}`, [rule.id, id]);
      const vague = /\b(fast|easy|intuitive|user[- ]friendly|scalable|secure|reliable)\b/i;
      for (const item of specItems) if (vague.test(item.statement) && !/\d/.test(item.statement)) add("WARNING", "UNMEASURABLE_LANGUAGE", `${item.id} may be unmeasurable`, [item.id]);
    }
    if (design && spec) {
      if (design.approved_brd?.hash !== artifactHead(state, "brd")?.hash || design.specification?.hash !== artifactHead(state, "specification")?.hash) add("BLOCKER", "DESIGN_BASELINE_STALE", "Design bundle references stale BRD or specification hashes");
      const tracks = new Map((design.tracks ?? []).map((item) => [item.id, item]));
      for (const id of REQUIRED_DESIGN_TRACKS[state.profile]) {
        const track = tracks.get(id);
        if (!track || !["READY", "NOT_APPLICABLE"].includes(track.status) || (track.status === "NOT_APPLICABLE" && !track.rationale?.trim())) add("BLOCKER", "DESIGN_TRACK_INCOMPLETE", `Required design track ${id} is incomplete`, [id]);
      }
    }
  }
  const delivery = readHead(loc, state, "delivery");
  if (gate === "DELIVERY_BASELINE") {
    if (!approved(state, "SOLUTION_BASELINE", solutionHash(state))) add("BLOCKER", "SOLUTION_APPROVAL_STALE", "Current solution baseline is not approved");
    if (!delivery) add("BLOCKER", "DELIVERY_MISSING", "Delivery baseline is missing");
    else {
      findings.push(...standaloneFindings("delivery", delivery));
      if (brd) {
        const requirementIds = new Set(brd.requirements.map((item) => item.id));
        const acceptanceIds = new Set((spec?.acceptance_criteria ?? []).map((item) => item.id));
        const planned = new Set();
        const itemIds = new Set(delivery.items.map((item) => item.id));
        const milestoneIds = new Set((delivery.milestones ?? []).map((item) => item.id));
        const dependencyGraph = new Map();
        for (const item of delivery.items) {
          for (const id of item.requirement_ids ?? []) { if (!requirementIds.has(id)) add("BLOCKER", "UNKNOWN_DELIVERY_REQUIREMENT", `${item.id} references unknown requirement ${id}`, [item.id, id]); else planned.add(id); }
          for (const id of item.acceptance_ids ?? []) if (!acceptanceIds.has(id)) add("BLOCKER", "UNKNOWN_DELIVERY_ACCEPTANCE", `${item.id} references unknown acceptance criterion ${id}`, [item.id, id]);
          for (const dependency of item.dependencies ?? []) if (!itemIds.has(dependency)) add("BLOCKER", "UNKNOWN_DELIVERY_DEPENDENCY", `${item.id} depends on unknown item ${dependency}`, [item.id, dependency]);
          dependencyGraph.set(item.id, item.dependencies ?? []);
          if (item.parent_id && (!itemIds.has(item.parent_id) || item.parent_id === item.id)) add("BLOCKER", "INVALID_DELIVERY_PARENT", `${item.id} has an invalid parent ${item.parent_id}`, [item.id, item.parent_id]);
          if (item.milestone_id && !milestoneIds.has(item.milestone_id)) add("BLOCKER", "UNKNOWN_DELIVERY_MILESTONE", `${item.id} references unknown milestone ${item.milestone_id}`, [item.id, item.milestone_id]);
          if (Number(item.estimate?.low) > Number(item.estimate?.high)) add("BLOCKER", "INVALID_ESTIMATE_RANGE", `${item.id} estimate low exceeds high`, [item.id]);
        }
        const visiting = new Set(), visited = new Set();
        const visit = (id, chain = []) => {
          if (visiting.has(id)) { add("BLOCKER", "DELIVERY_DEPENDENCY_CYCLE", `Delivery dependency cycle includes ${[...chain, id].join(" -> ")}`, [...chain, id]); return; }
          if (visited.has(id)) return;
          visiting.add(id); for (const dependency of dependencyGraph.get(id) ?? []) if (dependencyGraph.has(dependency)) visit(dependency, [...chain, id]); visiting.delete(id); visited.add(id);
        };
        for (const id of dependencyGraph.keys()) visit(id);
        const suppliedBaselines = new Set((delivery.approved_baselines ?? []).map((item) => item.hash));
        if (!suppliedBaselines.has(artifactHead(state, "brd")?.hash) || !suppliedBaselines.has(solutionHash(state))) add("BLOCKER", "DELIVERY_BASELINES_STALE", "Delivery does not bind the current BRD and solution hashes");
        for (const item of brd.requirements.filter((candidate) => ["MUST", "SHOULD"].includes(candidate.priority))) if (!planned.has(item.id)) add("BLOCKER", "UNPLANNED_REQUIREMENT", `${item.id} is absent from the delivery plan`, [item.id]);
      }
    }
  }
  if (gate === "RELEASE_DECISION") {
    if (!approved(state, "PRODUCTION_READINESS", productionReadinessHash(state))) add("BLOCKER", "PRODUCTION_READINESS_APPROVAL_STALE", "Current production-readiness dossier is not approved");
    if (!state.release_candidate) add("BLOCKER", "RELEASE_CANDIDATE_MISSING", "Immutable release-candidate dossier is missing");
    else {
      const candidate = boundedJson(loc.root, state.release_candidate.path, "release candidate dossier");
      try { if (candidate.repository?.commit !== currentRepository(loc.root).commit) add("BLOCKER", "RELEASE_COMMIT_DRIFT", "Release candidate does not bind the current Git commit"); }
      catch (error) { add("BLOCKER", "RELEASE_REPOSITORY_UNAVAILABLE", error.message); }
      if (candidate.production_readiness_hash !== productionReadinessHash(state)) add("BLOCKER", "RELEASE_READINESS_DRIFT", "Release candidate does not bind the current production-readiness dossier");
      for (const [type, head] of Object.entries(state.artifact_heads)) if (candidate.baseline_hashes?.[type] !== head.hash) add("BLOCKER", "RELEASE_BASELINE_DRIFT", `Release candidate does not bind current ${type}`, [type]);
      const environment = state.environment_attestations?.[candidate.environment?.id];
      if (!environment || environment.attestation_hash !== candidate.environment.attestation_hash) add("BLOCKER", "RELEASE_ENVIRONMENT_DRIFT", "Release candidate environment attestation is missing or stale");
    }
  }
  if (["PRODUCTION_READINESS", "RELEASE_DECISION"].includes(gate)) {
    if (!approved(state, "DELIVERY_BASELINE", artifactHead(state, "delivery")?.hash)) add("BLOCKER", "DELIVERY_APPROVAL_STALE", "Current delivery baseline is not approved");
    if (state.convergence?.status !== "CONVERGED") add("BLOCKER", "CONVERGENCE_MISSING", "Requirement-to-code/test/evidence convergence is not current");
    else {
      try { if (state.convergence.implementation_commit !== currentRepository(loc.root).commit) add("BLOCKER", "CONVERGENCE_COMMIT_DRIFT", "Convergence evidence does not bind the current Git commit"); }
      catch (error) { add("BLOCKER", "CONVERGENCE_REPOSITORY_UNAVAILABLE", error.message); }
    }
    const verification = readHead(loc, state, "verification"), iteration = readHead(loc, state, "iteration-review"), readiness = readHead(loc, state, "production-readiness"), analytics = readHead(loc, state, "product-analytics"), support = readHead(loc, state, "support-readiness");
    for (const [type, artifact] of [["verification", verification], ["iteration-review", iteration], ["production-readiness", readiness], ["product-analytics", analytics], ["support-readiness", support]]) {
      if (!artifact) add("BLOCKER", `${type.toUpperCase().replaceAll("-", "_")}_MISSING`, `${type} artifact is missing`);
      else findings.push(...standaloneFindings(type, artifact));
    }
    if (verification) {
      if (verification.approved_delivery?.hash !== artifactHead(state, "delivery")?.hash) add("BLOCKER", "VERIFICATION_DELIVERY_STALE", "Verification references a stale delivery baseline");
      if (["LOCAL", "SYNTHETIC"].includes(verification.environment)) add("BLOCKER", "NON_RELEASE_ENVIRONMENT", `${verification.environment} evidence cannot authorize a release decision`);
    }
    if (readiness) {
      const environment = state.environment_attestations?.[readiness.environment_attestation_id];
      if (!environment) add("BLOCKER", "ENVIRONMENT_ATTESTATION_MISSING", `Environment attestation ${readiness.environment_attestation_id} is missing`);
      else {
        if (Date.parse(environment.expires_at) <= Date.parse(now)) add("BLOCKER", "ENVIRONMENT_ATTESTATION_EXPIRED", `Environment attestation ${environment.id} is expired`);
        try { if (environment.repository_commit !== currentRepository(loc.root).commit) add("BLOCKER", "ENVIRONMENT_COMMIT_DRIFT", `Environment attestation ${environment.id} does not bind the current commit`); }
        catch (error) { add("BLOCKER", "ENVIRONMENT_REPOSITORY_UNAVAILABLE", error.message); }
        if (EVIDENCE_TRUST_RANK[environment.trust_level] < EVIDENCE_TRUST_RANK.PROVIDER_VERIFIED) add("BLOCKER", "ENVIRONMENT_TRUST_INSUFFICIENT", "Release readiness requires provider-verified environment evidence");
      }
      for (const [name, check] of Object.entries(readiness.checks ?? {})) {
        if (check.status === "BLOCKED") add("BLOCKER", "PRODUCTION_CHECK_BLOCKED", `Production check ${name} is blocked`);
        if (check.status === "NOT_APPLICABLE" && ["ci_cd", "acceptance", "security", "observability", "incident_readiness", "backup_restore", "rollback"].includes(name)) add("BLOCKER", "CORE_PRODUCTION_CHECK_WAIVED", `Core production check ${name} cannot be waived`);
        if (check.status === "READY") {
          try {
            const receipts = requireEvidenceReceipts(loc, state, check.evidence_receipt_ids, now, { minimumTrust: "PROVIDER_VERIFIED", kinds: PRODUCTION_CHECK_EVIDENCE_KINDS[name], environmentAttestationId: readiness.environment_attestation_id, requireCurrentCommit: true });
            if (name === "migration" && dataLifecycle?.migrations?.length) {
              const presentKinds = new Set(receipts.map((item) => item.kind));
              for (const requiredKind of ["MIGRATION", "RETAINED_DATA"]) if (!presentKinds.has(requiredKind)) add("BLOCKER", "MIGRATION_EVIDENCE_INCOMPLETE", `Migration readiness requires ${requiredKind} evidence`);
            }
          }
          catch (error) { add("BLOCKER", "PRODUCTION_EVIDENCE_INVALID", `${name}: ${error.message}`); }
        }
      }
    }
    for (const [artifact, kinds] of [[analytics, new Set(["ANALYTICS"])], [support, new Set(["SUPPORT"])]] ) if (artifact) {
      try { requireEvidenceReceipts(loc, state, artifactEvidenceIds(artifact), now, { minimumTrust: "PROVIDER_VERIFIED", kinds, environmentAttestationId: readiness?.environment_attestation_id, requireCurrentCommit: true }); }
      catch (error) { add("BLOCKER", "OPERATING_EVIDENCE_INVALID", error.message); }
    }
  }
  if (gate === "RETIREMENT_DECISION") {
    const retirement = readHead(loc, state, "retirement");
    if (!retirement) add("BLOCKER", "RETIREMENT_PLAN_MISSING", "Retirement and data-deletion plan is missing");
    else {
      findings.push(...standaloneFindings("retirement", retirement));
      try { requireEvidenceReceipts(loc, state, artifactEvidenceIds(retirement), now, { minimumTrust: "PROVIDER_VERIFIED", requireCurrentCommit: true }); }
      catch (error) { add("BLOCKER", "RETIREMENT_EVIDENCE_INVALID", error.message); }
    }
  }
  return findings;
}

function gateForState(state, questions) {
  if (!artifactHead(state, "research") || !approved(state, "DISCOVERY_DECISION", discoveryHash(state, questions))) return "DISCOVERY_DECISION";
  if (!artifactHead(state, "discovery-validation") || !approved(state, "ALPHA_DECISION", alphaHash(state))) return "ALPHA_DECISION";
  if (!["business-viability", "trust-compliance", "data-lifecycle"].every((type) => artifactHead(state, type)) || !approved(state, "INVESTMENT_DECISION", investmentHash(state))) return "INVESTMENT_DECISION";
  if (!artifactHead(state, "brd") || !approvedBusinessRequirements(state)) return "BUSINESS_REQUIREMENTS";
  if (!artifactHead(state, "specification") || !artifactHead(state, "design") || !approved(state, "SOLUTION_BASELINE", solutionHash(state))) return "SOLUTION_BASELINE";
  if (!artifactHead(state, "delivery") || !approved(state, "DELIVERY_BASELINE", artifactHead(state, "delivery")?.hash)) return "DELIVERY_BASELINE";
  if (!approved(state, "PRODUCTION_READINESS", productionReadinessHash(state))) return "PRODUCTION_READINESS";
  return "RELEASE_DECISION";
}

function analysis(loc, state, questions, gate = gateForState(state, questions), now = timestamp()) {
  const findings = gateFindings(loc, state, questions, gate, now);
  const blockers = findings.filter((item) => item.severity === "BLOCKER");
  const warnings = findings.filter((item) => item.severity === "WARNING");
  const brd = readHead(loc, state, "brd"), spec = readHead(loc, state, "specification"), delivery = readHead(loc, state, "delivery");
  const requirementIds = new Set((brd?.requirements ?? []).filter((item) => ["MUST", "SHOULD"].includes(item.priority)).map((item) => item.id));
  const specTraced = new Set([...(spec?.functional_requirements ?? []), ...(spec?.non_functional_requirements ?? [])].flatMap((item) => item.source_requirement_ids ?? []));
  const deliveryTraced = new Set((delivery?.items ?? []).flatMap((item) => item.requirement_ids ?? []));
  const ratio = (set) => requirementIds.size ? [...requirementIds].filter((id) => set.has(id)).length / requirementIds.size : null;
  const report = {
    schema_version: 1, product_id: state.id, gate, state_revision: state.revision,
    analyzed_at: now, status: blockers.length ? "BLOCKED" : "READY_FOR_APPROVAL",
    profile: state.profile, baseline_hashes: Object.fromEntries(Object.entries(state.artifact_heads).map(([type, head]) => [type, head.hash])),
    findings, summary: { blockers: blockers.length, warnings: warnings.length },
    trace_coverage: { required_business_requirements: requirementIds.size, specification_ratio: ratio(specTraced), delivery_ratio: ratio(deliveryTraced) },
    next_action: nextActionFrom(state, questions)
  };
  report.analysis_hash = productDigest(report);
  return report;
}

export function createProductWorkspace(options = {}) {
  const loc = location(options); const now = timestamp(options.timestamp);
  const rawIdea = text(options.idea, "raw idea", 128 * 1024);
  assertNoRestrictedData(rawIdea, "raw idea");
  const profile = String(options.profile ?? "STANDARD").replaceAll("-", "_").toUpperCase();
  if (!PRODUCT_PROFILES.includes(profile)) throw new Error(`product profile must be one of ${PRODUCT_PROFILES.join(", ")}`);
  if (fs.existsSync(loc.directory)) throw new Error(`product workspace ${loc.id} already exists or contains an incomplete prior attempt`);
  return withLock(loc, options, () => {
    if (fs.existsSync(loc.state)) throw new Error(`product workspace ${loc.id} already exists`);
    fs.mkdirSync(path.join(loc.directory, "artifacts", "idea"), { recursive: true, mode: 0o700 });
    const ideaBase = {
      schema_version: 1, id: `IDEA-${loc.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`, version: 1, status: "IDEA",
      created_at: now, created_by: text(options.createdBy ?? options.actor ?? "user", "creator", 256), raw_idea: rawIdea,
      problem: "", people: [], desired_outcomes: [], constraints: [], assumptions: [], unknowns: [], parent_versions: []
    };
    const idea = { ...ideaBase, content_hash: productDigest(ideaBase) };
    const ideaRelative = `.ai/products/${loc.id}/artifacts/idea/v1.json`;
    atomicJson(path.join(loc.root, ideaRelative), idea, MAX_JSON_BYTES);
    const state = sealState({
      schema_version: 1, id: loc.id, name: options.name ? text(options.name, "product name", 256) : loc.id,
      stage: "IDEA", profile, revision: 1, created_at: now, updated_at: now,
      created_by: ideaBase.created_by, artifact_heads: { idea: artifactReference("idea", idea, ideaRelative) },
      approvals: {}, context: { confirmed: [], assumptions: [], unknowns: [], changed: [] }, github_plan: null,
      convergence: null, evidence_receipts: {}, environment_attestations: {}, iterations: {}, release_candidate: null
    });
    const seed = [
      ["Q-PROBLEM", "What exact problem should this product solve, for whom, and why does it matter now?", "Defines the problem and primary user before solution design.", "DEC-PROBLEM", 100],
      ["Q-WORKAROUND", "How do those users handle the problem today, and what does that cost them?", "Establishes real workflow pain and an evidence baseline.", "DEC-CURRENT-WORKFLOW", 90],
      ["Q-OUTCOME", "What measurable user or business outcome would make the first version successful?", "Creates the Product Goal and later acceptance metrics.", "DEC-PRODUCT-GOAL", 85]
    ];
    const questions = sealQuestions({ schema_version: 1, product_id: loc.id, revision: 1, created_at: now, updated_at: now, items: seed.map(([id, question, rationale, decision_id, priority]) => ({ id, text: question, rationale, decision_id, priority, stage: "DISCOVERY", status: "OPEN", created_at: now, created_by: "product-genesis-runtime", answer: null })) });
    atomicJson(loc.state, state); atomicJson(loc.questions, questions); appendEvent(loc, "PRODUCT_CREATED", { product_id: loc.id, profile, idea_hash: idea.content_hash }, now);
    return { schema_version: 1, status: "CREATED", product: inspectProduct({ target: loc.root, id: loc.id }) };
  });
}

export function inspectProduct(options = {}) {
  const loc = location(options), state = readState(loc), questions = readQuestions(loc), events = readEvents(loc);
  const next = nextActionFrom(state, questions);
  return {
    schema_version: 1, status: "CURRENT", id: state.id, name: state.name, stage: state.stage, profile: state.profile,
    revision: state.revision, created_at: state.created_at, updated_at: state.updated_at,
    artifacts: structuredClone(state.artifact_heads), approvals: structuredClone(state.approvals),
    evidence_receipts: structuredClone(state.evidence_receipts), environment_attestations: structuredClone(state.environment_attestations),
    iterations: structuredClone(state.iterations), release_candidate: structuredClone(state.release_candidate),
    context_counts: Object.fromEntries(Object.entries(state.context).map(([key, values]) => [key, values.length])),
    question_counts: { total: questions.items.length, open: questions.items.filter((item) => ["OPEN", "ACTIVE"].includes(item.status)).length, answered: questions.items.filter((item) => item.status === "ANSWERED").length, deferred: questions.items.filter((item) => item.status === "DEFERRED").length },
    current_questions: questionRound(questions), next_action: next,
    integrity: { state_hash: state.state_hash, questions_hash: questions.questions_hash, event_count: events.length, latest_event_hash: events.at(-1)?.event_hash ?? null }
  };
}

export function resumeProduct(options = {}) {
  const loc = location(options), state = readState(loc), questions = readQuestions(loc), product = inspectProduct(options);
  const answered = questions.items.filter((item) => ["ANSWERED", "DEFERRED"].includes(item.status)).map((item) => ({ id: item.id, question: item.text, status: item.status, answer: item.answer?.text ?? null, source: item.answer?.source ?? null, actor: item.answer?.actor ?? null, answered_at: item.answer?.answered_at ?? null }));
  return { ...product, status: "RESUME_READY", prompt_context: { product_id: product.id, stage: product.stage, profile: product.profile, artifact_hashes: Object.fromEntries(Object.entries(product.artifacts).map(([type, head]) => [type, head.hash])), artifact_paths: Object.fromEntries(Object.entries(product.artifacts).map(([type, head]) => [type, head.path])), approvals: Object.fromEntries(Object.entries(product.approvals).map(([type, item]) => [type, { hash: item.approval_hash, status: item.status }])), evidence_receipts: Object.fromEntries(Object.entries(state.evidence_receipts).map(([id, item]) => [id, { hash: item.receipt_hash, trust_level: item.trust_level, expires_at: item.expires_at }])), environments: Object.fromEntries(Object.entries(state.environment_attestations).map(([id, item]) => [id, { hash: item.attestation_hash, class: item.environment_class, trust_level: item.trust_level, expires_at: item.expires_at }])), release_candidate: structuredClone(state.release_candidate), context: structuredClone(state.context), answered_questions: answered, questions: product.current_questions.map(({ id, text: question, rationale, decision_id, priority }) => ({ id, question, rationale, decision_id, priority })), next_skill: product.next_action.skill }, note: "Load only the sealed current context, current artifact heads, evidence receipts, environment attestations, and cited predecessors; chat history is not authoritative." };
}

export function nextProductAction(options = {}) {
  const loc = location(options), state = readState(loc), questions = readQuestions(loc);
  return { schema_version: 1, status: "NEXT_ACTION", product_id: loc.id, stage: state.stage, ...nextActionFrom(state, questions) };
}

export function addProductQuestion(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = readState(loc), questions = readQuestions(loc);
    const questionText = text(options.question, "question", 8_192); const normalized = normalizeQuestion(questionText);
    if (questions.items.some((item) => normalizeQuestion(item.text) === normalized)) throw new Error("duplicate product question rejected");
    if (questions.items.length >= MAX_QUESTIONS) throw new Error("product question budget exceeded");
    const priority = Number(options.priority ?? 50);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error("question priority must be an integer from 0 to 100");
    const id = text(options.questionId ?? `Q-${crypto.randomUUID()}`, "question id", 128);
    if (questions.items.some((item) => item.id === id)) throw new Error(`question ${id} already exists`);
    const item = { id, text: questionText, rationale: text(options.rationale, "question rationale", 8_192), decision_id: text(options.decisionId ?? `DEC-${id}`, "decision id", 128), priority, stage: options.stage ? text(options.stage, "question stage", 64).toUpperCase() : state.stage, status: "OPEN", created_at: now, created_by: text(options.actor ?? "agent", "question actor", 256), answer: null };
    questions.items.push(item); writeQuestions(loc, questions, now);
    if (Object.keys(state.approvals).length) { invalidateApprovalsForDiscoveryChange(state); writeState(loc, state, now); }
    appendEvent(loc, "QUESTION_ADDED", { id, priority, stage: item.stage }, now);
    return { schema_version: 1, status: "QUESTION_ADDED", product_id: loc.id, question: item, current_round: questionRound(readQuestions(loc)) };
  });
}

export function answerProductQuestion(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = readState(loc), questions = readQuestions(loc);
    const item = questions.items.find((candidate) => candidate.id === options.questionId);
    if (!item) throw new Error(`question ${options.questionId} does not exist`);
    if (!["OPEN", "ACTIVE", "DEFERRED"].includes(item.status)) throw new Error(`question ${item.id} is already ${item.status}`);
    const status = String(options.answerStatus ?? "ANSWERED").toUpperCase();
    if (!new Set(["ANSWERED", "DEFERRED"]).has(status)) throw new Error("answer status must be ANSWERED or DEFERRED");
    const answer = status === "ANSWERED" ? text(options.answer, "answer", 64 * 1024) : text(options.answer ?? "Deferred by the user", "defer reason", 8_192);
    item.status = status; item.answer = { text: answer, actor: text(options.actor ?? "user", "answer actor", 256), source: text(options.source ?? "USER_STATEMENT", "answer source", 2_048), answered_at: now };
    if (status === "ANSWERED") {
      state.context.confirmed.push({ question_id: item.id, question: item.text, statement: answer, source: item.answer.source, recorded_at: now });
      if (state.stage === "IDEA") state.stage = "DISCOVERY";
    }
    invalidateApprovalsForDiscoveryChange(state);
    writeQuestions(loc, questions, now);
    writeState(loc, state, now); appendEvent(loc, "QUESTION_ANSWERED", { id: item.id, status, actor: item.answer.actor }, now);
    return { schema_version: 1, status, product_id: loc.id, question_id: item.id, current_round: questionRound(readQuestions(loc)), next_action: nextActionFrom(readState(loc), readQuestions(loc)) };
  });
}

export function recordProductContext(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  const category = String(options.category ?? "CONFIRMED").replaceAll("-", "_").toUpperCase();
  const target = { CONFIRMED: "confirmed", ASSUMPTION: "assumptions", UNKNOWN: "unknowns", CHANGED: "changed" }[category];
  if (!target) throw new Error("context category must be CONFIRMED, ASSUMPTION, UNKNOWN, or CHANGED");
  return withLock(loc, options, () => {
    const state = readState(loc);
    const statement = text(options.statement, "context statement", 32 * 1024);
    assertNoRestrictedData(statement, "context statement");
    const record = {
      id: text(options.contextId ?? `CTX-${crypto.randomUUID()}`, "context id", 128), statement,
      source: text(options.source ?? "USER_STATEMENT", "context source", 2_048),
      recorded_by: text(options.actor ?? "user", "context actor", 256), recorded_at: now
    };
    const allContext = Object.values(state.context).flat();
    if (allContext.some((item) => item.id === record.id)) throw new Error(`context ${record.id} already exists`);
    if (target === "changed") {
      record.supersedes = text(options.supersedes, "superseded context id", 128);
      record.rationale = text(options.rationale, "change rationale", 8_192);
      if (!allContext.some((item) => item.id === record.supersedes)) throw new Error(`superseded context ${record.supersedes} does not exist`);
    }
    state.context[target].push(record);
    if (state.stage === "IDEA") state.stage = "DISCOVERY";
    invalidateApprovalsForDiscoveryChange(state);
    const saved = writeState(loc, state, now);
    appendEvent(loc, "CONTEXT_RECORDED", { id: record.id, category, source: record.source }, now);
    return { schema_version: 1, status: "CONTEXT_RECORDED", product_id: loc.id, category, context: record, next_action: nextActionFrom(saved, readQuestions(loc)) };
  });
}

function prerequisite(state, questions, type) {
  if (type === "discovery-validation" && !approved(state, "DISCOVERY_DECISION", discoveryHash(state, questions))) throw new Error("discovery validation requires the current discovery approval");
  if (["business-viability", "trust-compliance", "data-lifecycle"].includes(type) && !approved(state, "ALPHA_DECISION", alphaHash(state))) throw new Error(`${type} requires the current Alpha approval`);
  if (["brd", "business-rules"].includes(type) && !approved(state, "INVESTMENT_DECISION", investmentHash(state))) throw new Error(`${type} requires the current investment approval`);
  if (["specification", "design"].includes(type) && !approvedBusinessRequirements(state)) throw new Error(`${type} requires the current BRD and business-rule approval`);
  if (type === "design" && !artifactHead(state, "specification")) throw new Error("design requires the current product specification");
  if (type === "delivery" && !approved(state, "SOLUTION_BASELINE", solutionHash(state))) throw new Error("delivery requires the current solution baseline approval");
  if (["iteration-plan", "verification"].includes(type) && !approved(state, "DELIVERY_BASELINE", artifactHead(state, "delivery")?.hash)) throw new Error(`${type} requires the current delivery baseline approval`);
  if (type === "iteration-review" && !artifactHead(state, "iteration-plan")) throw new Error("iteration review requires a current iteration plan");
  if (["production-readiness", "product-analytics", "support-readiness", "pilot-evaluation"].includes(type) && (!artifactHead(state, "iteration-review") || state.convergence?.status !== "CONVERGED")) throw new Error(`${type} requires a reviewed iteration and current convergence`);
  if (type === "outcome" && !approved(state, "RELEASE_DECISION", state.release_candidate?.hash)) throw new Error("outcome requires the current release decision approval");
  if (type === "retirement" && state.stage !== "OPERATING" && state.stage !== "MONITORING") throw new Error("retirement planning requires an operating product");
}

function stageForArtifact(state, type, artifact) {
  if (type === "idea") return Object.values(state.approvals).some((item) => item?.status === "CURRENT") ? "NEEDS_DECISION" : "DISCOVERY";
  if (type === "research") {
    if (artifact.decision?.recommendation === "STOP") return "RETIRED";
    if (artifact.decision?.recommendation === "PAUSE") return "PAUSED";
    return "RESEARCHED";
  }
  if (type === "discovery-validation") return "ALPHA_REVIEW";
  if (["business-viability", "trust-compliance", "data-lifecycle"].includes(type)) return "INVESTMENT_REVIEW";
  if (type === "brd" || type === "business-rules") return "BRD_DRAFT";
  if (type === "specification") return "SPEC_DRAFT";
  if (type === "design") return "DESIGN_DRAFT";
  if (type === "delivery") return "DELIVERY_PLANNED";
  if (type === "iteration-plan") return "ITERATING";
  if (type === "iteration-review") return "IMPLEMENTING";
  if (type === "verification") return state.convergence?.status === "CONVERGED" ? "VERIFIED" : state.stage;
  if (["production-readiness", "product-analytics", "support-readiness"].includes(type)) return "PRODUCTION_REVIEW";
  if (type === "retirement") return "RETIREMENT_REVIEW";
  if (type === "outcome") return "OPERATING";
  return state.stage;
}

export function putProductArtifact(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp), type = safeArtifactType(options.type);
  return withLock(loc, options, () => {
    const state = readState(loc), questions = readQuestions(loc); prerequisite(state, questions, type);
    const input = boundedJson(loc.root, options.file, `${type} input`);
    assertNoRestrictedData(input, `${type} input`);
    const findings = standaloneFindings(type, input);
    if (findings.some((item) => item.severity === "BLOCKER")) throw new Error(findings.map((item) => `${item.code}: ${item.message}`).join("; "));
    const professionalEvidence = artifactEvidenceIds(input);
    if (professionalEvidence.length) requireEvidenceReceipts(loc, state, professionalEvidence, now, { minimumTrust: "REPOSITORY_BOUND" });
    if (type === "discovery-validation") {
      const expected = ["idea", "research"].map((sourceType) => artifactHead(state, sourceType)).filter(Boolean).map((head) => `${head.id}@${head.version}`);
      for (const version of expected) if (!input.source_versions.includes(version)) throw new Error(`discovery validation does not reference current source ${version}`);
    }
    if (["business-viability", "trust-compliance", "data-lifecycle"].includes(type)) {
      const expected = artifactHead(state, "discovery-validation");
      if (Array.isArray(input.source_versions) && expected && !input.source_versions.includes(`${expected.id}@${expected.version}`)) throw new Error(`${type} does not reference current discovery validation ${expected.id}@${expected.version}`);
    }
    if (type === "iteration-plan") {
      const delivery = readHead(loc, state, "delivery"), itemIds = new Set((delivery?.items ?? []).map((item) => item.id));
      for (const id of input.item_ids) if (!itemIds.has(id)) throw new Error(`iteration plan references unknown delivery item ${id}`);
      const requiredHashes = [artifactHead(state, "delivery")?.hash, solutionHash(state)].filter(Boolean);
      for (const hash of requiredHashes) if (!input.baseline_hashes.includes(hash)) throw new Error(`iteration plan does not bind current baseline ${hash}`);
    }
    if (type === "iteration-review") {
      const plan = readHead(loc, state, "iteration-plan");
      if (input.iteration_id !== plan.iteration_id) throw new Error("iteration review does not match the current iteration plan");
      const acceptanceIds = new Set((readHead(loc, state, "specification")?.acceptance_criteria ?? []).map((item) => item.id));
      for (const item of input.acceptance) if (!acceptanceIds.has(item.id)) throw new Error(`iteration review references unknown acceptance criterion ${item.id}`);
      for (const change of input.changes) if (change.material === true && !["PROPAGATED", "REAPPROVAL_REQUIRED"].includes(change.propagation_status)) throw new Error(`material change ${change.id ?? "unknown"} must be propagated or marked for reapproval`);
    }
    const previous = artifactHead(state, type); const expectedVersion = previous ? previous.version + 1 : 1;
    if (input.version !== expectedVersion) throw new Error(`${type} version must be ${expectedVersion}`);
    const base = structuredClone(input); delete base.content_hash;
    base.recorded_at = now; base.parent_hash = previous?.hash ?? null;
    const artifact = { ...base, content_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/artifacts/${type}/v${artifact.version}.json`;
    const target = path.join(loc.root, relative);
    if (fs.existsSync(target)) throw new Error(`${type} version ${artifact.version} already exists`);
    atomicJson(target, artifact, MAX_JSON_BYTES);
    state.artifact_heads[type] = artifactReference(type, artifact, relative);
    state.stage = stageForArtifact(state, type, artifact);
    const downstream = {
      idea: APPROVAL_TYPES, research: APPROVAL_TYPES,
      "discovery-validation": ["ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      "business-viability": ["INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      "trust-compliance": ["INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      "data-lifecycle": ["INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION", "RETIREMENT_DECISION"],
      brd: ["BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      "business-rules": ["BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      specification: ["SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      design: ["SOLUTION_BASELINE", "DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      delivery: ["DELIVERY_BASELINE", "GITHUB_ISSUE_PLAN", "PRODUCTION_READINESS", "RELEASE_DECISION"],
      "iteration-plan": ["PRODUCTION_READINESS", "RELEASE_DECISION"], "iteration-review": ["PRODUCTION_READINESS", "RELEASE_DECISION"],
      verification: ["PRODUCTION_READINESS", "RELEASE_DECISION"], "production-readiness": ["PRODUCTION_READINESS", "RELEASE_DECISION"],
      "product-analytics": ["PRODUCTION_READINESS", "RELEASE_DECISION"], "support-readiness": ["PRODUCTION_READINESS", "RELEASE_DECISION"],
      "pilot-evaluation": ["PRODUCTION_READINESS", "RELEASE_DECISION"], outcome: [], retirement: ["RETIREMENT_DECISION"]
    };
    staleApprovals(state, downstream[type]);
    if (["brd", "business-rules", "specification", "design", "delivery"].includes(type)) state.convergence = null;
    if (new Set(downstream[type]).has("RELEASE_DECISION")) state.release_candidate = null;
    if (type === "iteration-plan") state.iterations[input.iteration_id] = { plan_hash: artifact.content_hash, plan_path: relative, status: "ACTIVE" };
    if (type === "iteration-review") state.iterations[input.iteration_id] = { ...(state.iterations[input.iteration_id] ?? {}), review_hash: artifact.content_hash, review_path: relative, status: "REVIEWED" };
    const saved = writeState(loc, state, now); appendEvent(loc, "ARTIFACT_RECORDED", { type, id: artifact.id, version: artifact.version, hash: artifact.content_hash, path: relative }, now);
    return { schema_version: 1, status: "RECORDED", product_id: loc.id, artifact: saved.artifact_heads[type], stage: saved.stage, next_action: nextActionFrom(saved, readQuestions(loc)) };
  });
}

export function analyzeProduct(options = {}) {
  const loc = location(options), state = readState(loc), questions = readQuestions(loc);
  const gate = options.gate ? text(options.gate, "analysis gate", 64).toUpperCase() : gateForState(state, questions);
  if (!new Set(["DISCOVERY_DECISION", "ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "PRODUCTION_READINESS", "RELEASE_DECISION", "RETIREMENT_DECISION"]).has(gate)) throw new Error("unsupported product analysis gate");
  const report = analysis(loc, state, questions, gate, timestamp(options.timestamp));
  if (options.write) {
    const relative = `.ai/products/${loc.id}/analysis/${report.analysis_hash}.json`;
    atomicJson(path.join(loc.root, relative), report, MAX_JSON_BYTES);
    return { ...report, artifact: relative };
  }
  return report;
}

function approvalTarget(loc, state, questions, type) {
  if (type === "DISCOVERY_DECISION") return { artifact_id: `DISCOVERY-${state.id}`, artifact_version: artifactHead(state, "research")?.version ?? 1, artifact_hash: discoveryHash(state, questions), members: [artifactHead(state, "idea"), artifactHead(state, "research")].filter(Boolean) };
  if (type === "ALPHA_DECISION") { const head = artifactHead(state, "discovery-validation"), hash = alphaHash(state); if (!head || !hash) throw new Error("Alpha validation artifact is missing"); return { artifact_id: head.id, artifact_version: head.version, artifact_hash: hash, members: [head] }; }
  if (type === "INVESTMENT_DECISION") { const hash = investmentHash(state), members = ["business-viability", "trust-compliance", "data-lifecycle"].map((item) => artifactHead(state, item)).filter(Boolean); if (!hash || members.length !== 3) throw new Error("investment baseline is incomplete"); return { artifact_id: `INVESTMENT-${state.id}`, artifact_version: Math.max(...members.map((item) => item.version)), artifact_hash: hash, members }; }
  if (type === "BUSINESS_REQUIREMENTS") { const head = artifactHead(state, "brd"), hash = businessRequirementsHash(state); if (!head || !hash) throw new Error("business requirements artifacts are missing"); return { artifact_id: head.id, artifact_version: Math.max(...businessRequirementsMembers(state).map((item) => item.version)), artifact_hash: hash, members: businessRequirementsMembers(state) }; }
  if (type === "SOLUTION_BASELINE") { const hash = solutionHash(state); if (!hash) throw new Error("solution baseline is incomplete"); return { artifact_id: `SOLUTION-${state.id}`, artifact_version: Math.max(...solutionMembers(state).map((item) => item.version)), artifact_hash: hash, members: solutionMembers(state) }; }
  if (type === "DELIVERY_BASELINE") { const head = artifactHead(state, "delivery"); if (!head) throw new Error("delivery artifact is missing"); return { artifact_id: head.id, artifact_version: head.version, artifact_hash: head.hash, members: [head] }; }
  if (type === "GITHUB_ISSUE_PLAN") { if (!state.github_plan) throw new Error("GitHub issue plan is missing"); return { artifact_id: state.github_plan.id, artifact_version: 1, artifact_hash: state.github_plan.hash, members: [state.github_plan] }; }
  if (type === "PRODUCTION_READINESS") { const hash = productionReadinessHash(state), members = productionReadinessMembers(state); if (!hash) throw new Error("production-readiness dossier is incomplete"); return { artifact_id: `PRODUCTION-READINESS-${state.id}`, artifact_version: Math.max(...members.map((item) => item.version)), artifact_hash: hash, members }; }
  if (type === "RELEASE_DECISION") { if (!state.release_candidate) throw new Error("release-candidate dossier is missing"); return { artifact_id: state.release_candidate.id, artifact_version: 1, artifact_hash: state.release_candidate.hash, members: [state.release_candidate] }; }
  const head = artifactHead(state, "retirement"); if (!head) throw new Error("retirement plan is missing"); return { artifact_id: head.id, artifact_version: head.version, artifact_hash: head.hash, members: [head] };
}

export function approveProductBaseline(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp), type = text(options.type, "approval type", 64).toUpperCase();
  if (!APPROVAL_TYPES.has(type)) throw new Error(`approval type must be one of ${[...APPROVAL_TYPES].join(", ")}`);
  return withLock(loc, options, () => {
    const state = readState(loc), questions = readQuestions(loc), decision = String(options.decision ?? "APPROVED").toUpperCase();
    if (!APPROVAL_DECISIONS.has(decision)) throw new Error("approval decision is invalid");
    const approver = text(options.approver, "approver", 256), authority = text(options.authority, "approver authority", 512);
    if (String(options.approverType ?? "HUMAN").toUpperCase() !== "HUMAN" || /(^|[:\s])(agent|bot)([:\s]|$)/i.test(approver)) throw new Error("product baselines require a named human approver");
    const scope = values(options.scope).map((item) => text(item, "approval scope", 4_096));
    if (!scope.length) throw new Error("approval requires at least one exact scope item");
    const target = approvalTarget(loc, state, questions, type);
    const gate = type === "GITHUB_ISSUE_PLAN" ? null : type;
    const report = gate ? analysis(loc, state, questions, gate, now) : null;
    if (decision === "APPROVED" && report && report.status !== "READY_FOR_APPROVAL") throw new Error(`approval blocked: ${report.findings.filter((item) => item.severity === "BLOCKER").map((item) => item.code).join(", ")}`);
    const base = {
      schema_version: 1, id: `APPROVAL-${loc.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${type.replaceAll("_", "-")}-${now.replace(/[^0-9]/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      artifact_id: target.artifact_id, artifact_type: type, artifact_version: target.artifact_version, artifact_hash: target.artifact_hash,
      decision, approver, approver_type: "HUMAN", approver_authority: authority, decided_at: now,
      scope, constraints: values(options.constraints).map((item) => text(item, "approval constraint", 4_096)), rationale: text(options.rationale ?? `Human ${decision.toLowerCase()} for ${type}`, "approval rationale", 8_192), accepted_risks: values(options.acceptedRisks).map((item) => text(item, "accepted risk", 4_096)), bundle_members: target.members
    };
    const record = { ...base, approval_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/approvals/${record.id}.json`;
    atomicJson(path.join(loc.root, relative), record, MAX_JSON_BYTES);
    state.approvals[type] = { id: record.id, decision, artifact_hash: record.artifact_hash, approval_hash: record.approval_hash, approver, decided_at: now, path: relative, status: decision === "APPROVED" ? "CURRENT" : decision };
    if (decision === "APPROVED") {
      if (type === "DISCOVERY_DECISION") state.stage = "RESEARCHED";
      if (type === "ALPHA_DECISION") state.stage = "ALPHA_APPROVED";
      if (type === "INVESTMENT_DECISION") state.stage = "INVESTMENT_APPROVED";
      if (type === "BUSINESS_REQUIREMENTS") state.stage = "BRD_APPROVED";
      if (type === "SOLUTION_BASELINE") state.stage = "SPEC_APPROVED";
      if (type === "DELIVERY_BASELINE") state.stage = "IMPLEMENTING";
      if (type === "PRODUCTION_READINESS") state.stage = "RELEASE_CANDIDATE";
      if (type === "RELEASE_DECISION") state.stage = "OPERATING";
      if (type === "RETIREMENT_DECISION") state.stage = readHead(loc, state, "retirement")?.decision === "RETIRE" ? "RETIRED" : "OPERATING";
    } else if (type !== "GITHUB_ISSUE_PLAN") state.stage = decision;
    const saved = writeState(loc, state, now); appendEvent(loc, "BASELINE_DECIDED", { approval_type: type, decision, artifact_hash: record.artifact_hash, approval_hash: record.approval_hash, approver }, now);
    return { schema_version: 1, status: decision, product_id: loc.id, stage: saved.stage, approval: saved.approvals[type], next_action: nextActionFrom(saved, questions) };
  });
}

function restrictedGitHubContent(value) {
  return SECRET_LIKE_VALUE.test(value);
}

export function planProductGithubIssues(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = readState(loc), questions = readQuestions(loc), delivery = readHead(loc, state, "delivery");
    if (!delivery || !approved(state, "DELIVERY_BASELINE", artifactHead(state, "delivery")?.hash)) throw new Error("GitHub issue planning requires the current delivery baseline approval");
    const repository = text(options.repository ?? options.repo, "GitHub repository", 256);
    if (!REPOSITORY.test(repository)) throw new Error("GitHub repository must use owner/name format");
    const items = delivery.items.map((item) => {
      const marker = `<!-- ai-agent-kit-product:${loc.id}:item:${item.id}:delivery:${artifactHead(state, "delivery").hash} -->`;
      const title = `[${item.id}] ${text(item.title, "delivery item title", 256)}`;
      const body = [marker, `## Outcome\n\n${item.outcome}`, `## Requirements\n\n${(item.requirement_ids ?? []).map((id) => `- \`${id}\``).join("\n") || "- None"}`, `## Acceptance\n\n${(item.acceptance_ids ?? []).map((id) => `- \`${id}\``).join("\n") || "- Defined by approved baseline"}`, `## Dependencies\n\n${(item.dependencies ?? []).map((id) => `- \`${id}\``).join("\n") || "- None"}`, `## Assurance\n\n${(item.assurance ?? []).map((value) => `- ${value}`).join("\n") || "- Follow approved Definition of Done"}`, `\nProduct: \`${loc.id}\` · Delivery baseline: \`${artifactHead(state, "delivery").hash}\``].join("\n\n");
      if (restrictedGitHubContent(`${title}\n${body}`)) throw new Error(`delivery item ${item.id} contains restricted secret-like content`);
      return { id: item.id, type: item.type, title, body, marker, parent_id: item.parent_id ?? null, dependencies: item.dependencies ?? [], milestone: item.milestone_id ?? null };
    });
    const base = { schema_version: 1, id: `GITHUB-PLAN-${loc.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`, product_id: loc.id, repository, created_at: now, delivery_hash: artifactHead(state, "delivery").hash, solution_hash: solutionHash(state), items, mutates_external_state: false, apply_requires_approval: true };
    const plan = { ...base, plan_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/github/issue-plan-${plan.plan_hash}.json`;
    atomicJson(path.join(loc.root, relative), plan, MAX_JSON_BYTES);
    if (state.approvals.GITHUB_ISSUE_PLAN && state.approvals.GITHUB_ISSUE_PLAN.artifact_hash !== plan.plan_hash) state.approvals.GITHUB_ISSUE_PLAN.status = "STALE";
    state.github_plan = { id: plan.id, hash: plan.plan_hash, repository, item_count: items.length, path: relative };
    const saved = writeState(loc, state, now); appendEvent(loc, "GITHUB_PLAN_CREATED", { plan_hash: plan.plan_hash, repository, item_count: items.length }, now);
    return { schema_version: 1, status: "PREVIEW", product_id: loc.id, plan, artifact: relative, approval_required: { type: "GITHUB_ISSUE_PLAN", artifact_hash: plan.plan_hash }, next_action: nextActionFrom(saved, questions) };
  });
}

function runGhDefault(args, input, cwd) {
  return spawnSync("gh", args, { cwd, input, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
}

function ghResult(result, operation) {
  if (result.status !== 0) throw new Error(`${operation} failed: ${String(result.stderr || result.stdout || "unknown error").replace(/[\r\n]+/g, " ").slice(0, 512)}`);
  return String(result.stdout ?? "").trim();
}

function readGitHubPlan(loc, state) {
  if (!state.github_plan) throw new Error("GitHub issue plan is missing");
  const plan = boundedJson(loc.root, state.github_plan.path, "GitHub issue plan");
  const copy = structuredClone(plan); const claimed = copy.plan_hash; delete copy.plan_hash;
  if (claimed !== state.github_plan.hash || claimed !== productDigest(copy)) throw new Error("GitHub issue plan hash mismatch");
  return plan;
}

function githubSyncAuthorization(loc, plan) {
  const repositoryId = resolveTeamControlStoreLocation({ target: loc.root }).repository_id;
  const payload = {
    protocol: "aak-product-github-sync-v1",
    product_id: loc.id,
    plan_hash: plan.plan_hash,
    repository: plan.repository,
    operation: PRODUCT_GITHUB_SYNC_OPERATION
  };
  return {
    repository_id: repositoryId,
    task_id: loc.id,
    operation: PRODUCT_GITHUB_SYNC_OPERATION,
    payload_hash: teamControlDigest(payload),
    required_capability: PRODUCT_GITHUB_SYNC_CAPABILITY,
    allowed_principal_types: ["MEMBER"],
    allowed_roles: ["operator", "team-lead"]
  };
}

function authorizeGithubSync(loc, plan, options, now) {
  const requirement = githubSyncAuthorization(loc, plan);
  return withTeamControlStore({ target: loc.root }, (store) => {
    const identity = verifyTeamIdentityAuthentication(options.identity, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId) });
    if (identity.authentication.method !== "ED25519") throw new Error("GitHub synchronization requires repository-trusted Ed25519 authentication");
    if (identity.type !== "MEMBER") throw new Error("GitHub synchronization requires a repository-trusted MEMBER identity");
    if (!identity.roles.some((role) => requirement.allowed_roles.includes(role))) throw new Error("GitHub synchronization requires operator or team-lead role");
    requireTeamCapability(identity, requirement.required_capability);
    const action = verifySignedTeamAction(options.actionEnvelope, {
      now,
      resolveIdentityKey: (keyId) => store.getTrustedKey(keyId),
      repositoryId: requirement.repository_id,
      taskId: requirement.task_id,
      operation: requirement.operation,
      payloadHash: requirement.payload_hash
    });
    if (action.principal_id !== identity.principal_id || action.key_id !== identity.authentication.key_id) throw new Error("signed GitHub action principal or key does not match the authenticated member");
    store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
    return {
      ...requirement,
      principal_id: identity.principal_id,
      key_id: action.key_id,
      nonce: action.nonce,
      authorization_hash: teamControlDigest({ ...requirement, principal_id: identity.principal_id, key_id: action.key_id, nonce: action.nonce, expires_at: action.expires_at })
    };
  });
}

function sealGitHubLedger(ledger) {
  const copy = structuredClone(ledger); delete copy.sync_hash;
  return { ...copy, sync_hash: productDigest(copy) };
}

function writeGitHubLedger(file, ledger) {
  const sealed = sealGitHubLedger(ledger);
  atomicJson(file, sealed, MAX_JSON_BYTES);
  return sealed;
}

function readGitHubLedger(loc, relative) {
  const ledger = boundedJson(loc.root, relative, "GitHub sync ledger");
  const copy = structuredClone(ledger), claimed = copy.sync_hash; delete copy.sync_hash;
  if (!claimed || claimed !== productDigest(copy)) throw new Error("GitHub sync ledger integrity verification failed");
  return ledger;
}

export function syncProductGithubIssues(options = {}, deps = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  if (!options.apply) {
    const state = readState(loc), plan = readGitHubPlan(loc, state);
    return { schema_version: 1, status: "PREVIEW", product_id: loc.id, plan_hash: plan.plan_hash, repository: plan.repository, item_count: plan.items.length, mutates_external_state: false, authorization: githubSyncAuthorization(loc, plan), required: ["explicit --apply", "current human GITHUB_ISSUE_PLAN approval", "exact approval hash", "repository-trusted signed MEMBER action"] };
  }
  return withLock(loc, options, () => {
    const state = readState(loc), plan = readGitHubPlan(loc, state), approval = state.approvals.GITHUB_ISSUE_PLAN;
    if (!approval || approval.decision !== "APPROVED" || approval.artifact_hash !== plan.plan_hash || approval.status !== "CURRENT" || approval.approval_hash !== options.approvalHash) throw new Error("GitHub synchronization requires the current exact human approval hash");
    const confirmedAbsent = new Set(values(options.confirmAbsent).map((item) => text(item, "confirmed-absent delivery item", 128)));
    const planIds = new Set(plan.items.map((item) => item.id));
    for (const itemId of confirmedAbsent) if (!planIds.has(itemId)) throw new Error(`confirmed-absent item ${itemId} is not in the approved GitHub plan`);
    if (readEvents(loc).length + confirmedAbsent.size + 1 > MAX_EVENTS) throw new Error("product event ledger has insufficient capacity for this GitHub synchronization");
    const authorization = authorizeGithubSync(loc, plan, options, now);
    const runGh = deps.runGh ?? ((args, input) => runGhDefault(args, input, loc.root));
    const issueUrl = (value) => {
      if (typeof value !== "string") return null;
      const prefix = `https://github.com/${plan.repository}/issues/`;
      if (!value.startsWith(prefix) || !/^\d+$/.test(value.slice(prefix.length))) return null;
      return value;
    };
    const remoteRaw = ghResult(runGh(["issue", "list", "--repo", plan.repository, "--state", "all", "--limit", "1000", "--json", "number,url,title,body"]), "GitHub issue inventory");
    let remote;
    try { remote = JSON.parse(remoteRaw || "[]"); } catch { throw new Error("GitHub issue inventory returned invalid JSON"); }
    if (!Array.isArray(remote) || remote.length > 1_000) throw new Error("GitHub issue inventory must be an array of at most 1000 issues");
    const remoteByMarker = new Map();
    for (const issue of remote) {
      const url = issueUrl(issue?.url);
      if (!url || typeof issue.body !== "string") continue;
      for (const item of plan.items) if (issue.body.includes(item.marker)) remoteByMarker.set(item.marker, { number: Number(url.split("/").at(-1)), url, title: typeof issue.title === "string" ? issue.title.slice(0, 256) : "" });
    }
    const ledgerFile = path.join(loc.directory, "github", `sync-${plan.plan_hash}.json`);
    let ledger = { schema_version: 1, product_id: loc.id, plan_hash: plan.plan_hash, repository: plan.repository, items: {}, updated_at: now };
    if (fs.existsSync(ledgerFile)) ledger = readGitHubLedger(loc, path.relative(loc.root, ledgerFile));
    if (ledger.product_id !== loc.id || ledger.plan_hash !== plan.plan_hash || ledger.repository !== plan.repository || !ledger.items || typeof ledger.items !== "object" || Array.isArray(ledger.items)) throw new Error("GitHub sync ledger contract is invalid");
    ledger.last_authorization_hash = authorization.authorization_hash;
    const created = [], skipped = [];
    for (const item of plan.items) {
      const ledgerEntry = ledger.items[item.id], remoteEntry = remoteByMarker.get(item.marker);
      const existingUrl = issueUrl(remoteEntry?.url) ?? issueUrl(ledgerEntry?.url);
      if (existingUrl) { ledger.items[item.id] = { number: Number(existingUrl.split("/").at(-1)), url: existingUrl, marker: item.marker, status: remoteEntry ? "EXISTING" : ledgerEntry.status }; skipped.push({ id: item.id, url: existingUrl }); continue; }
      if (ledgerEntry && ["CREATING", "UNKNOWN_EXTERNAL_RESULT"].includes(ledgerEntry.status)) {
        if (!confirmedAbsent.has(item.id)) {
          ledger.updated_at = now; ledger.last_error = `Remote outcome for ${item.id} is ambiguous; verify GitHub and retry with --confirm-absent ${item.id} only when no matching issue exists`; ledger = writeGitHubLedger(ledgerFile, ledger);
          return { schema_version: 1, status: "RECONCILIATION_REQUIRED", product_id: loc.id, plan_hash: plan.plan_hash, repository: plan.repository, created, skipped, failed_item: item.id, error: ledger.last_error, retry_safe: false, requires_remote_confirmation: true, authorization_hash: authorization.authorization_hash };
        }
        delete ledger.items[item.id]; ledger.updated_at = now; ledger = writeGitHubLedger(ledgerFile, ledger);
        appendEvent(loc, "GITHUB_SYNC_RECONCILED_ABSENT", { plan_hash: plan.plan_hash, repository: plan.repository, item_id: item.id, approval_hash: approval.approval_hash, authorization_hash: authorization.authorization_hash }, now);
      } else if (ledgerEntry) throw new Error(`GitHub sync ledger contains an invalid entry for ${item.id}`);
      ledger.items[item.id] = { number: null, url: null, marker: item.marker, status: "CREATING", attempted_at: now };
      ledger.updated_at = now; ledger = writeGitHubLedger(ledgerFile, ledger);
      try {
        const output = ghResult(runGh(["issue", "create", "--repo", plan.repository, "--title", item.title, "--body-file", "-"], item.body), `GitHub issue create ${item.id}`);
        const url = output.split(/\s+/).map((value) => value.trim()).find((value) => issueUrl(value));
        if (!url) throw new Error(`GitHub issue create ${item.id} did not return an issue URL for ${plan.repository}`);
        ledger.items[item.id] = { number: Number(url.split("/").at(-1)), url, marker: item.marker, status: "CREATED" };
        ledger.updated_at = now; ledger = writeGitHubLedger(ledgerFile, ledger); created.push({ id: item.id, url });
      } catch (error) {
        ledger.items[item.id] = { ...ledger.items[item.id], status: "UNKNOWN_EXTERNAL_RESULT" };
        ledger.updated_at = now; ledger.last_error = String(error instanceof Error ? error.message : error).slice(0, 512); ledger = writeGitHubLedger(ledgerFile, ledger);
        appendEvent(loc, "GITHUB_SYNC_PARTIAL", { plan_hash: plan.plan_hash, repository: plan.repository, created: created.length, skipped: skipped.length, failed_item: item.id, approval_hash: approval.approval_hash, authorization_hash: authorization.authorization_hash }, now);
        return { schema_version: 1, status: "PARTIAL", product_id: loc.id, plan_hash: plan.plan_hash, repository: plan.repository, created, skipped, failed_item: item.id, error: ledger.last_error, retry_safe: false, requires_remote_confirmation: true, authorization_hash: authorization.authorization_hash };
      }
    }
    ledger.updated_at = now; delete ledger.last_error; ledger = writeGitHubLedger(ledgerFile, ledger);
    appendEvent(loc, "GITHUB_SYNC_APPLIED", { plan_hash: plan.plan_hash, repository: plan.repository, created: created.length, skipped: skipped.length, approval_hash: approval.approval_hash, authorization_hash: authorization.authorization_hash }, now);
    return { schema_version: 1, status: "APPLIED", product_id: loc.id, plan_hash: plan.plan_hash, repository: plan.repository, created, skipped, authorization_hash: authorization.authorization_hash, duplicate_protection: "LOCAL_LEDGER_AND_REMOTE_MARKER", ledger: path.relative(loc.root, ledgerFile).split(path.sep).join("/") };
  });
}

export function recordProductEvidence(options = {}, deps = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = ensureProfessionalState(readState(loc));
    const input = boundedJson(loc.root, options.file, "product evidence receipt input");
    assertNoRestrictedData(input, "product evidence receipt input");
    if (!input || typeof input !== "object" || Array.isArray(input) || input.schema_version !== 1) throw new Error("product evidence receipt must be a schema_version 1 object");
    const id = evidenceId(input.id);
    if (state.evidence_receipts[id]) throw new Error(`evidence receipt ${id} already exists and is immutable`);
    if (Object.keys(state.evidence_receipts).length >= 1_000) throw new Error("product evidence receipt budget is exhausted");
    const kind = text(input.kind, "evidence kind", 64).toUpperCase();
    if (!EVIDENCE_KINDS.has(kind)) throw new Error(`evidence kind must be one of ${[...EVIDENCE_KINDS].join(", ")}`);
    const status = text(input.status, "evidence status", 64).toUpperCase();
    if (!EVIDENCE_STATUSES.has(status)) throw new Error(`evidence status must be one of ${[...EVIDENCE_STATUSES].join(", ")}`);
    const trustLevel = evidenceTrust(input.trust_level);
    const collectedAt = timestamp(input.collected_at), expiresAt = timestamp(input.expires_at);
    if (Date.parse(expiresAt) <= Date.parse(collectedAt)) throw new Error("evidence expires_at must be after collected_at");
    if (Date.parse(collectedAt) > Date.parse(now)) throw new Error("evidence cannot be collected in the future");
    if (Date.parse(expiresAt) <= Date.parse(now)) throw new Error("evidence receipt is already expired");
    const repository = currentRepository(loc.root);
    const suppliedRepository = input.repository ?? {};
    if (EVIDENCE_TRUST_RANK[trustLevel] >= EVIDENCE_TRUST_RANK.REPOSITORY_BOUND) {
      if (String(suppliedRepository.commit ?? "").toLowerCase() !== repository.commit) throw new Error("repository-bound evidence must name the current full Git commit");
      if (suppliedRepository.remote && normalizedRemote(suppliedRepository.remote) !== repository.remote) throw new Error("evidence repository remote does not match the current repository");
    }
    let subject = null;
    if (input.subject?.path) {
      const resolved = relativeInside(loc.root, text(input.subject.path, "evidence subject path", 4_096), "evidence subject");
      const measured = sha256File(resolved.absolute);
      if (!SHA256.test(input.subject.sha256 ?? "") || input.subject.sha256 !== measured.sha256) throw new Error("evidence subject SHA-256 does not match the current file");
      if (input.subject.size !== undefined && Number(input.subject.size) !== measured.size) throw new Error("evidence subject size does not match the current file");
      subject = { path: resolved.relative, sha256: measured.sha256, size: measured.size };
    }
    if (["LOCAL_VERIFIED", "REPOSITORY_BOUND"].includes(trustLevel) && !subject && kind !== "GIT_COMMIT") throw new Error(`${trustLevel} evidence requires a current repository file subject`);
    const provider = input.provider ? {
      name: text(input.provider.name, "evidence provider name", 128),
      run_id: text(input.provider.run_id, "evidence provider run id", 512),
      url: input.provider.url ? text(input.provider.url, "evidence provider URL", 2_048) : null
    } : null;
    let mechanism = subject ? "FILE_HASH_AND_REPOSITORY" : "GIT_COMMIT";
    if (trustLevel === "PROVIDER_VERIFIED") {
      if (!provider || typeof deps.verifyProviderReceipt !== "function") throw new Error("PROVIDER_VERIFIED evidence requires an authorized provider verifier adapter");
      const verified = deps.verifyProviderReceipt(input, { repository, root: loc.root });
      if (!(verified === true || verified?.status === "VERIFIED")) throw new Error("provider verifier rejected the evidence receipt");
      mechanism = "AUTHORIZED_PROVIDER_ADAPTER";
    }
    if (trustLevel === "SIGNED_ATTESTATION") {
      if (typeof deps.verifySignedAttestation !== "function") throw new Error("SIGNED_ATTESTATION evidence requires an authorized signature verifier adapter");
      const verified = deps.verifySignedAttestation(input, { repository, root: loc.root });
      if (!(verified === true || verified?.status === "VERIFIED")) throw new Error("signature verifier rejected the evidence receipt");
      mechanism = "AUTHORIZED_SIGNATURE_ADAPTER";
    }
    if (status === "NOT_APPLICABLE" && !input.rationale?.trim()) throw new Error("NOT_APPLICABLE evidence requires a rationale");
    const base = {
      schema_version: 1, id, kind, status, trust_level: trustLevel,
      producer: text(input.producer, "evidence producer", 256), collected_at: collectedAt, expires_at: expiresAt,
      repository: { commit: repository.commit, remote: repository.remote, root_hash: repository.root_hash },
      subject, environment_attestation_id: input.environment_attestation_id ? evidenceId(input.environment_attestation_id, "environment attestation id") : null,
      provider, summary: text(input.summary, "evidence summary", 8_192),
      rationale: input.rationale ? text(input.rationale, "evidence rationale", 8_192) : null,
      limitations: values(input.limitations).map((item) => text(item, "evidence limitation", 4_096)),
      verification: { status: "VERIFIED", verified_at: now, mechanism }
    };
    const receipt = { ...base, receipt_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/evidence/${id}-${receipt.receipt_hash}.json`;
    atomicJson(path.join(loc.root, relative), receipt, MAX_JSON_BYTES);
    state.evidence_receipts[id] = { id, kind, status, trust_level: trustLevel, collected_at: collectedAt, expires_at: expiresAt, receipt_hash: receipt.receipt_hash, path: relative };
    const saved = writeState(loc, state, now);
    appendEvent(loc, "EVIDENCE_RECORDED", { id, kind, status, trust_level: trustLevel, receipt_hash: receipt.receipt_hash }, now);
    return { schema_version: 1, status: "VERIFIED", product_id: loc.id, receipt: saved.evidence_receipts[id] };
  });
}

export function verifyProductEvidence(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp), state = ensureProfessionalState(readState(loc));
  const ids = options.evidenceId ? [evidenceId(options.evidenceId)] : Object.keys(state.evidence_receipts).sort();
  const results = ids.map((id) => {
    const receipt = integrityCheckedReceipt(loc, state, id);
    const result = validateReceiptCurrent(loc, receipt, now, options.minimumTrust ? evidenceTrust(options.minimumTrust) : "SELF_DECLARED");
    return { id, kind: receipt.kind, trust_level: receipt.trust_level, receipt_hash: receipt.receipt_hash, status: result.status, reasons: result.reasons };
  });
  return { schema_version: 1, status: results.every((item) => item.status === "VERIFIED") ? "VERIFIED" : "STALE", product_id: loc.id, verified_at: now, results };
}

export function recordProductEnvironment(options = {}, deps = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = ensureProfessionalState(readState(loc));
    const input = boundedJson(loc.root, options.file, "environment attestation input");
    assertNoRestrictedData(input, "environment attestation input");
    if (!input || typeof input !== "object" || Array.isArray(input) || input.schema_version !== 1) throw new Error("environment attestation must be a schema_version 1 object");
    const id = evidenceId(input.id, "environment attestation id");
    if (state.environment_attestations[id]) throw new Error(`environment attestation ${id} already exists and is immutable`);
    if (Object.keys(state.environment_attestations).length >= 100) throw new Error("environment attestation budget is exhausted");
    const environmentClass = text(input.environment_class, "environment class", 64).toUpperCase();
    if (!ENVIRONMENT_CLASSES.has(environmentClass)) throw new Error(`environment class must be one of ${[...ENVIRONMENT_CLASSES].join(", ")}`);
    const trustLevel = evidenceTrust(input.trust_level);
    if (["STAGING", "PILOT", "PRODUCTION"].includes(environmentClass) && EVIDENCE_TRUST_RANK[trustLevel] < EVIDENCE_TRUST_RANK.PROVIDER_VERIFIED) throw new Error(`${environmentClass} environment attestation requires provider-verified or signed trust`);
    const repository = currentRepository(loc.root);
    if (String(input.repository_commit ?? "").toLowerCase() !== repository.commit) throw new Error("environment attestation must bind the current full Git commit");
    const declaredAt = timestamp(input.declared_at), expiresAt = timestamp(input.expires_at);
    if (Date.parse(expiresAt) <= Date.parse(declaredAt) || Date.parse(declaredAt) > Date.parse(now)) throw new Error("environment attestation timestamps are invalid");
    const receiptIds = evidenceReferenceValues(input.evidence_receipt_ids);
    if (!receiptIds.length) throw new Error("environment attestation requires evidence receipts");
    const receiptMinimum = ["LOCAL", "SYNTHETIC"].includes(environmentClass) ? "REPOSITORY_BOUND" : "PROVIDER_VERIFIED";
    requireEvidenceReceipts(loc, state, receiptIds, now, { minimumTrust: receiptMinimum, environmentAttestationId: id, requireCurrentCommit: true });
    if (EVIDENCE_TRUST_RANK[trustLevel] >= EVIDENCE_TRUST_RANK.PROVIDER_VERIFIED) {
      const verifier = trustLevel === "SIGNED_ATTESTATION" ? deps.verifySignedAttestation : deps.verifyProviderReceipt;
      if (typeof verifier !== "function") throw new Error(`${trustLevel} environment attestation requires an authorized verifier adapter`);
      const verified = verifier(input, { repository, root: loc.root });
      if (!(verified === true || verified?.status === "VERIFIED")) throw new Error("environment attestation verifier rejected the input");
    }
    const base = {
      schema_version: 1, id, name: text(input.name, "environment name", 256), environment_class: environmentClass,
      trust_level: trustLevel, repository_commit: repository.commit, repository_remote: repository.remote,
      declared_by: text(input.declared_by, "environment declarer", 256), declared_at: declaredAt, expires_at: expiresAt,
      provider: input.provider ? { name: text(input.provider.name, "environment provider", 128), environment_id: text(input.provider.environment_id, "provider environment id", 512), url: input.provider.url ? text(input.provider.url, "provider environment URL", 2_048) : null } : null,
      evidence_receipt_ids: receiptIds, limitations: values(input.limitations).map((item) => text(item, "environment limitation", 4_096))
    };
    const attestation = { ...base, attestation_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/environments/${id}-${attestation.attestation_hash}.json`;
    atomicJson(path.join(loc.root, relative), attestation, MAX_JSON_BYTES);
    state.environment_attestations[id] = { id, environment_class: environmentClass, trust_level: trustLevel, repository_commit: repository.commit, expires_at: expiresAt, attestation_hash: attestation.attestation_hash, path: relative };
    const saved = writeState(loc, state, now);
    appendEvent(loc, "ENVIRONMENT_ATTESTED", { id, environment_class: environmentClass, trust_level: trustLevel, attestation_hash: attestation.attestation_hash }, now);
    return { schema_version: 1, status: "VERIFIED", product_id: loc.id, environment: saved.environment_attestations[id] };
  });
}

export function prepareProductReleaseCandidate(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = ensureProfessionalState(readState(loc)), questions = readQuestions(loc);
    const readinessReport = analysis(loc, state, questions, "PRODUCTION_READINESS", now);
    if (readinessReport.status !== "READY_FOR_APPROVAL") throw new Error(`release candidate blocked: ${readinessReport.findings.filter((item) => item.severity === "BLOCKER").map((item) => item.code).join(", ")}`);
    const readinessHash = productionReadinessHash(state);
    if (!approved(state, "PRODUCTION_READINESS", readinessHash)) throw new Error("release candidate requires the current human production-readiness approval");
    const releaseClass = text(options.releaseClass ?? "LIMITED_RELEASE", "release class", 64).toUpperCase();
    if (!new Set(["LIMITED_RELEASE", "PRODUCTION"]).has(releaseClass)) throw new Error("release class must be LIMITED_RELEASE or PRODUCTION");
    const readiness = readHead(loc, state, "production-readiness"), environment = state.environment_attestations[readiness.environment_attestation_id];
    if (!environment) throw new Error("release candidate environment attestation is missing");
    if (releaseClass === "PRODUCTION" && environment.environment_class !== "PRODUCTION") throw new Error("PRODUCTION release candidate requires a PRODUCTION environment attestation");
    if (releaseClass === "LIMITED_RELEASE" && !new Set(["STAGING", "PILOT", "PRODUCTION"]).has(environment.environment_class)) throw new Error("limited release requires STAGING, PILOT, or PRODUCTION evidence");
    const repository = currentRepository(loc.root);
    const trackedStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: loc.root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (trackedStatus.status !== 0 || String(trackedStatus.stdout).trim()) throw new Error("release candidate requires a clean tracked Git worktree so the commit represents the implementation");
    const evidenceIds = [...new Set([readHead(loc, state, "production-readiness"), readHead(loc, state, "product-analytics"), readHead(loc, state, "support-readiness")].flatMap((artifact) => artifactEvidenceIds(artifact)))].sort();
    const evidence = requireEvidenceReceipts(loc, state, evidenceIds, now, { minimumTrust: "PROVIDER_VERIFIED", environmentAttestationId: environment.id, requireCurrentCommit: true });
    const baselineHashes = Object.fromEntries(Object.entries(state.artifact_heads).map(([type, head]) => [type, head.hash]));
    const approvalHashes = Object.fromEntries(Object.entries(state.approvals).filter(([, item]) => item.status === "CURRENT" && item.decision === "APPROVED").map(([type, item]) => [type, item.approval_hash]));
    const base = {
      schema_version: 1, id: `RELEASE-${loc.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${now.replace(/[^0-9]/g, "")}`,
      product_id: loc.id, release_class: releaseClass, created_at: now,
      repository, environment: { id: environment.id, class: environment.environment_class, trust_level: environment.trust_level, attestation_hash: environment.attestation_hash },
      baseline_hashes: baselineHashes, approval_hashes: approvalHashes, production_readiness_hash: readinessHash,
      convergence_hash: state.convergence.hash, evidence, limitations: values(options.limitations).map((item) => text(item, "release limitation", 4_096)),
      production_claim_authorized: releaseClass === "PRODUCTION" && environment.environment_class === "PRODUCTION"
    };
    const candidate = { ...base, candidate_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/release-candidates/${candidate.candidate_hash}.json`;
    atomicJson(path.join(loc.root, relative), candidate, MAX_JSON_BYTES);
    if (state.approvals.RELEASE_DECISION && state.approvals.RELEASE_DECISION.artifact_hash !== candidate.candidate_hash) state.approvals.RELEASE_DECISION.status = "STALE";
    state.release_candidate = { id: candidate.id, hash: candidate.candidate_hash, path: relative, release_class: releaseClass, environment_attestation_id: environment.id, repository_commit: repository.commit, production_claim_authorized: candidate.production_claim_authorized };
    state.stage = "RELEASE_CANDIDATE";
    const saved = writeState(loc, state, now);
    appendEvent(loc, "RELEASE_CANDIDATE_PREPARED", { candidate_hash: candidate.candidate_hash, release_class: releaseClass, environment_attestation_id: environment.id, repository_commit: repository.commit }, now);
    return { schema_version: 1, status: "RELEASE_CANDIDATE", product_id: loc.id, candidate: saved.release_candidate, human_approval_required: { type: "RELEASE_DECISION", artifact_hash: candidate.candidate_hash } };
  });
}

function currentReleaseCandidateStatus(loc, state, now) {
  if (!state.release_candidate) return { status: "MISSING", reasons: ["RELEASE_CANDIDATE_MISSING"] };
  const reasons = [];
  try {
    const candidate = boundedJson(loc.root, state.release_candidate.path, "release candidate dossier");
    const repository = currentRepository(loc.root);
    if (candidate.repository?.commit !== repository.commit) reasons.push("REPOSITORY_COMMIT_DRIFT");
    if (candidate.repository?.remote && candidate.repository.remote !== repository.remote) reasons.push("REPOSITORY_REMOTE_DRIFT");
    const trackedStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: loc.root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (trackedStatus.status !== 0 || String(trackedStatus.stdout).trim()) reasons.push("TRACKED_WORKTREE_DIRTY");
    if (candidate.convergence_hash !== state.convergence?.hash) reasons.push("CONVERGENCE_DRIFT");
    if (candidate.production_readiness_hash !== productionReadinessHash(state)) reasons.push("PRODUCTION_READINESS_DRIFT");
    for (const [type, hash] of Object.entries(candidate.baseline_hashes ?? {})) {
      if (state.artifact_heads[type]?.hash !== hash) reasons.push(`BASELINE_DRIFT:${type}`);
    }
    for (const [type, hash] of Object.entries(candidate.approval_hashes ?? {})) {
      const current = state.approvals[type];
      if (!current || current.status !== "CURRENT" || current.decision !== "APPROVED" || current.approval_hash !== hash) reasons.push(`APPROVAL_DRIFT:${type}`);
    }
    const environment = state.environment_attestations[candidate.environment?.id];
    if (!environment || environment.attestation_hash !== candidate.environment?.attestation_hash) reasons.push("ENVIRONMENT_ATTESTATION_DRIFT");
    else {
      if (environment.repository_commit !== repository.commit) reasons.push("ENVIRONMENT_COMMIT_DRIFT");
      if (Date.parse(environment.expires_at) <= Date.parse(now)) reasons.push("ENVIRONMENT_ATTESTATION_EXPIRED");
    }
    const evidenceIds = values(candidate.evidence).map((item) => evidenceId(item?.id, "release candidate evidence id"));
    requireEvidenceReceipts(loc, state, evidenceIds, now, { minimumTrust: "PROVIDER_VERIFIED", environmentAttestationId: candidate.environment?.id, requireCurrentCommit: true });
  } catch (error) {
    reasons.push(`EVIDENCE_OR_INTEGRITY_FAILURE:${error.message}`);
  }
  return { status: reasons.length ? "STALE" : "CURRENT", reasons: [...new Set(reasons)] };
}

export function inspectProductDossier(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp), state = ensureProfessionalState(readState(loc)), questions = readQuestions(loc);
  const gates = ["DISCOVERY_DECISION", "ALPHA_DECISION", "INVESTMENT_DECISION", "BUSINESS_REQUIREMENTS", "SOLUTION_BASELINE", "DELIVERY_BASELINE", "PRODUCTION_READINESS", "RELEASE_DECISION"];
  const gateStatus = {};
  for (const gate of gates) {
    try {
      const report = analysis(loc, state, questions, gate, now);
      gateStatus[gate] = { status: approved(state, gate, approvalTarget(loc, state, questions, gate).artifact_hash) ? "APPROVED" : report.status, blockers: report.summary.blockers, warnings: report.summary.warnings };
    } catch (error) {
      gateStatus[gate] = { status: "NOT_READY", blockers: 1, warnings: 0, reason: error.message };
    }
  }
  const evidence = verifyProductEvidence({ target: loc.root, id: loc.id, timestamp: now });
  const professionalArtifacts = Object.fromEntries(PROFESSIONAL_ARTIFACTS.map((type) => [type, state.artifact_heads[type] ? { status: "PRESENT", hash: state.artifact_heads[type].hash, version: state.artifact_heads[type].version } : { status: "MISSING" }]));
  const releaseApproved = state.release_candidate ? approved(state, "RELEASE_DECISION", state.release_candidate.hash) : false;
  const releaseCurrency = currentReleaseCandidateStatus(loc, state, now);
  const releaseAuthorized = releaseApproved && releaseCurrency.status === "CURRENT";
  return {
    schema_version: 1, status: releaseAuthorized ? (state.release_candidate.production_claim_authorized ? "PRODUCTION_AUTHORIZED" : "LIMITED_RELEASE_AUTHORIZED") : releaseApproved ? "STALE" : "NOT_READY",
    product_id: loc.id, stage: state.stage, profile: state.profile, generated_at: now, next_action: nextActionFrom(state, questions),
    gates: gateStatus, professional_artifacts: professionalArtifacts,
    evidence: { status: evidence.status, total: evidence.results.length, stale: evidence.results.filter((item) => item.status !== "VERIFIED").map((item) => item.id) },
    environments: structuredClone(state.environment_attestations), release_candidate: structuredClone(state.release_candidate), release_currency: releaseCurrency,
    claim_boundaries: {
      documents_are_not_production_proof: true,
      self_declared_evidence_can_authorize_release: false,
      production_claim_authorized: Boolean(releaseAuthorized && state.release_candidate?.production_claim_authorized)
    }
  };
}

function renderDossierMarkdown(dossier) {
  const gateLines = Object.entries(dossier.gates).map(([name, item]) => `| ${name} | ${item.status} | ${item.blockers} | ${item.warnings} |`);
  const artifactLines = Object.entries(dossier.professional_artifacts).map(([name, item]) => `| ${name} | ${item.status} | ${item.version ?? "-"} | ${item.hash ?? "-"} |`);
  return [
    `# Product dossier: ${dossier.product_id}`, "", `Status: **${dossier.status}**`, `Stage: ${dossier.stage}`, `Profile: ${dossier.profile}`, `Generated: ${dossier.generated_at}`, "",
    "## Approval gates", "", "| Gate | Status | Blockers | Warnings |", "| --- | --- | ---: | ---: |", ...gateLines, "",
    "## Professional artifacts", "", "| Artifact | Status | Version | Hash |", "| --- | --- | ---: | --- |", ...artifactLines, "",
    "## Evidence and release truth", "", `- Evidence status: ${dossier.evidence.status} (${dossier.evidence.total} receipts)`, `- Stale receipts: ${dossier.evidence.stale.join(", ") || "none"}`, `- Release-candidate currency: ${dossier.release_currency.status}`, `- Release-candidate drift: ${dossier.release_currency.reasons.join(", ") || "none"}`, `- Production claim authorized: ${dossier.claim_boundaries.production_claim_authorized ? "yes" : "no"}`, "- Documents and self-declared evidence never prove production readiness.", "",
    "## Next governed action", "", `- Skill: ${dossier.next_action.skill}`, `- Reason: ${dossier.next_action.reason}`, `- Human decision required: ${dossier.next_action.requires_human ? "yes" : "no"}`, ""
  ].join("\n");
}

export function exportProductDossier(options = {}) {
  const loc = location(options), dossier = inspectProductDossier(options);
  const output = relativeInside(loc.root, text(options.output, "dossier output path", 4_096), "dossier output");
  if (!output.relative.endsWith(".md")) throw new Error("dossier output must be a Markdown file");
  fs.mkdirSync(path.dirname(output.absolute), { recursive: true, mode: 0o700 });
  rejectUnsafeExisting(output.absolute, "dossier output", MAX_JSON_BYTES);
  const markdown = renderDossierMarkdown(dossier);
  fs.writeFileSync(output.absolute, markdown, { mode: 0o600, flag: fs.existsSync(output.absolute) ? "w" : "wx" });
  return { schema_version: 1, status: "EXPORTED", product_id: loc.id, dossier_status: dossier.status, output: output.relative, sha256: crypto.createHash("sha256").update(markdown).digest("hex") };
}

export function convergeProduct(options = {}) {
  const loc = location(options), now = timestamp(options.timestamp);
  return withLock(loc, options, () => {
    const state = readState(loc), evidence = boundedJson(loc.root, options.file, "product convergence evidence");
    if (!approved(state, "DELIVERY_BASELINE", artifactHead(state, "delivery")?.hash)) throw new Error("product convergence requires the current delivery baseline approval");
    assertNoRestrictedData(evidence, "product convergence evidence");
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || evidence.schema_version !== 1 || !Array.isArray(evidence.items) || evidence.items.length > 1_000 || !Array.isArray(evidence.baseline_hashes) || evidence.baseline_hashes.length < 4 || evidence.baseline_hashes.length > 100 || evidence.baseline_hashes.some((hash) => !SHA256.test(hash))) throw new Error("product convergence evidence contract is invalid");
    const repository = currentRepository(loc.root);
    if (typeof evidence.implementation_commit !== "string" || evidence.implementation_commit.toLowerCase() !== repository.commit) throw new Error("implementation commit must equal the current full Git commit");
    const trackedStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: loc.root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (trackedStatus.status !== 0 || String(trackedStatus.stdout).trim()) throw new Error("product convergence requires a clean tracked Git worktree");
    const expectedHashes = ["brd", "specification", "design", "delivery"].map((type) => artifactHead(state, type)?.hash).filter(Boolean);
    const suppliedHashes = new Set(evidence.baseline_hashes ?? []);
    const stale = expectedHashes.filter((hash) => !suppliedHashes.has(hash));
    const brd = readHead(loc, state, "brd");
    const knownRequirements = new Set((brd?.requirements ?? []).map((item) => item.id));
    const seenRequirements = new Set();
    const resolvedFiles = [];
    const convergenceStatuses = new Set(["VERIFIED", "FAILED", "NOT_RUN", "NOT_APPLICABLE"]);
    for (const item of evidence.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("product convergence evidence items must be objects");
      const requirementId = text(item.requirement_id, "convergence requirement id", 256);
      if (seenRequirements.has(requirementId)) throw new Error(`duplicate convergence evidence for requirement ${requirementId}`);
      if (!knownRequirements.has(requirementId)) throw new Error(`convergence evidence references unknown requirement ${requirementId}`);
      seenRequirements.add(requirementId);
      if (!convergenceStatuses.has(item.status)) throw new Error(`convergence evidence for ${requirementId} has an invalid status`);
      for (const field of ["task_ids", "code_refs", "test_refs", "evidence_refs"]) {
        list(item[field], `${requirementId} ${field}`, { allowEmpty: true, maximum: 1_000 });
        for (const value of item[field]) text(value, `${requirementId} ${field} value`, 4_096);
      }
      for (const field of ["code_refs", "test_refs"]) for (const reference of item[field]) {
        const fileRef = String(reference).split("#", 1)[0].split(":", 1)[0];
        const resolved = relativeInside(loc.root, fileRef, `${requirementId} ${field} file`);
        if (!fs.existsSync(resolved.absolute)) throw new Error(`${requirementId} ${field} file ${fileRef} does not exist`);
        const measured = sha256File(resolved.absolute);
        resolvedFiles.push({ requirement_id: requirementId, field, path: resolved.relative, sha256: measured.sha256, size: measured.size });
      }
      requireEvidenceReceipts(loc, state, item.evidence_refs, now, { minimumTrust: "REPOSITORY_BOUND", requireCurrentCommit: true });
      if (item.rationale !== undefined) text(item.rationale, `${requirementId} rationale`, 8_192);
    }
    const required = (brd?.requirements ?? []).filter((item) => ["MUST", "SHOULD"].includes(item.priority));
    const byRequirement = new Map(evidence.items.map((item) => [item.requirement_id, item]));
    const gaps = [];
    for (const requirement of required) {
      const item = byRequirement.get(requirement.id);
      if (!item || item.status !== "VERIFIED" || !item.task_ids?.length || !item.code_refs?.length || !item.test_refs?.length || !item.evidence_refs?.length) gaps.push({ requirement_id: requirement.id, reason: "missing verified task, code, test, or evidence trace" });
    }
    const status = stale.length ? "STALE" : gaps.length ? "GAPS_FOUND" : "CONVERGED";
    const base = { schema_version: 1, product_id: loc.id, status, analyzed_at: now, repository, implementation_commit: repository.commit, baseline_hashes: expectedHashes, stale_hashes: stale, requirements_total: required.length, requirements_verified: required.length - gaps.length, gaps, evidence_items: evidence.items, resolved_files: resolvedFiles };
    const report = { ...base, convergence_hash: productDigest(base) };
    const relative = `.ai/products/${loc.id}/convergence/${report.convergence_hash}.json`;
    atomicJson(path.join(loc.root, relative), report, MAX_JSON_BYTES);
    state.convergence = { status, hash: report.convergence_hash, path: relative, analyzed_at: now, implementation_commit: repository.commit };
    if (status === "CONVERGED") state.stage = "VERIFIED";
    const saved = writeState(loc, state, now); appendEvent(loc, "PRODUCT_CONVERGENCE", { status, convergence_hash: report.convergence_hash, gaps: gaps.length, stale: stale.length }, now);
    return { ...report, artifact: relative, stage: saved.stage, next_action: nextActionFrom(saved, readQuestions(loc)) };
  });
}
