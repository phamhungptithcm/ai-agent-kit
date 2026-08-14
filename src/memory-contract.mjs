import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const MEMORY_SCHEMA_VERSION = 3;
export const MEMORY_STATUSES = new Set(["PROPOSED", "APPROVED", "REJECTED", "STALE", "SUPERSEDED", "REVOKED", "EXPIRED", "QUARANTINED"]);
export const MEMORY_TRUST_TIERS = new Set(["provisional", "reviewed", "verified"]);
export const MEMORY_VISIBILITIES = new Set(["repository", "branch", "module", "task", "run", "session", "agent"]);
export const MEMORY_CATEGORIES = new Set([
  "architecture", "ownership", "domain-rule", "implementation-pattern", "testing",
  "release", "observability", "operational-risk", "failure-mode", "learning"
]);

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_CONTENT = 16_384;
const MAX_REFERENCE = 500;
const FORBIDDEN_FIELDS = new Set([
  "prompt", "raw_prompt", "system_prompt", "conversation", "chat_history", "chain_of_thought",
  "reasoning", "credentials", "credential", "secrets", "secret", "source_body", "raw_tool_output",
  "session_material", "customer_data"
]);
const ENTRY_KEYS = [
  "schema_version", "id", "revision", "title", "category", "content", "content_hash", "scope", "identity", "provenance", "confidence",
  "trust_tier", "status", "sensitivity", "acl", "retention", "created_by", "approver", "lifecycle", "created_at", "updated_at",
  "approved_at", "last_reviewed_at"
];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields do not match the canonical contract`);
}

function canonicalArray(values, label, options) {
  const normalized = stringArray(values, label, options);
  if (JSON.stringify(normalized) !== JSON.stringify(values)) throw new Error(`${label} must be unique and canonically sorted`);
  return normalized;
}

function hash(value, label, { nullable = true } = {}) {
  if (nullable && value == null) return null;
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

export function memoryDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function safeId(value, label, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(String(value ?? ""))) throw new Error(`${label} must be a safe bounded identifier`);
  return String(value);
}

function boundedText(value, label, max, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be 1-${max} characters`);
  return value.trim();
}

function principalLabel(value, label, { nullable = false } = {}) {
  const normalized = boundedText(value, label, 256, { nullable });
  if (normalized == null) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${label} cannot contain control characters`);
  return normalized;
}

function timestamp(value, label, { nullable = true } = {}) {
  if (nullable && value == null) return null;
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`);
  return new Date(value).toISOString();
}

