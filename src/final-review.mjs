import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";
import { deliveryInput, readDeliveryFile, verifyExecutionEvidence, isUntrackedDeliveryDependency } from "./delivery-evidence.mjs";
import { evaluateIndependentReview } from "./team-review.mjs";
import { teamControlDigest, verifySignedTeamAction } from "./team-control-contract.mjs";
import { withTeamControlStore } from "./team-control-store.mjs";
import { resolveRepositoryIdentity } from "./memory-contract.mjs";

const MAX_REVIEW_BYTES = 2 * 1024 * 1024;
const REVIEW_STATUSES = new Set(["PASSED", "BLOCKED"]);
const DIMENSION_STATUSES = new Set(["PASSED", "FAILED", "NOT_APPLICABLE", "NOT_RUN"]);
const FINDING_STATUSES = new Set(["OPEN", "FIXED", "ACCEPTED_RISK"]);
const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const REQUIRED_DIMENSIONS = [
  "requirement_match",
  "security",
  "code_quality",
  "failure_paths",
  "error_handling",
  "production_readiness",
  "trade_offs"
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeId(value, name = "task id") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) {
    throw new Error(`${name} must be 1-128 safe characters`);
  }
  return value;
}

function boundedText(value, name, maxLength = 2048) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
    throw new Error(`${name} must be non-empty and at most ${maxLength} characters`);
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|authorization|password|secret)\s*[:=]\s*\S+/i.test(value)) {
    throw new Error(`${name} contains secret-like data`);
  }
  return value.trim();
}

