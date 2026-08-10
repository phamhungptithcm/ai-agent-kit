import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { hasSymlinkComponent } from "./paths.mjs";

const MAX_FILE = 2 * 1024 * 1024;
const MAX_HANDOFFS = 100;
const MAX_CLAIMS = 200;
const MAX_CONFLICTS = 100;
const MAX_FACTS = 50;
const MAX_TEXT = 1000;
const FINDING_SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function bounded(value, label, max = MAX_TEXT) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be 1-${max} characters`); return value.trim(); }
function integer(value, label, min = 0) { if (!Number.isInteger(value) || value < min) throw new Error(`${label} is invalid`); return value; }
function timestamp(value, label) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`); return new Date(parsed).toISOString(); }
function scopedPath(value, root, label) {
  const rel = bounded(value, label, 500);
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || rel.includes("\0")) throw new Error(`${label} must remain inside the repository`);
  inside(root, rel, label); return rel;
}
function secretLike(value) { return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[:=]\s*\S+/i.test(value); }

function inside(root, rel, label) {
  const file = path.resolve(root, rel); const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error(`${label} must remain inside a non-symlinked repository path`);
  return file;
}

function contextPath(id) { return `.ai-agent-kit/runtime/team-contexts/${safe(id, "task id")}.json`; }
function lockPath(id) { return `.ai-agent-kit/runtime/team-contexts/${safe(id, "task id")}.lock`; }

function readFile(root, rel, label) {
  const file = inside(root, rel, label);
  if (!fs.existsSync(file)) throw new Error(`${label} is missing`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error(`${label} must be a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} contains invalid JSON`); }
}