function date(value, label, { nullable = true } = {}) {
  if (nullable && value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}

function stringArray(values, label, { maxItems = 50, maxLength = MAX_REFERENCE } = {}) {
  if (!Array.isArray(values) || values.length > maxItems) throw new Error(`${label} must be a bounded array`);
  return [...new Set(values.map((value) => boundedText(value, label, maxLength)))].sort();
}

function rejectForbiddenFields(value, current = "memory") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectForbiddenFields(item, `${current}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) throw new Error(`${current}.${key} is forbidden in durable memory`);
    rejectForbiddenFields(child, `${current}.${key}`);
  }
}

export function classifySensitiveContent(value) {
  const text = String(value ?? "");
  const findings = [];
  const patterns = [
    ["PRIVATE_KEY", /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ["CREDENTIAL", /\b(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[:=]\s*\S+/i],
    ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
    ["CLOUD_KEY", /\bAKIA[A-Z0-9]{16}\b/],
    ["GITHUB_TOKEN", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
    ["OPENAI_KEY", /\bsk-[A-Za-z0-9_-]{16,}\b/],
    ["EMAIL_PII", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ["SSN_PII", /\b\d{3}-\d{2}-\d{4}\b/],
    ["PAYMENT_CARD", /\b(?:\d[ -]*?){13,19}\b/],
    ["RAW_CONVERSATION", /\b(?:system|assistant|user)\s*:\s*.{20,}/i],
    ["CHAIN_OF_THOUGHT", /\b(?:chain[- ]of[- ]thought|hidden reasoning|internal reasoning)\b/i],
    ["SENSITIVE_LOG", /\b(?:request|response|tool)\s+(?:body|payload|output)\s*[:=]/i]
  ];
  for (const [code, pattern] of patterns) if (pattern.test(text)) findings.push(code);
  return { allowed: findings.length === 0, classification: findings.length ? "restricted" : "internal", findings };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function resolveRepositoryIdentity(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const organizationId = safeId(options.organizationId ?? "local", "organization id");
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  const rootCommit = git(root, ["rev-list", "--max-parents=0", "HEAD"]);
  const fallback = git(root, ["rev-parse", "--show-toplevel"]) ?? root;
  const commonGit = git(root, ["rev-parse", "--git-common-dir"]);
  const rawCommonGitPath = commonGit ? path.resolve(root, commonGit) : null;
  const commonGitPath = rawCommonGitPath && fs.existsSync(rawCommonGitPath) ? fs.realpathSync(rawCommonGitPath) : rawCommonGitPath;
  const repositoryId = safeId(options.repositoryId ?? `repo-${memoryDigest({ remote, root_commit: rootCommit, local_git_identity: remote ? null : commonGitPath ?? fallback }).slice(0, 24)}`, "repository id");
  const normalized = {
    organization_id: organizationId,
    repository_id: repositoryId,
    remote_hash: remote ? memoryDigest(remote) : null,
    root_commit: rootCommit,
    current_commit: options.sourceCommit ?? git(root, ["rev-parse", "HEAD"]),
    branch: options.branch ?? git(root, ["branch", "--show-current"]) ?? null
  };
  return normalized;
}

export function resolveMemoryActor(options = {}, identity = resolveRepositoryIdentity(options)) {
  const roles = Array.isArray(options.actorRoles) && options.actorRoles.length ? options.actorRoles : ["memory-reader"];
  const normalized = {
    organization_id: safeId(options.actorOrganizationId ?? identity.organization_id, "actor organization id"),
    repository_id: safeId(options.actorRepositoryId ?? identity.repository_id, "actor repository id"),
    actor_id: safeId(options.actorId ?? options.agentId ?? "local-operator", "actor id"),
    roles: stringArray(roles, "actor roles", { maxItems: 20, maxLength: 100 })
  };
  return normalized;
}

function normalizeScope(scope, options, identity) {
  const legacy = typeof scope === "string" ? scope : null;
  const input = scope && typeof scope === "object" && !Array.isArray(scope) ? scope : {};
  const visibility = String(input.visibility ?? legacy ?? options.visibility ?? "repository").toLowerCase();
  if (!MEMORY_VISIBILITIES.has(visibility)) throw new Error("memory scope visibility is invalid");
  const modules = input.modules ?? options.modules ?? (options.module ? [options.module] : []);
  const normalized = {
    visibility,
    organization_id: safeId(input.organization_id ?? identity.organization_id, "scope organization id"),
    repository_id: safeId(input.repository_id ?? identity.repository_id, "scope repository id"),
    branch: safeId(visibility === "branch" ? input.branch ?? options.branchScope ?? identity.branch : null, "scope branch", { nullable: true }),
    modules: stringArray(visibility === "module" ? modules : [], "scope modules", { maxItems: 50, maxLength: 500 }),
    task_id: safeId(visibility === "task" ? input.task_id ?? options.taskId : null, "scope task id", { nullable: true }),
    run_id: safeId(visibility === "run" ? input.run_id ?? options.runId : null, "scope run id", { nullable: true }),
    session_id: safeId(visibility === "session" ? input.session_id ?? options.sessionId : null, "scope session id", { nullable: true }),
    agent_id: safeId(visibility === "agent" ? input.agent_id ?? options.agentId : null, "scope agent id", { nullable: true })
  };
  if (visibility === "branch" && !normalized.branch) throw new Error("branch-scoped memory requires a branch");
  if (visibility === "module" && !normalized.modules.length) throw new Error("module-scoped memory requires at least one module");
  if (["task", "run", "session", "agent"].includes(visibility) && !normalized[`${visibility}_id`]) throw new Error(`${visibility}-scoped memory requires a ${visibility} id`);
  return normalized;
}

function normalizeAcl(acl, scope) {
  const input = acl && typeof acl === "object" && !Array.isArray(acl) ? acl : {};
  const read = input.read && typeof input.read === "object" ? input.read : {};
  const write = input.write && typeof input.write === "object" ? input.write : {};
  return {
    read: {
      organization_ids: stringArray(read.organization_ids ?? [scope.organization_id], "read organizations", { maxItems: 20, maxLength: 256 }),
      repository_ids: stringArray(read.repository_ids ?? [scope.repository_id], "read repositories", { maxItems: 20, maxLength: 256 }),
      actor_ids: stringArray(read.actor_ids ?? ["*"], "read actors", { maxItems: 100, maxLength: 256 }),
      roles: stringArray(read.roles ?? [], "read roles", { maxItems: 20, maxLength: 100 })
    },
    write: {
      organization_ids: stringArray(write.organization_ids ?? [scope.organization_id], "write organizations", { maxItems: 20, maxLength: 256 }),
      repository_ids: stringArray(write.repository_ids ?? [scope.repository_id], "write repositories", { maxItems: 20, maxLength: 256 }),
      actor_ids: stringArray(write.actor_ids ?? [], "write actors", { maxItems: 100, maxLength: 256 }),
      roles: stringArray(write.roles ?? ["memory-approver"], "write roles", { maxItems: 20, maxLength: 100 })
    }
  };
}

function normalizeProvenance(provenance, options, identity) {
  const input = provenance && typeof provenance === "object" && !Array.isArray(provenance) ? provenance : {};
  const legacySource = typeof options.source === "string" ? options.source : null;
  return {
    source_type: boundedText(input.source_type ?? options.sourceType ?? "current-source-code", "source type", 100),
    references: stringArray(input.references ?? options.references ?? (legacySource ? [legacySource] : []), "source references"),
    source_commit: safeId(input.source_commit ?? options.sourceCommit ?? identity.current_commit, "source commit", { nullable: true }),
    source_hash: input.source_hash ?? options.sourceHash ?? null,
    evidence_hashes: stringArray(input.evidence_hashes ?? options.evidenceHashes ?? [], "evidence hashes", { maxItems: 50, maxLength: 64 }),
    handoff_hash: safeId(input.handoff_hash ?? options.handoffHash, "handoff hash", { nullable: true }),
    candidate_hash: safeId(input.candidate_hash ?? options.candidateHash, "candidate hash", { nullable: true })
  };
}

function normalizeRetention(retention, options) {
  const input = retention && typeof retention === "object" && !Array.isArray(retention) ? retention : {};
  return {
    review_date: date(input.review_date ?? options.reviewDate, "memory review date"),
    expires_at: timestamp(input.expires_at ?? options.expiresAt, "memory expiry"),
    delete_after: timestamp(input.delete_after ?? options.deleteAfter, "memory deletion date"),
    policy: boundedText(input.policy ?? options.retentionPolicy ?? "quarterly-review", "retention policy", 100)
  };
}

export function createMemoryEntry(options = {}) {
  rejectForbiddenFields(options);
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity(options);
  const title = boundedText(options.title, "memory title", 256);
  const content = boundedText(options.content, "memory content", MAX_CONTENT);
  const sensitivity = classifySensitiveContent(`${title}\n${content}\n${JSON.stringify(options.source ?? options.provenance ?? {})}`);
  if (!sensitivity.allowed) throw new Error(`memory contains secret-like or prohibited sensitive content: ${sensitivity.findings.join(", ")}`);
  const scope = normalizeScope(options.scope, options, identity);
  const provenance = normalizeProvenance(options.provenance, options, identity);
  const category = String(options.category ?? "learning").toLowerCase();
  if (!MEMORY_CATEGORIES.has(category)) throw new Error("memory category is invalid");
  const confidence = Number(options.confidence ?? 0.5);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("confidence must be between 0 and 1");
  const trustTier = String(options.trustTier ?? options.trust_tier ?? "provisional").toLowerCase();
  if (!MEMORY_TRUST_TIERS.has(trustTier)) throw new Error("trust tier must be provisional, reviewed, or verified");
  const status = String(options.status ?? "PROPOSED").toUpperCase();
  if (!MEMORY_STATUSES.has(status)) throw new Error("memory status is invalid");
  const createdAt = timestamp(options.createdAt ?? options.created_at ?? new Date().toISOString(), "memory creation date", { nullable: false });
  const contentHash = memoryDigest({ title, category, scope, content, provenance });
  const entry = {
    schema_version: MEMORY_SCHEMA_VERSION,
    id: safeId(options.id ?? `mem-${contentHash.slice(0, 24)}`, "memory id"),
    revision: Number(options.revision ?? 1),
    title,
    category,
    content,
    content_hash: contentHash,
    scope,
    identity: {
      organization_id: scope.organization_id,
      repository_id: scope.repository_id,
      task_id: safeId(options.taskId ?? options.task_id ?? scope.task_id, "identity task id", { nullable: true }),
      run_id: safeId(options.runId ?? options.run_id ?? scope.run_id, "identity run id", { nullable: true }),
      session_id: safeId(options.sessionId ?? options.session_id ?? scope.session_id, "identity session id", { nullable: true }),
      agent_id: safeId(options.agentId ?? options.agent_id ?? scope.agent_id, "identity agent id", { nullable: true })
    },
    provenance,
    confidence,
    trust_tier: trustTier,
    status,
    sensitivity: { classification: sensitivity.classification, findings: [] },
    acl: normalizeAcl(options.acl, scope),
    retention: normalizeRetention(options.retention, options),
    created_by: principalLabel(options.createdBy ?? options.created_by ?? options.agentId ?? "local-operator", "memory creator"),
    approver: principalLabel(options.approver, "memory approver", { nullable: true }),
    lifecycle: {
      reason: boundedText(options.lifecycle?.reason ?? options.lifecycleReason, "lifecycle reason", 1000, { nullable: true }),
      replacement_id: safeId(options.lifecycle?.replacement_id ?? options.replacementId, "replacement id", { nullable: true }),
      supersedes: stringArray(options.lifecycle?.supersedes ?? options.supersedes ?? [], "superseded memory ids", { maxItems: 50, maxLength: 256 })
    },
    created_at: createdAt,
    updated_at: timestamp(options.updatedAt ?? options.updated_at ?? createdAt, "memory update date", { nullable: false }),
    approved_at: timestamp(options.approvedAt ?? options.approved_at, "memory approval date"),
    last_reviewed_at: timestamp(options.lastReviewedAt ?? options.last_reviewed_at, "memory review timestamp")
  };
  return validateMemoryEntry(entry);
}

export function validateMemoryEntry(entry) {
  rejectForbiddenFields(entry);
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.schema_version !== MEMORY_SCHEMA_VERSION) throw new Error("memory entry must use schema version 3");
  exactKeys(entry, ENTRY_KEYS, "memory entry");
  safeId(entry.id, "memory id");
  if (!Number.isInteger(entry.revision) || entry.revision < 1) throw new Error("memory revision must be a positive integer");
  if (boundedText(entry.title, "memory title", 256) !== entry.title || boundedText(entry.content, "memory content", MAX_CONTENT) !== entry.content) throw new Error("memory text fields must be canonical");
  if (!MEMORY_CATEGORIES.has(entry.category)) throw new Error("memory category is invalid");
  hash(entry.content_hash, "memory content hash", { nullable: false });
  exactKeys(entry.scope, ["visibility", "organization_id", "repository_id", "branch", "modules", "task_id", "run_id", "session_id", "agent_id"], "memory scope");
  const normalizedScope = normalizeScope(entry.scope, {}, { organization_id: entry.scope.organization_id, repository_id: entry.scope.repository_id, branch: entry.scope.branch });
  if (JSON.stringify(stableValue(normalizedScope)) !== JSON.stringify(stableValue(entry.scope))) throw new Error("memory scope is not canonical");
  exactKeys(entry.identity, ["organization_id", "repository_id", "task_id", "run_id", "session_id", "agent_id"], "memory identity");
  if (entry.identity.organization_id !== entry.scope.organization_id || entry.identity.repository_id !== entry.scope.repository_id) throw new Error("memory identity does not match its scope");
  for (const key of ["organization_id", "repository_id", "task_id", "run_id", "session_id", "agent_id"]) safeId(entry.identity[key], `memory identity ${key}`, { nullable: !["organization_id", "repository_id"].includes(key) });
  exactKeys(entry.provenance, ["source_type", "references", "source_commit", "source_hash", "evidence_hashes", "handoff_hash", "candidate_hash"], "memory provenance");
  boundedText(entry.provenance.source_type, "memory source type", 100);
  canonicalArray(entry.provenance.references, "memory references", { maxItems: 50, maxLength: MAX_REFERENCE });
  safeId(entry.provenance.source_commit, "memory source commit", { nullable: true });
  hash(entry.provenance.source_hash, "memory source hash");
  canonicalArray(entry.provenance.evidence_hashes, "memory evidence hashes", { maxItems: 50, maxLength: 64 });
  entry.provenance.evidence_hashes.forEach((value) => hash(value, "memory evidence hash", { nullable: false }));
  hash(entry.provenance.handoff_hash, "memory handoff hash"); hash(entry.provenance.candidate_hash, "memory candidate hash");
  if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) throw new Error("memory confidence is invalid");
  if (!MEMORY_TRUST_TIERS.has(entry.trust_tier)) throw new Error("memory trust tier is invalid");
  if (!MEMORY_STATUSES.has(entry.status)) throw new Error("memory status is invalid");
  exactKeys(entry.sensitivity, ["classification", "findings"], "memory sensitivity");
  if (!new Set(["public", "internal", "confidential", "restricted"]).has(entry.sensitivity.classification) || !Array.isArray(entry.sensitivity.findings) || entry.sensitivity.findings.length) throw new Error("durable memory must have a cleared sensitivity review");
  exactKeys(entry.acl, ["read", "write"], "memory ACL");
  for (const mode of ["read", "write"]) {
    exactKeys(entry.acl[mode], ["organization_ids", "repository_ids", "actor_ids", "roles"], `memory ACL ${mode}`);
    for (const key of ["organization_ids", "repository_ids", "actor_ids", "roles"]) canonicalArray(entry.acl[mode][key], `memory ACL ${mode} ${key}`, { maxItems: key === "actor_ids" ? 100 : 20, maxLength: 256 });
  }
  if (!entry.acl.read.organization_ids.includes(entry.scope.organization_id) || !entry.acl.read.repository_ids.includes(entry.scope.repository_id)) throw new Error("memory read ACL must bind its organization and repository scope");
  exactKeys(entry.retention, ["review_date", "expires_at", "delete_after", "policy"], "memory retention");
  date(entry.retention.review_date, "memory review date");
  for (const [key, label] of [["expires_at", "memory expiry"], ["delete_after", "memory deletion date"]]) {
    const normalized = timestamp(entry.retention[key], label); if (normalized !== entry.retention[key]) throw new Error(`${label} must be canonical`);
  }
  boundedText(entry.retention.policy, "memory retention policy", 100);
  principalLabel(entry.created_by, "memory creator"); principalLabel(entry.approver, "memory approver", { nullable: true });
  exactKeys(entry.lifecycle, ["reason", "replacement_id", "supersedes"], "memory lifecycle");
  boundedText(entry.lifecycle.reason, "lifecycle reason", 1000, { nullable: true }); safeId(entry.lifecycle.replacement_id, "replacement id", { nullable: true });
  canonicalArray(entry.lifecycle.supersedes, "superseded memory ids", { maxItems: 50, maxLength: 256 });
  for (const [key, nullable] of [["created_at", false], ["updated_at", false], ["approved_at", true], ["last_reviewed_at", true]]) {
    const normalized = timestamp(entry[key], `memory ${key}`, { nullable }); if (normalized !== entry[key]) throw new Error(`memory ${key} must be canonical`);
  }
  if (Date.parse(entry.updated_at) < Date.parse(entry.created_at)) throw new Error("memory update time cannot precede creation");
  if (entry.status === "APPROVED" && (!entry.approver || !entry.approved_at || !entry.retention?.review_date || !entry.provenance?.source_commit)) throw new Error("approved memory requires approver, approval time, review date, and source commit");
  const expectedHash = memoryDigest({ title: entry.title, category: entry.category, scope: entry.scope, content: entry.content, provenance: entry.provenance });
  if (entry.content_hash !== expectedHash) throw new Error("memory content hash mismatch");
  const sensitive = classifySensitiveContent(`${entry.title}\n${entry.content}\n${JSON.stringify(entry.provenance?.references ?? [])}`);
  if (!sensitive.allowed) throw new Error(`memory contains secret-like or prohibited sensitive content: ${sensitive.findings.join(", ")}`);
  if (Buffer.byteLength(JSON.stringify(entry)) > MAX_RECORD_BYTES) throw new Error("memory entry exceeds the record size limit");
  return entry;
}

export function normalizeLegacyMemoryEntry(entry, options = {}) {
  if (entry?.schema_version === MEMORY_SCHEMA_VERSION) return validateMemoryEntry(entry);
  const statusMap = { proposed: "PROPOSED", approved: "APPROVED", rejected: "REJECTED", stale: "STALE", superseded: "SUPERSEDED", revoked: "REVOKED", expired: "EXPIRED" };
  const source = entry.source && typeof entry.source === "object" ? entry.source : { references: entry.source ? [String(entry.source)] : [] };
  return createMemoryEntry({
    ...options,
    id: entry.id,
    revision: entry.revision ?? 1,
    title: entry.title,
    category: entry.category ?? "learning",
    scope: entry.scope,
    content: entry.content,
    sourceType: source.type ?? "historical-discussion",
    references: source.references ?? [],
    sourceCommit: entry.source_commit,
    confidence: entry.confidence,
    trustTier: entry.trust_tier,
    status: statusMap[String(entry.status).toLowerCase()] ?? String(entry.status ?? "PROPOSED").toUpperCase(),
    approver: entry.approver ?? (String(entry.status).toLowerCase() === "approved" ? "legacy-v2-approver-unknown" : null),
    reviewDate: entry.review_date,
    expiresAt: entry.expires_at,
    createdBy: entry.created_by ?? "v2-migration",
    createdAt: entry.created_at,
    updatedAt: entry.updated_at ?? entry.approved_at ?? entry.created_at,
    approvedAt: entry.approved_at ?? (String(entry.status).toLowerCase() === "approved" ? entry.updated_at ?? entry.created_at ?? new Date(0).toISOString() : null),
    lifecycleReason: entry.lifecycle_reason,
    replacementId: entry.replacement_id,
    supersedes: entry.supersedes ?? []
  });
}

export function normalizeMemoryCandidate(candidate, options = {}) {
  rejectForbiddenFields(candidate);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("memory candidate must be an object");
  const allowed = new Set(["title", "content", "category", "scope", "confidence", "trust_tier", "evidence_hashes", "references"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) throw new Error("memory candidate contains an unsupported field");
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity(options);
  const title = boundedText(candidate.title, "memory candidate title", 256);
  const content = boundedText(candidate.content, "memory candidate content", MAX_CONTENT);
  const sensitivity = classifySensitiveContent(`${title}\n${content}`);
  if (!sensitivity.allowed) throw new Error(`memory candidate contains secret-like or prohibited sensitive content: ${sensitivity.findings.join(", ")}`);
  const category = String(candidate.category ?? "learning").toLowerCase();
  if (!MEMORY_CATEGORIES.has(category)) throw new Error("memory candidate category is invalid");
  const scope = normalizeScope(candidate.scope, options, identity);
  const confidence = Number(candidate.confidence ?? 0.5);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("memory candidate confidence must be between 0 and 1");
  const normalized = {
    title,
    content,
    category,
    scope,
    confidence,
    trust_tier: "provisional",
    evidence_hashes: stringArray(candidate.evidence_hashes ?? [], "candidate evidence hashes", { maxItems: 50, maxLength: 64 }),
    references: stringArray(candidate.references ?? [], "candidate references")
  };
  normalized.candidate_hash = memoryDigest(normalized);
  return normalized;
}

export function aclAllowsRead(entry, actor) {
  const read = entry.acl?.read;
  if (!read || !actor) return false;
  if (!read.organization_ids.includes(actor.organization_id) || !read.repository_ids.includes(actor.repository_id)) return false;
  const actorAllowed = read.actor_ids.includes("*") || read.actor_ids.includes(actor.actor_id);
  const roleAllowed = !read.roles.length || read.roles.some((role) => actor.roles.includes(role));
  return actorAllowed && roleAllowed;
}

export function scopeAllowsRead(entry, request = {}) {
  const scope = entry.scope;
  if (scope.organization_id !== request.organization_id || scope.repository_id !== request.repository_id) return false;
  if (scope.visibility === "repository") return true;
  if (scope.visibility === "branch") return Boolean(scope.branch && scope.branch === request.branch);
  if (scope.visibility === "module") return scope.modules.some((module) => (request.modules ?? []).some((candidate) => candidate === module || candidate.startsWith(`${module}/`) || module.startsWith(`${candidate}/`)));
  const key = `${scope.visibility}_id`;
  return Boolean(scope[key] && scope[key] === request[key]);
}