function boundedList(value, name, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${name} must be a bounded array`);
  return value;
}

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function reviewPath(root, id) {
  const relPath = `.ai-agent-kit/runtime/reviews/${safeId(id)}.jsonl`;
  if (hasSymlinkComponent(root, relPath)) throw new Error(`refusing runtime access through a symbolic link: ${relPath}`);
  return path.join(root, relPath);
}

function taskPath(root, id) {
  const relPath = `.ai-agent-kit/runtime/tasks/${safeId(id)}.json`;
  if (hasSymlinkComponent(root, relPath)) throw new Error(`refusing runtime access through a symbolic link: ${relPath}`);
  return path.join(root, relPath);
}

function currentCommit(root, deps = {}) {
  const execute = deps.spawnSync ?? spawnSync;
  const result = execute("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function worktreeSignature(root, deps = {}) {
  const execute = deps.spawnSync ?? spawnSync;
  const diff = execute("git", ["diff", "--binary", "HEAD", "--", ".", ":(exclude).ai-agent-kit"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const untracked = execute("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", timeout: 30000 });
  if (diff.status !== 0 || untracked.status !== 0) return null;
  const untrackedFiles = untracked.stdout.split("\0").filter((name) => name && !name.startsWith(".ai-agent-kit/") && !isUntrackedDeliveryDependency(name)).sort().map((relPath) => {
    try {
      const file = path.join(root, relPath);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REVIEW_BYTES) return [relPath, "UNREADABLE_OR_OVERSIZED"];
      return [relPath, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")];
    } catch {
      return [relPath, "UNREADABLE_OR_MISSING"];
    }
  });
  return digest({ diff: diff.stdout, untracked: untrackedFiles });
}

function loadRegularJson(file) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("final review input must be a regular file");
  if (stat.size > MAX_REVIEW_BYTES) throw new Error(`final review input exceeds ${MAX_REVIEW_BYTES} bytes`);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function validateEvidenceRefs(value, name) {
  return boundedList(value, name, 50).map((item, index) => boundedText(item, `${name}[${index}]`, 512));
}

function normalizeReview(input, task, commit) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("final review must be a JSON object");
  if (![1, 2].includes(input.schema_version)) throw new Error("final review schema_version must be 1 or 2");
  const allowedTopLevel = new Set(["schema_version", "task_id", "status", "dimensions", "findings", "residual_risks", "limitations"]);
  if (input.schema_version === 2) for (const key of ["input_hash", "author_identity", "reviewer_identity", "reviewer_action"]) allowedTopLevel.add(key);
  const unknownTopLevel = Object.keys(input).filter((key) => !allowedTopLevel.has(key));
  if (unknownTopLevel.length) throw new Error(`unknown final review fields: ${unknownTopLevel.join(", ")}`);
  if (input.task_id !== task.id) throw new Error("final review task_id does not match the governed task");
  const unknownDimensions = Object.keys(input.dimensions ?? {}).filter((key) => !REQUIRED_DIMENSIONS.includes(key));
  if (unknownDimensions.length) throw new Error(`unknown review dimensions: ${unknownDimensions.join(", ")}`);
  const status = boundedText(input.status, "final review status", 32).toUpperCase();
  if (!REVIEW_STATUSES.has(status)) throw new Error("final review status must be PASSED or BLOCKED");
  const dimensions = {};
  for (const name of REQUIRED_DIMENSIONS) {
    const candidate = input.dimensions?.[name];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`missing review dimension: ${name}`);
    const dimensionStatus = boundedText(candidate.status, `${name} status`, 32).toUpperCase();
    if (!DIMENSION_STATUSES.has(dimensionStatus)) throw new Error(`invalid ${name} status`);
    const unknownDimensionFields = Object.keys(candidate).filter((key) => !["status", "summary", "evidence_refs"].includes(key));
    if (unknownDimensionFields.length) throw new Error(`unknown ${name} fields: ${unknownDimensionFields.join(", ")}`);
    const evidenceRefs = validateEvidenceRefs(candidate.evidence_refs, `${name} evidence_refs`);
    if (dimensionStatus === "PASSED" && !evidenceRefs.length) throw new Error(`${name} PASSED requires evidence_refs`);
    dimensions[name] = {
      status: dimensionStatus,
      summary: boundedText(candidate.summary, `${name} summary`),
      evidence_refs: evidenceRefs
    };
  }
  const findings = boundedList(input.findings, "findings", 200).map((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) throw new Error(`findings[${index}] must be an object`);
    const unknownFindingFields = Object.keys(finding).filter((key) => !["id", "severity", "status", "category", "location", "summary", "resolution", "evidence_refs"].includes(key));
    if (unknownFindingFields.length) throw new Error(`unknown finding fields at index ${index}: ${unknownFindingFields.join(", ")}`);
    const severity = boundedText(finding.severity, `findings[${index}].severity`, 16).toUpperCase();
    const findingStatus = boundedText(finding.status, `findings[${index}].status`, 32).toUpperCase();
    if (!SEVERITIES.has(severity)) throw new Error(`invalid finding severity at index ${index}`);
    if (!FINDING_STATUSES.has(findingStatus)) throw new Error(`invalid finding status at index ${index}`);
    const evidenceRefs = validateEvidenceRefs(finding.evidence_refs, `findings[${index}].evidence_refs`);
    const resolution = finding.resolution == null ? null : boundedText(finding.resolution, `findings[${index}].resolution`);
    if (findingStatus === "FIXED" && (!resolution || !evidenceRefs.length)) throw new Error(`fixed finding at index ${index} requires resolution and evidence_refs`);
    return {
      id: safeId(finding.id, `findings[${index}].id`),
      severity,
      status: findingStatus,
      category: boundedText(finding.category, `findings[${index}].category`, 64),
      location: boundedText(finding.location, `findings[${index}].location`, 512),
      summary: boundedText(finding.summary, `findings[${index}].summary`),
      resolution,
      evidence_refs: evidenceRefs
    };
  });
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) throw new Error("finding IDs must be unique within a review cycle");
  const openBlocking = findings.filter((finding) => finding.status !== "FIXED" && (input.schema_version === 2 || ["CRITICAL", "HIGH"].includes(finding.severity)));
  const incomplete = Object.entries(dimensions).filter(([, value]) => !["PASSED", "NOT_APPLICABLE"].includes(value.status));
  if (status === "PASSED" && (openBlocking.length || incomplete.length)) {
    throw new Error("PASSED final review cannot contain unresolved blocking findings or incomplete dimensions");
  }
  if (status === "BLOCKED" && !openBlocking.length && !incomplete.length) {
    throw new Error("BLOCKED final review requires an open blocking finding or incomplete dimension");
  }
  return {
    schema_version: input.schema_version,
    task_id: task.id,
    status,
    reviewed_commit: commit,
    dimensions,
    findings,
    residual_risks: boundedList(input.residual_risks ?? [], "residual_risks", 50).map((item, index) => boundedText(item, `residual_risks[${index}]`)),
    limitations: boundedList(input.limitations ?? [], "limitations", 50).map((item, index) => boundedText(item, `limitations[${index}]`)),
    recorded_at: new Date().toISOString()
  };
}

function authenticatedAssurance(root, task, input, deps = {}, consume = false, reviewedAt = null) {
  const now = reviewedAt ?? deps.now ?? new Date().toISOString();
  const currentInput = deliveryInput(root, task.id);
  if (input.input_hash !== currentInput) throw new Error("Authenticated review input is stale for the current candidate or requirements.");
  const references = Object.values(input.dimensions).flatMap((item) => item.evidence_refs.map((ref) => ({ ref, pass: String(item.status).trim().toUpperCase() === "PASSED" })));
  for (const finding of input.findings ?? []) for (const ref of finding.evidence_refs ?? []) references.push({ ref, pass: String(finding.status).trim().toUpperCase() === "FIXED" });
  const evidence = []; let executable = false;
  for (const { ref, pass } of references) {
    if (ref.startsWith("execution:")) {
      const hash = ref.slice(10); const receipt = verifyExecutionEvidence(root, task.id, hash, currentInput, pass);
      executable ||= pass && receipt.status === "PASSED";
      evidence.push({ type: "execution", receipt_hash: hash });
    } else {
      const match = /^file:(.+)#([a-f0-9]{64})$/.exec(ref);
      if (!match || readDeliveryFile(root, match[1]).sha256 !== match[2]) throw new Error("Review evidence must resolve to current hashed files or execution receipts.");
      evidence.push({ type: "file", path: match[1], sha256: match[2] });
    }
  }
  if (String(input.status).trim().toUpperCase() === "PASSED" && !executable) throw new Error("A passing authenticated review requires executed verification.");
  const resolveIdentityKey = deps.resolveIdentityKey ?? ((key) => withTeamControlStore({ target: root }, (store) => store.getTrustedKey(key)));
  const authentication = { target: root, now, resolveIdentityKey, author: input.author_identity, reviewer: input.reviewer_identity, evidenceHash: teamControlDigest(evidence), inputHash: currentInput, packageId: task.id, requireReleaseGradeTrust: true };
  const result = evaluateIndependentReview(authentication);
  if (result.status !== "ACCEPTED") throw new Error(`Independent review authentication rejected: ${result.blockers.join(", ")}`);
  const signedPayload = { ...input }; delete signedPayload.reviewer_action;
  const action = verifySignedTeamAction(input.reviewer_action, { now, resolveIdentityKey, repositoryId: resolveRepositoryIdentity({ target: root }).repository_id, taskId: task.id, operation: "review.submit", payloadHash: teamControlDigest(signedPayload) });
  if (action.principal_id !== result.reviewer_id || action.key_id !== input.reviewer_identity.authentication.key_id) throw new Error("Review signature does not belong to the authenticated reviewer.");
  if (consume) withTeamControlStore({ target: root }, (store) => store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now }));
  return { status: "VERIFIED", evidence_level: "AUTHENTICATED_REVIEW", input_hash: currentInput, author_id: result.author_id, reviewer_id: result.reviewer_id, evidence, signed_input: input, reviewed_at: now };
}

function rejectSensitiveReviewInput(value, depth = 0) {
  if (depth > 16) throw new Error("Review input nesting exceeds its budget.");
  if (typeof value === "string" && /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+\S{8,}/i.test(value)) throw new Error("Review input contains secret-like data.");
  if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (/private[_ -]?key|password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization/i.test(key)) throw new Error("Review input contains a forbidden secret field.");
    rejectSensitiveReviewInput(item, depth + 1);
  }
}

export function recordFinalReview(options, deps = {}) {
  const root = rootFor(options.target); const file = reviewPath(root, options.id);
  const lock = `${file}.lock`;
  if (hasSymlinkComponent(root, path.relative(root, lock))) throw new Error("Review lock path is unsafe.");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let descriptor;
  try { descriptor = fs.openSync(lock, "wx", 0o600); } catch (error) { if (error.code !== "EEXIST") throw error; throw new Error("Final review ledger is being updated; retry after the active writer. Inspect an abandoned lock before recovery."); }
  try { return recordFinalReviewLocked(options, deps); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function recordFinalReviewLocked(options, deps) {
  const root = rootFor(options.target);
  const taskFile = taskPath(root, options.id);
  if (!fs.existsSync(taskFile)) throw new Error(`task not found: ${options.id}`);
  const task = JSON.parse(fs.readFileSync(taskFile, "utf8"));
  const input = loadRegularJson(options.file);
  if (input.schema_version === 2) rejectSensitiveReviewInput(input);
  const record = normalizeReview(input, task, currentCommit(root, deps));
  record.reviewed_worktree_signature = worktreeSignature(root, deps);
  if (!record.reviewed_commit || !record.reviewed_worktree_signature) {
    throw new Error("final review requires a readable Git commit and worktree signature");
  }
  const file = reviewPath(root, task.id);
  const existing = fs.existsSync(file) ? readDeliveryFile(root, path.relative(root, file).split(path.sep).join("/"), 16 * 1024 * 1024).bytes.toString("utf8").split("\n").filter(Boolean) : [];
  const existingRecords = existing.map((line) => JSON.parse(line));
  let previousHash = null;
  for (const candidate of existingRecords) {
    const claimed = candidate.review_hash;
    const copy = { ...candidate };
    delete copy.review_hash;
    if (candidate.previous_review_hash !== previousHash || digest(copy) !== claimed) {
      throw new Error("refusing to append to a final review ledger with invalid hash-chain integrity");
    }
    previousHash = claimed;
  }
  if (record.status === "PASSED" && existing.length) {
    const latestFindingById = new Map();
    for (const existingRecord of existingRecords) {
      for (const finding of existingRecord.findings ?? []) latestFindingById.set(finding.id, finding);
    }
    for (const finding of record.findings) latestFindingById.set(finding.id, finding);
    const unresolved = [...latestFindingById.values()].filter((finding) => finding.status !== "FIXED" && (input.schema_version === 2 || ["CRITICAL", "HIGH"].includes(finding.severity)));
    if (unresolved.length) throw new Error(`PASSED final review must resolve prior blocking findings: ${unresolved.map((finding) => finding.id).join(", ")}`);
  }
  record.assurance = input.schema_version === 2
    ? authenticatedAssurance(root, task, input, deps, false)
    : { status: "LEGACY_UNVERIFIED", evidence_level: "DECLARED", limitations: ["Legacy review references and reviewer identity are not authenticated."] };
  record.previous_review_hash = previousHash;
  record.review_hash = digest(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const persist = () => {
    const content = [...existing, JSON.stringify(record)].join("\n") + "\n";
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error("Review ledger exceeds its budget; archive evidence before continuing.");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 }); (deps.renameSync ?? fs.renameSync)(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  if (input.schema_version === 2) {
    const action = input.reviewer_action;
    if (existingRecords.some((item) => item.assurance?.signed_input?.reviewer_action?.key_id === action.key_id && item.assurance.signed_input.reviewer_action.nonce === action.nonce)) throw new Error("signed action nonce was replayed in the review ledger");
    withTeamControlStore({ target: root }, (store) => store.database.transaction(() => {
      store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now: record.assurance.reviewed_at });
      persist();
    }).immediate());
  } else persist();
  return record;
}

export function inspectFinalReview(options, deps = {}) {
  const root = rootFor(options.target);
  const file = reviewPath(root, options.id);
  if (!fs.existsSync(file)) return { status: "NOT_RUN", stale: false, findings: [], dimensions: {}, residual_risks: [], limitations: [] };
  const records = readDeliveryFile(root, path.relative(root, file).split(path.sep).join("/"), 16 * 1024 * 1024).bytes.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  let previous = null;
  for (const candidate of records) {
    const claimed = candidate.review_hash;
    const copy = { ...candidate };
    delete copy.review_hash;
    if (candidate.previous_review_hash !== previous || digest(copy) !== claimed) {
      return { status: "REJECTED", stale: false, findings: [], dimensions: {}, residual_risks: [], limitations: ["Final review hash chain integrity check failed."] };
    }
    previous = claimed;
  }
  const record = records.at(-1);
  let assurance = record.assurance ?? { status: "LEGACY_UNVERIFIED", evidence_level: "DECLARED" };
  if (record.schema_version === 2) {
    try {
      const task = JSON.parse(fs.readFileSync(taskPath(root, options.id), "utf8"));
      assurance = authenticatedAssurance(root, task, record.assurance.signed_input, deps, false, record.assurance.reviewed_at);
    } catch (error) { assurance = { status: /stale/.test(error.message) ? "STALE" : "REJECTED", evidence_level: "AUTHENTICATED_REVIEW", reason: error.message }; }
  }
  const findingHistory = records.flatMap((cycle, cycleIndex) => cycle.findings.map((finding) => ({
    ...finding,
    cycle: cycleIndex + 1,
    review_hash: cycle.review_hash
  })));
  const latestFindingById = new Map();
  for (const finding of findingHistory) latestFindingById.set(finding.id, finding);
  const resolvedFindings = [...latestFindingById.values()].filter((finding) => finding.status === "FIXED");
  const unresolvedFindings = [...latestFindingById.values()].filter((finding) => finding.status !== "FIXED");
  const commit = currentCommit(root, deps);
  const signature = worktreeSignature(root, deps);
  if (!commit || !signature) return { status: "REJECTED", stale: false, findings: [], dimensions: {}, residual_risks: [], limitations: ["Current Git commit or worktree signature is unavailable."] };
  const stale = Boolean(
    (record.reviewed_commit && commit && record.reviewed_commit !== commit)
    || (record.reviewed_worktree_signature && signature && record.reviewed_worktree_signature !== signature)
  );
  return {
    ...record,
    status: record.schema_version === 2 && assurance.status !== "VERIFIED" ? assurance.status : stale && record.status === "PASSED" ? "STALE" : record.status,
    assurance,
    stale,
    cycle_count: records.length,
    finding_history: findingHistory,
    resolved_findings: resolvedFindings,
    unresolved_findings: unresolvedFindings
  };
}

export function assertFinalReviewPassed(options, deps = {}) {
  const review = inspectFinalReview(options, deps);
  if (review.status !== "PASSED") throw new Error(`final implementation review is ${review.status}`);
  return review;
}