function atomicWrite(root, rel, value, label) {
  const file = inside(root, rel, label); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`; if (Buffer.byteLength(serialized) > MAX_FILE) throw new Error(`${label} exceeds its storage budget`);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try { fs.writeFileSync(temp, serialized, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); } catch (error) { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* preserve the original write error */ } throw error; }
}

function verify(context) {
  const copy = structuredClone(context); const claimed = copy.context_hash; delete copy.context_hash;
  if (!claimed || digest(copy) !== claimed) throw new Error("team context hash mismatch");
  return context;
}

function seal(context) { const copy = structuredClone(context); delete copy.context_hash; context.context_hash = digest(copy); return context; }

function withLock(root, id, callback) {
  const file = inside(root, lockPath(id), "team context lock"); fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try { descriptor = fs.openSync(file, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("team context lock is unsafe");
    if (Date.now() - stat.mtimeMs <= 30000) throw new Error("team context is being updated; sync and retry");
    fs.unlinkSync(file); descriptor = fs.openSync(file, "wx", 0o600);
  }
  try { return callback(); } finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}

function liveClaim(claim, now) { return claim.status === "ACTIVE" && Date.parse(claim.expires_at) > Date.parse(now); }
function overlap(left, right) {
  const normalize = (value) => value.replace(/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
  const a = normalize(left); const b = normalize(right);
  return Boolean(a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function coveredBy(candidate, scopes) {
  if (!scopes.length) return false;
  const plain = candidate.replace(/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
  return scopes.some((scope) => { const base = scope.replace(/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, ""); return candidate === scope || (base && (plain === base || plain.startsWith(`${base}/`))); });
}

function evidenceItem(item, root) {
  if (!item || typeof item !== "object") throw new Error("handoff evidence item is invalid");
  const rel = scopedPath(item.path, root, "evidence path");
  const file = inside(root, rel, "handoff evidence path");
  if (!fs.existsSync(file)) throw new Error(`handoff evidence path does not exist: ${rel}`);
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error(`handoff evidence must be a bounded regular file: ${rel}`);
  const start = integer(item.line_start ?? 1, "evidence line start", 1); const end = integer(item.line_end ?? item.line_start ?? 1, "evidence line end", 1);
  if (end < start) throw new Error("evidence line range is invalid");
  const currentHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (item.sha256 && item.sha256 !== currentHash) throw new Error("evidence hash does not match current file content");
  return { path: rel, line_start: start, line_end: end, sha256: currentHash };
}

function statements(values, label) {
  if (!Array.isArray(values) || values.length > MAX_FACTS) throw new Error(`${label} must be a bounded array`);
  return values.map((value) => bounded(value, label));
}

function structuredFinding(item, root, assignmentId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("structured finding is invalid");
  const allowed = new Set(["severity", "confidence", "category", "summary", "path", "line", "recommendation", "evidence_hashes"]);
  if (Object.keys(item).some((key) => !allowed.has(key))) throw new Error("structured finding contains an unsupported field");
  const severity = bounded(item.severity, "finding severity", 20).toUpperCase();
  if (!FINDING_SEVERITIES.has(severity)) throw new Error("finding severity is invalid");
  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("finding confidence must be between 0 and 1");
  const category = bounded(item.category, "finding category", 100);
  const summary = bounded(item.summary, "finding summary");
  const findingPath = item.path == null ? null : scopedPath(item.path, root, "finding path");
  const line = item.line == null ? null : integer(item.line, "finding line", 1);
  const recommendation = item.recommendation == null ? null : bounded(item.recommendation, "finding recommendation");
  const evidenceHashes = [...new Set(item.evidence_hashes ?? [])].slice(0, MAX_FACTS).map((value) => {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("finding evidence hash is invalid");
    return value;
  });
  const normalizedKey = { path: findingPath, line, category: category.toLowerCase(), summary: summary.toLowerCase().replace(/\s+/g, " ") };
  return { fingerprint: digest(normalizedKey), severity, confidence, category, summary, path: findingPath, line, recommendation, evidence_hashes: evidenceHashes, specialist: assignmentId };
}

export function initializeTeamContext(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  const now = timestamp(options.now ?? new Date().toISOString(), "context timestamp");
  const brief = {
    goal_hash: safe(options.goalHash, "goal hash"),
    scope_hash: digest(options.paths ?? []),
    acceptance_hash: digest(options.acceptanceCriteria ?? []),
    repository_commit: options.repositoryCommit ?? null,
    repository_brief_hash: options.repositoryBriefHash ?? null,
    repository_intelligence: options.repositoryIntelligence ?? "DEGRADED",
    approval_hash: options.approvalHash ?? null
  };
  const context = { schema_version: 1, task_id: id, state: "PLANNED", revision: 1, knowledge_revision: 0, brief, assignments: (options.assignments ?? []).map((item) => ({ id: safe(item.id, "assignment id"), depends_on: item.depends_on ?? [], write_access: Boolean(item.write_access), allowed_paths: item.allowed_paths ?? [], latest_handoff_hash: null, acknowledged_handoff_hash: null, acknowledged_status: null, completed_knowledge_revision: null })), claims: [], handoffs: [], conflicts: [], decisions: [], created_at: now, updated_at: now };
  seal(context); atomicWrite(root, contextPath(id), context, "team context"); return context;
}

export function inspectTeamContext(options) { return verify(readFile(path.resolve(options.target ?? process.cwd()), contextPath(options.id), "team context")); }

export function activateTeamContext(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id }); if (context.state !== "PLANNED") throw new Error("team context is already active");
    context.state = "ACTIVE"; context.revision += 1; context.updated_at = timestamp(options.now ?? new Date().toISOString(), "activation timestamp"); seal(context); atomicWrite(root, contextPath(id), context, "team context"); return context;
  });
}

export function recordTeamApproval(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    const approvalHash = safe(options.approvalHash, "approval hash");
    if (!/^[a-f0-9]{64}$/.test(approvalHash)) throw new Error("approval hash must be a SHA-256 digest");
    if (context.brief.approval_hash && context.brief.approval_hash !== approvalHash) throw new Error("a different team approval is already recorded");
    if (context.brief.approval_hash === approvalHash) return context;
    context.brief.approval_hash = approvalHash; context.revision += 1;
    context.updated_at = timestamp(options.now ?? new Date().toISOString(), "approval timestamp");
    seal(context); atomicWrite(root, contextPath(id), context, "team context"); return context;
  });
}

export function claimTeamWork(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    if (context.state !== "ACTIVE") throw new Error("team context must be active before claiming work");
    if (integer(options.expectedRevision, "expected revision", 1) !== context.revision) throw new Error(`team context revision conflict: expected ${options.expectedRevision}, current ${context.revision}`);
    const assignment = context.assignments.find((item) => item.id === options.assignment); if (!assignment) throw new Error("team assignment does not exist in shared context");
    const now = timestamp(options.now ?? new Date().toISOString(), "claim timestamp"); const agent = safe(options.agent, "agent id");
    context.claims = context.claims.map((claim) => liveClaim(claim, now) ? claim : claim.status === "ACTIVE" ? { ...claim, status: "EXPIRED" } : claim);
    if (context.claims.length >= MAX_CLAIMS) throw new Error("team claim budget exceeded");
    if (context.claims.some((claim) => liveClaim(claim, now) && claim.assignment_id === assignment.id)) throw new Error("assignment is already claimed");
    const paths = [...new Set(options.paths?.length ? options.paths : assignment.allowed_paths)].slice(0, 100).map((item) => scopedPath(item, root, "claimed path"));
    if (options.paths?.length && paths.some((item) => !coveredBy(item, assignment.allowed_paths))) throw new Error("claimed path broadens assignment scope");
    const conflict = context.claims.find((claim) => liveClaim(claim, now) && [...paths].some((left) => claim.paths.some((right) => overlap(left, right))) && (assignment.write_access || claim.write_access));
    if (conflict) throw new Error(`write scope overlaps active claim ${conflict.claim_id}`);
    for (const dependency of assignment.depends_on) {
      const upstream = context.assignments.find((item) => item.id === dependency);
      if (!upstream?.latest_handoff_hash || upstream.acknowledged_handoff_hash !== upstream.latest_handoff_hash || upstream.acknowledged_status !== "COMPLETED") throw new Error(`assignment dependency ${dependency} has no accepted completed handoff`);
    }
    const leaseSeconds = integer(options.leaseSeconds ?? 900, "lease seconds", 30); if (leaseSeconds > 3600) throw new Error("lease seconds exceeds 3600"); const claimId = `claim-${crypto.randomUUID()}`;
    context.claims.push({ claim_id: claimId, assignment_id: assignment.id, agent_id: agent, paths, write_access: assignment.write_access, context_revision: context.knowledge_revision, dependency_handoff_hashes: assignment.depends_on.map((dependency) => context.assignments.find((item) => item.id === dependency).latest_handoff_hash), status: "ACTIVE", claimed_at: now, expires_at: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString() });
    context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context");
    return { claim: context.claims.at(-1), revision: context.revision, knowledge_revision: context.knowledge_revision, context_hash: context.context_hash };
  });
}

export function renewTeamClaim(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    if (context.state !== "ACTIVE") throw new Error("team context must be active before renewing work");
    if (integer(options.expectedRevision, "expected revision", 1) !== context.revision) throw new Error(`team context revision conflict: expected ${options.expectedRevision}, current ${context.revision}`);
    const now = timestamp(options.now ?? new Date().toISOString(), "heartbeat timestamp");
    const claim = context.claims.find((item) => item.claim_id === options.claim && item.agent_id === options.agent && liveClaim(item, now));
    if (!claim) throw new Error("an active matching claim is required");
    const leaseSeconds = integer(options.leaseSeconds ?? 900, "lease seconds", 30); if (leaseSeconds > 3600) throw new Error("lease seconds exceeds 3600");
    claim.expires_at = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(); claim.heartbeat_at = now;
    context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context");
    return { claim_id: claim.claim_id, expires_at: claim.expires_at, revision: context.revision, knowledge_revision: context.knowledge_revision, context_hash: context.context_hash };
  });
}

export function cancelTeamClaim(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    const claim = context.claims.find((item) => item.claim_id === options.claim && item.agent_id === options.agent && item.status === "ACTIVE");
    if (!claim) return { cancelled: false, revision: context.revision, context_hash: context.context_hash };
    const now = timestamp(options.now ?? new Date().toISOString(), "claim cancellation timestamp");
    claim.status = "CANCELLED"; claim.released_at = now; claim.cancellation_reason = bounded(options.reason ?? "team run cancelled", "claim cancellation reason");
    context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context");
    return { cancelled: true, revision: context.revision, context_hash: context.context_hash };
  });
}

export function publishTeamHandoff(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    if (integer(options.expectedRevision, "expected revision", 1) !== context.revision) throw new Error(`team context revision conflict: expected ${options.expectedRevision}, current ${context.revision}`);
    if (context.handoffs.length >= MAX_HANDOFFS) throw new Error("team handoff budget exceeded");
    const now = timestamp(options.now ?? new Date().toISOString(), "handoff timestamp");
    const claim = context.claims.find((item) => item.claim_id === options.claim && item.agent_id === options.agent && liveClaim(item, now));
    if (!claim) throw new Error("an active matching claim is required");
    const assignment = context.assignments.find((item) => item.id === claim.assignment_id);
    const payload = options.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("handoff payload is invalid");
    if (secretLike(JSON.stringify(payload))) throw new Error("handoff contains secret-like content");
    if (payload.brief_hash !== digest(context.brief)) throw new Error("handoff brief is stale or mismatched");
    if (claim.dependency_handoff_hashes.some((hashValue, index) => hashValue !== context.assignments.find((item) => item.id === assignment.depends_on[index])?.latest_handoff_hash)) throw new Error("handoff dependencies became stale");
    const affectedPaths = [...new Set(payload.affected_paths ?? [])].slice(0, 100).map((item) => scopedPath(item, root, "affected path"));
    if (claim.write_access && affectedPaths.some((item) => !coveredBy(item, claim.paths))) throw new Error("handoff affected path exceeds claimed write scope");
    const normalized = { assignment_id: assignment.id, agent_id: claim.agent_id, claim_id: claim.claim_id, brief_hash: payload.brief_hash, context_revision: claim.context_revision, facts: statements(payload.facts ?? [], "handoff facts"), findings: statements(payload.findings ?? [], "handoff findings"), structured_findings: (payload.structured_findings ?? []).slice(0, MAX_FACTS).map((item) => structuredFinding(item, root, assignment.id)), decisions_needed: statements(payload.decisions_needed ?? [], "handoff decisions"), risks: statements(payload.risks ?? [], "handoff risks"), unresolved_questions: statements(payload.unresolved_questions ?? [], "handoff questions"), affected_paths: affectedPaths, tests_recommended: statements(payload.tests_recommended ?? [], "recommended tests"), evidence: (payload.evidence ?? []).slice(0, MAX_FACTS).map((item) => evidenceItem(item, root)), status: payload.status ?? "COMPLETED", published_at: now };
    if (!new Set(["COMPLETED", "BLOCKED", "REJECTED"]).has(normalized.status)) throw new Error("handoff status is invalid");
    if (normalized.status === "COMPLETED" && !normalized.evidence.length) throw new Error("completed handoff requires evidence");
    const handoffHash = digest(normalized); context.handoffs.push({ ...normalized, handoff_hash: handoffHash });
    assignment.latest_handoff_hash = handoffHash; assignment.completed_knowledge_revision = context.knowledge_revision + 1; claim.status = "RELEASED"; claim.released_at = now;
    context.knowledge_revision += 1; context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context");
    return { handoff_hash: handoffHash, revision: context.revision, knowledge_revision: context.knowledge_revision, context_hash: context.context_hash };
  });
}

export function recordTeamConflict(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    if (integer(options.expectedRevision, "expected revision", 1) !== context.revision) throw new Error(`team context revision conflict: expected ${options.expectedRevision}, current ${context.revision}`);
    const hashes = [...new Set(options.handoffHashes ?? [])];
    if (context.conflicts.length >= MAX_CONFLICTS) throw new Error("team conflict budget exceeded");
    if (hashes.length < 2 || hashes.some((value) => !context.handoffs.some((item) => item.handoff_hash === value))) throw new Error("conflict requires at least two known handoffs");
    const now = timestamp(options.now ?? new Date().toISOString(), "conflict timestamp"); const conflictId = `conflict-${crypto.randomUUID()}`;
    const summary = bounded(options.summary, "conflict summary"); if (secretLike(summary)) throw new Error("conflict contains secret-like content");
    context.conflicts.push({ conflict_id: conflictId, handoff_hashes: hashes, summary, status: "OPEN", created_at: now });
    context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context");
    return { conflict_id: conflictId, revision: context.revision, context_hash: context.context_hash };
  });
}

export function decideTeamConflict(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id });
    if (integer(options.expectedRevision, "expected revision", 1) !== context.revision) throw new Error(`team context revision conflict: expected ${options.expectedRevision}, current ${context.revision}`);
    const conflict = context.conflicts.find((item) => item.conflict_id === options.conflict && item.status === "OPEN"); if (!conflict) throw new Error("open conflict does not exist");
    if (context.decisions.length >= MAX_CONFLICTS) throw new Error("team decision budget exceeded");
    const selected = safe(options.selectedHandoff, "selected handoff"); if (!conflict.handoff_hashes.includes(selected)) throw new Error("selected handoff is not part of the conflict");
    const reason = bounded(options.reason, "decision reason"); if (secretLike(reason)) throw new Error("decision contains secret-like content");
    const now = timestamp(options.now ?? new Date().toISOString(), "decision timestamp"); const decision = { conflict_id: conflict.conflict_id, selected_handoff_hash: selected, reason, decided_by: safe(options.decidedBy, "decision owner"), decided_at: now };
    decision.decision_hash = digest(decision); context.decisions.push(decision); conflict.status = "RESOLVED"; conflict.decision_hash = decision.decision_hash;
    context.knowledge_revision += 1; context.revision += 1; context.updated_at = now; seal(context); atomicWrite(root, contextPath(id), context, "team context"); return { ...decision, revision: context.revision, knowledge_revision: context.knowledge_revision, context_hash: context.context_hash };
  });
}

export function acknowledgeTeamHandoff(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  return withLock(root, id, () => {
    const context = inspectTeamContext({ target: root, id }); const assignment = context.assignments.find((item) => item.id === options.assignment);
    if (!assignment || assignment.latest_handoff_hash !== options.handoffHash) throw new Error("cannot acknowledge a non-current handoff");
    const handoff = context.handoffs.find((item) => item.handoff_hash === options.handoffHash); if (!handoff || handoff.status !== options.status) throw new Error("handoff status does not match assignment result");
    if (assignment.acknowledged_handoff_hash === options.handoffHash && assignment.acknowledged_status === options.status) return context;
    assignment.acknowledged_handoff_hash = options.handoffHash; assignment.acknowledged_status = options.status; context.revision += 1; context.updated_at = timestamp(options.now ?? new Date().toISOString(), "acknowledgement timestamp"); seal(context); atomicWrite(root, contextPath(id), context, "team context"); return context;
  });
}

export function teamContextSummary(options) {
  const root = path.resolve(options.target ?? process.cwd()); const context = inspectTeamContext({ ...options, target: root }); const now = options.now ?? new Date().toISOString();
  const freshnessRoles = new Set(["implementation-engineer", "qa-lead", "security-reviewer", "independent-reviewer"]); const staleEvidence = [];
  for (const assignment of context.assignments.filter((item) => freshnessRoles.has(item.id) && item.acknowledged_handoff_hash)) {
    const handoff = context.handoffs.find((item) => item.handoff_hash === assignment.acknowledged_handoff_hash);
    for (const evidence of handoff?.evidence ?? []) { try { const current = evidenceItem(evidence, root); if (current.sha256 !== evidence.sha256) staleEvidence.push(`${assignment.id}:${evidence.path}`); } catch { staleEvidence.push(`${assignment.id}:${evidence.path}`); } }
  }
  const openConflicts = context.conflicts.filter((item) => item.status === "OPEN").length; const status = openConflicts ? "BLOCKED" : staleEvidence.length ? "STALE" : "READY";
  return { schema_version: 2, task_id: context.task_id, state: context.state, status, revision: context.revision, knowledge_revision: context.knowledge_revision, brief_hash: digest(context.brief), repository_intelligence: context.brief.repository_intelligence, assignment_handoffs: context.assignments.map((item) => ({ assignment_id: item.id, latest_handoff_hash: item.latest_handoff_hash, acknowledged_handoff_hash: item.acknowledged_handoff_hash, acknowledged_status: item.acknowledged_status })), active_claims: context.claims.filter((item) => liveClaim(item, now)).map((item) => ({ claim_id: item.claim_id, assignment_id: item.assignment_id, agent_id: item.agent_id, paths: item.paths, expires_at: item.expires_at, heartbeat_at: item.heartbeat_at ?? null })), handoff_count: context.handoffs.length, structured_finding_count: context.handoffs.reduce((sum, item) => sum + (item.structured_findings?.length ?? 0), 0), open_conflicts: openConflicts, stale_evidence: staleEvidence, unresolved_questions: [...new Set(context.handoffs.flatMap((item) => item.unresolved_questions))], context_hash: context.context_hash };
}

export function synthesizeTeamFindings(options) {
  const context = inspectTeamContext(options); const grouped = new Map();
  const currentHandoffs = new Set(context.assignments.map((item) => item.latest_handoff_hash).filter(Boolean));
  for (const finding of context.handoffs.filter((item) => currentHandoffs.has(item.handoff_hash)).flatMap((item) => item.structured_findings ?? [])) {
    const current = grouped.get(finding.fingerprint);
    if (!current) {
      grouped.set(finding.fingerprint, { ...finding, specialists: [finding.specialist], confirmations: 1, disagreement: false });
      continue;
    }
    const specialists = [...new Set([...current.specialists, finding.specialist])];
    const disagreement = current.disagreement || current.severity !== finding.severity;
    const preferred = finding.confidence > current.confidence ? { ...finding } : current;
    grouped.set(finding.fingerprint, { ...preferred, specialists, confirmations: current.confirmations + 1, disagreement });
  }
  return [...grouped.values()].sort((left, right) => right.confidence - left.confidence || left.fingerprint.localeCompare(right.fingerprint));
}

export function briefHash(context) { return digest(context.brief); }
