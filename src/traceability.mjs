import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_LEDGER_BYTES = 32 * 1024 * 1024;
const SENSITIVE_KEYS = /^(prompt|completion|source_body|secret|credential|password|token|chain_of_thought|personal_data)$/i;
const SENSITIVE_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[:=]\s*\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_UNTRACKED_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 4096;

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function canonical(value) { return JSON.stringify(stable(value)); }

function rootOf(target) { return path.resolve(target ?? process.cwd()); }

function assertId(value, label = "id") {
  if (!SAFE_ID.test(value ?? "")) throw new Error(`${label} must be 1-128 safe characters`);
  return value;
}

function assertSafeData(value, trail = "record") {
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) throw new Error(`${trail} contains secret-like or personal data`);
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeData(item, `${trail}[${index}]`));
  if (typeof value !== "object") throw new Error(`${trail} contains an unsupported value`);
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) throw new Error(`${trail}.${key} is not permitted in trace records`);
    assertSafeData(item, `${trail}.${key}`);
  }
}

function tracePath(root, suffix) {
  const rel = `.ai-agent-kit/trace/${suffix}`;
  if (hasSymlinkComponent(root, rel)) throw new Error(`trace path crosses a symbolic link: ${rel}`);
  ensureLocalState(root);
  return path.join(root, rel);
}

function ensurePrivateDirectory(directory) { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }

function ensureLocalState(root) {
  const directory = path.join(root, ".ai-agent-kit");
  if (hasSymlinkComponent(root, ".ai-agent-kit")) throw new Error("local state directory cannot be a symbolic link");
  ensurePrivateDirectory(directory);
  const ignore = path.join(directory, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n!.gitignore\n", { mode: 0o600 });
}

function readJsonl(file, label) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LEDGER_BYTES) throw new Error(`${label} must be a bounded regular file`);
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`${label} contains invalid JSON at offset ${index + 1}`); }
  });
}

function appendLedger(root, name, type, data, timestamp = new Date().toISOString()) {
  assertSafeData(data);
  if (Buffer.byteLength(canonical(data)) > MAX_RECORD_BYTES) throw new Error(`${type} record exceeds ${MAX_RECORD_BYTES} bytes`);
  const file = tracePath(root, `${name}.jsonl`);
  ensurePrivateDirectory(path.dirname(file));
  const lock = `${file}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`${name} is locked by another writer`);
    throw error;
  }
  try {
    const records = readJsonl(file, name);
    verifyLedgerRecords(records, name);
    const previous = records.at(-1) ?? null;
    const base = { schema_version: 1, type, offset: records.length + 1, timestamp, previous_hash: previous?.record_hash ?? null, data };
    const record = { ...base, record_hash: hash(canonical(base)) };
    fs.appendFileSync(file, `${canonical(record)}\n`, { encoding: "utf8", mode: 0o600 });
    return record;
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

export function verifyLedgerRecords(records, label = "ledger") {
  let previous = null;
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.offset !== index + 1) throw new Error(`${label} has a non-monotonic offset at ${index + 1}`);
    if (record.previous_hash !== previous) throw new Error(`${label} hash chain is broken at offset ${record.offset}`);
    const { record_hash, ...base } = record;
    if (hash(canonical(base)) !== record_hash) throw new Error(`${label} record ${record.offset} failed integrity verification`);
    const eventId = record.data?.event_id;
    if (eventId && ids.has(eventId)) throw new Error(`${label} contains duplicate event id ${eventId}`);
    if (eventId) ids.add(eventId);
    previous = record_hash;
  }
  return { schema_version: 1, status: "VERIFIED", record_count: records.length, head_hash: previous };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function worktreeSignature(root) {
  const tracked = spawnSync("git", ["diff", "--binary", "HEAD", "--", ".", ":(exclude).ai-agent-kit"], { cwd: root, encoding: "buffer", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (tracked.status !== 0) throw new Error("unable to inspect tracked worktree changes");
  const listed = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "buffer", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error("unable to inspect untracked worktree files");
  const paths = listed.stdout.toString("utf8").split("\0").filter(Boolean).filter((relative) => relative !== ".ai-agent-kit" && !relative.startsWith(".ai-agent-kit/")).sort();
  if (paths.length > MAX_UNTRACKED_FILES) throw new Error(`untracked worktree exceeds ${MAX_UNTRACKED_FILES} files`);
  let totalBytes = 0;
  const untracked = paths.map((relative) => {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { path: relative, type: "symlink", target_hash: hash(fs.readlinkSync(absolute)) };
    if (!stat.isFile()) return { path: relative, type: "non-file" };
    if (stat.size > MAX_UNTRACKED_FILE_BYTES) throw new Error(`untracked file exceeds ${MAX_UNTRACKED_FILE_BYTES} bytes: ${relative}`);
    totalBytes += stat.size;
    if (totalBytes > MAX_UNTRACKED_TOTAL_BYTES) throw new Error(`untracked worktree exceeds ${MAX_UNTRACKED_TOTAL_BYTES} bytes`);
    const content = fs.readFileSync(absolute);
    return { path: relative, type: "file", size: stat.size, content_hash: crypto.createHash("sha256").update(content).digest("hex") };
  });
  return hash(canonical({ tracked_diff_hash: crypto.createHash("sha256").update(tracked.stdout).digest("hex"), untracked }));
}

function repositoryBinding(root) {
  const worktree_signature = worktreeSignature(root);
  const clean_signature = hash(canonical({ tracked_diff_hash: crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"), untracked: [] }));
  return {
    root_hash: hash(root),
    commit: git(root, ["rev-parse", "HEAD"]),
    branch: git(root, ["branch", "--show-current"]),
    origin_main: git(root, ["rev-parse", "origin/main"]),
    dirty: worktree_signature !== clean_signature,
    worktree_signature
  };
}

function decisionEvents(root) { return readJsonl(tracePath(root, "decisions.jsonl"), "decision ledger"); }
function runEvents(root) { return readJsonl(tracePath(root, "runs.jsonl"), "run ledger"); }

export function recordDecision(options) {
  assertSafeData(options);
  const root = rootOf(options.target);
  const decisionId = assertId(options.decisionId, "decision id");
  const action = options.action ?? "propose";
  if (!["propose", "approve", "reject", "supersede", "revoke", "invalidate"].includes(action)) throw new Error("unsupported decision action");
  const current = resolveDecision({ target: root, decisionId, allowMissing: true });
  if (action === "propose" && current) throw new Error(`decision ${decisionId} already exists; append a transition instead`);
  if (action !== "propose" && !current) throw new Error(`decision ${decisionId} does not exist`);
  if (action === "supersede") assertId(options.supersededBy, "superseding decision id");
  const data = {
    event_id: assertId(options.eventId ?? `event-${crypto.randomUUID()}`, "event id"),
    decision_id: decisionId,
    action,
    actor: String(options.actor ?? "unknown"),
    task_id: options.taskId ?? null,
    run_id: options.runId ?? null,
    question: action === "propose" ? String(options.question ?? "") : null,
    choice: action === "propose" ? String(options.choice ?? "") : null,
    alternatives: action === "propose" ? [...(options.alternatives ?? [])].map(String) : [],
    rationale: String(options.rationale ?? ""),
    assumptions: [...(options.assumptions ?? [])].map(String),
    approval_ref: options.approvalRef ?? null,
    affected_artifacts: [...(options.artifacts ?? [])].map(String),
    superseded_by: options.supersededBy ?? null,
    repository: repositoryBinding(root)
  };
  if (action === "propose" && (!data.question || !data.choice || !data.rationale)) throw new Error("decision proposal requires question, choice, and rationale");
  return appendLedger(root, "decisions", "decision.event", data, options.timestamp);
}

export function resolveDecision(options) {
  const root = rootOf(options.target);
  const id = assertId(options.decisionId, "decision id");
  const records = decisionEvents(root);
  verifyLedgerRecords(records, "decision ledger");
  const events = records.filter((record) => record.data.decision_id === id);
  if (!events.length) {
    if (options.allowMissing) return null;
    throw new Error(`decision ${id} was not found`);
  }
  const proposal = events.find((event) => event.data.action === "propose");
  const last = events.at(-1);
  const status = ({ propose: "PROPOSED", approve: "APPROVED", reject: "REJECTED", supersede: "SUPERSEDED", revoke: "REVOKED", invalidate: "INVALIDATED" })[last.data.action];
  return { schema_version: 1, decision_id: id, status, proposal: proposal?.data ?? null, events, active: status === "APPROVED", head_hash: records.at(-1)?.record_hash ?? null };
}

export function inspectDecisionChronicle(options = {}) {
  const root = rootOf(options.target);
  const records = decisionEvents(root);
  const integrity = verifyLedgerRecords(records, "decision ledger");
  const ids = [...new Set(records.map((record) => record.data.decision_id))];
  const decisions = ids.map((decisionId) => resolveDecision({ target: root, decisionId }));
  return { schema_version: 1, status: integrity.status, integrity, counts: Object.fromEntries([...new Set(decisions.map((item) => item.status))].sort().map((status) => [status, decisions.filter((item) => item.status === status).length])), decisions };
}

export function recordRunEvent(options) {
  assertSafeData(options);
  const root = rootOf(options.target);
  const runId = assertId(options.runId, "run id");
  const phase = options.phase ?? "checkpoint";
  if (!["start", "checkpoint", "pause", "resume-preview", "resume-confirm", "close", "fail", "cancel"].includes(phase)) throw new Error("unsupported run phase");
  const data = {
    event_id: assertId(options.eventId ?? `event-${crypto.randomUUID()}`, "event id"),
    run_id: runId,
    phase,
    task_id: options.taskId ?? null,
    actor: String(options.actor ?? "unknown"),
    goal_hash: options.goal ? hash(String(options.goal)) : null,
    plan_hash: options.plan ? hash(canonical(options.plan)) : null,
    approval_ref: options.approvalRef ?? null,
    decision_ids: [...(options.decisionIds ?? [])].map((id) => assertId(id, "decision id")),
    context_hashes: [...(options.contextHashes ?? [])].map(String),
    plugin_receipt_hashes: [...(options.pluginReceiptHashes ?? [])].map(String),
    check_refs: [...(options.checkRefs ?? [])].map(String),
    finding_refs: [...(options.findingRefs ?? [])].map(String),
    blockers: [...(options.blockers ?? [])].map(String),
    next_action: options.nextAction ? String(options.nextAction) : null,
    failed_attempts: [...(options.failedAttempts ?? [])].map(String),
    not_tried: [...(options.notTried ?? [])].map(String),
    repository: repositoryBinding(root)
  };
  return appendLedger(root, "runs", "run.event", data, options.timestamp);
}

export function inspectRun(options) {
  const root = rootOf(options.target);
  const runId = assertId(options.runId, "run id");
  const records = runEvents(root);
  const integrity = verifyLedgerRecords(records, "run ledger");
  const events = records.filter((record) => record.data.run_id === runId);
  if (!events.length) throw new Error(`run ${runId} was not found`);
  const current = repositoryBinding(root);
  const latest = events.at(-1).data;
  const drift = {
    commit_changed: Boolean(latest.repository.commit && current.commit && latest.repository.commit !== current.commit),
    branch_changed: Boolean(latest.repository.branch && current.branch && latest.repository.branch !== current.branch),
    parent_changed: Boolean(latest.repository.origin_main && current.origin_main && latest.repository.origin_main !== current.origin_main),
    worktree_changed: latest.repository.worktree_signature
      ? latest.repository.worktree_signature !== current.worktree_signature
      : current.dirty
  };
  const blockers = Object.entries(drift).filter(([, value]) => value).map(([key]) => key);
  return { schema_version: 1, run_id: runId, status: blockers.length ? "STALE" : "CURRENT", phase: latest.phase, events, integrity, repository: current, drift, resume: { status: blockers.length ? "BLOCKED" : "PREVIEW_READY", blockers, requires_confirmation: true, next_action: latest.next_action } };
}

export function buildRecoveryPlan(options) {
  const run = inspectRun(options);
  const decisionIds = [...new Set(run.events.flatMap((event) => event.data.decision_ids))];
  const decisions = decisionIds.map((decisionId) => resolveDecision({ target: options.target, decisionId }));
  return { schema_version: 1, status: run.resume.status === "BLOCKED" ? "BLOCKED" : "PREVIEW", destructive: false, requires_approval: true, run_id: run.run_id, repository_drift: run.drift, decisions: decisions.map(({ decision_id, status, proposal }) => ({ decision_id, status, choice: proposal?.choice ?? null })), steps: [{ action: "review-current-state", mutates: false }, { action: "confirm-active-decision-lineage", mutates: false }, { action: "reconcile-repository-drift", mutates: false, required: run.resume.blockers.length > 0 }, { action: "request-explicit-resume-approval", mutates: false }, { action: "resume-through-governed-runtime", mutates: true }], note: "Recovery restores reviewed intent; it never resets Git or overwrites files silently." };
}

export function resumeRun(options) {
  const run = inspectRun(options);
  if (!options.apply) return { ...buildRecoveryPlan(options), action: "resume", status: run.resume.status === "BLOCKED" ? "BLOCKED" : "PREVIEW" };
  if (!options.approvalRef) throw new Error("run resume requires an approval reference");
  if (run.resume.status === "BLOCKED") return { schema_version: 1, status: "BLOCKED", run_id: run.run_id, blockers: run.resume.blockers, mutates: false };
  const latest = run.events.at(-1).data;
  const record = recordRunEvent({ target: options.target, runId: run.run_id, phase: "resume-confirm", actor: options.actor ?? "unknown", taskId: latest.task_id, approvalRef: options.approvalRef, decisionIds: latest.decision_ids, contextHashes: latest.context_hashes, pluginReceiptHashes: latest.plugin_receipt_hashes, checkRefs: latest.check_refs, findingRefs: latest.finding_refs, blockers: [], nextAction: latest.next_action, timestamp: options.timestamp });
  return { schema_version: 1, status: "RESUMED", run_id: run.run_id, mutates: true, requires_writer_reconciliation: true, record_hash: record.record_hash };
}

export function explainWhy(options) {
  const root = rootOf(options.target);
  const chronicle = inspectDecisionChronicle({ target: root });
  const runs = runEvents(root);
  verifyLedgerRecords(runs, "run ledger");
  const query = options.decisionId ?? options.query;
  const normalized = String(query ?? "");
  const matches = chronicle.decisions.filter((decision) => decision.decision_id === normalized || decision.proposal?.affected_artifacts?.some((artifact) => normalized === artifact || normalized.startsWith(`${artifact}:`) || artifact.startsWith(normalized)));
  if (!matches.length) return { schema_version: 1, status: "UNKNOWN", query: normalized, reason: "No provenance-bound decision matches this query", candidates: [] };
  const candidates = matches.map((decision) => ({ decision_id: decision.decision_id, status: decision.status, question: decision.proposal.question, choice: decision.proposal.choice, alternatives: decision.proposal.alternatives, rationale: decision.proposal.rationale, approval_ref: decision.proposal.approval_ref, repository_commit: decision.proposal.repository.commit, affected_artifacts: decision.proposal.affected_artifacts, run_events: runs.filter((record) => record.data.decision_ids.includes(decision.decision_id)).map((record) => ({ run_id: record.data.run_id, phase: record.data.phase, offset: record.offset, record_hash: record.record_hash })), evidence: { decision_head_hash: decision.head_hash } }));
  return { schema_version: 1, status: candidates.length === 1 ? "EXPLAINED" : "AMBIGUOUS", query: normalized, fact_boundary: "Only recorded provenance is shown; absent history remains unknown.", candidates };
}

function safeOutput(root, output) {
  ensureLocalState(root);
  const absolute = path.resolve(root, output);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("output must remain in a non-symlinked repository path");
  return absolute;
}

export function exportRunBundle(options) {
  const root = rootOf(options.target);
  const run = inspectRun({ target: root, runId: options.runId });
  const decisionIds = [...new Set(run.events.flatMap((event) => event.data.decision_ids))];
  const redactData = (data) => { const { actor, ...rest } = data; return { ...rest, actor_hash: hash(actor) }; };
  const redactLedger = (records) => { let previous = null; return records.map((record, index) => { const base = { schema_version: 1, type: record.type, offset: index + 1, timestamp: record.timestamp, previous_hash: previous, data: { ...redactData(record.data), source_record_hash: record.record_hash } }; const exported = { ...base, record_hash: hash(canonical(base)) }; previous = exported.record_hash; return exported; }); };
  const redactDecision = (decision) => ({ ...decision, proposal: decision.proposal ? redactData(decision.proposal) : null, events: decision.events.map((record) => ({ offset: record.offset, timestamp: record.timestamp, action: record.data.action, source_record_hash: record.record_hash })) });
  const bundleBase = { format: "ai-agent-kit.run", version: 1, privacy: { profile: options.profile ?? "redacted", contains_prompts: false, contains_source_bodies: false, contains_secrets: false, contains_credentials: false, contains_personal_data: false }, exported_at: options.timestamp ?? new Date().toISOString(), run: { run_id: run.run_id, phase: run.phase, events: redactLedger(run.events) }, decisions: decisionIds.map((decisionId) => redactDecision(resolveDecision({ target: root, decisionId }))), compatibility: { minimum_kit_version: "1.1.0", adapters: ["claude", "codex"], degraded_allowed: true } };
  assertSafeData(bundleBase);
  const bundle = { ...bundleBase, bundle_hash: hash(canonical(bundleBase)) };
  const file = safeOutput(root, options.output ?? `.ai-agent-kit/exports/${run.run_id}.aakrun`);
  ensurePrivateDirectory(path.dirname(file));
  fs.writeFileSync(file, `${canonical(bundle)}\n`, { mode: 0o600 });
  return { status: "EXPORTED", file, bundle_hash: bundle.bundle_hash, run_id: run.run_id };
}

export function inspectRunBundle(options) {
  const root = rootOf(options.target);
  const file = safeOutput(root, options.file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("run bundle must be a bounded regular file");
  const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  const { bundle_hash: bundleHash, ...base } = bundle;
  const valid = bundle.format === "ai-agent-kit.run" && bundle.version === 1 && hash(canonical(base)) === bundleHash;
  if (!valid) return { schema_version: 1, status: "REJECTED", reason: "bundle format or integrity is invalid" };
  assertSafeData(bundle);
  verifyLedgerRecords(bundle.run.events, "bundle run ledger");
  return { schema_version: 1, status: "VERIFIED", trust: "UNSIGNED", bundle_hash: bundleHash, run_id: bundle.run.run_id, phase: bundle.run.phase, decision_count: bundle.decisions.length, privacy: bundle.privacy, resume: { status: "PREVIEW_ONLY", requires_repository_recheck: true, requires_approval: true }, bundle };
}

export function buildOtelTrace(options) {
  const run = inspectRun(options);
  const traceId = hash(run.run_id).slice(0, 32);
  return { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "ai-agent-kit" } }, { key: "ai_agent.telemetry.mode", value: { stringValue: "local-redacted" } }] }, scopeSpans: [{ scope: { name: "@hunpeolabs/ai-agent-kit.traceability" }, spans: run.events.map((event) => ({ traceId, spanId: event.record_hash.slice(0, 16), name: `ai_agent.run.${event.data.phase}`, attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "invoke_agent" } }, { key: "ai_agent.run.id_hash", value: { stringValue: hash(run.run_id) } }, { key: "ai_agent.event.offset", value: { intValue: event.offset } }, { key: "ai_agent.record.hash", value: { stringValue: event.record_hash } }], status: { code: event.data.phase === "fail" ? 2 : 1 } })) }] }], privacy: { external_export: false, contains_prompts: false, contains_source: false, contains_secrets: false } };
}

export function proposeCapabilityImprovement(options) {
  const root = rootOf(options.target);
  const candidateId = assertId(options.candidateId, "candidate id");
  const kind = options.kind ?? "skill";
  if (!["skill", "rule", "profile", "plugin", "memory", "routing-fixture"].includes(kind)) throw new Error("unsupported improvement kind");
  const requestedRuns = [...new Set(options.runIds ?? [])].map((id) => assertId(id, "run id"));
  if (requestedRuns.length < 3) return { schema_version: 1, status: "INSUFFICIENT_EVIDENCE", candidate_id: candidateId, required_runs: 3, observed_runs: requestedRuns.length, mutates_policy: false };
  const runs = requestedRuns.map((runId) => inspectRun({ target: root, runId }));
  const stale = runs.filter((run) => run.status !== "CURRENT").map((run) => run.run_id);
  const outcomes = runs.map((run) => run.events.at(-1).data.phase);
  const contradictory = outcomes.includes("close") && outcomes.some((phase) => ["fail", "cancel"].includes(phase));
  const evidence = runs.map((run) => ({ run_id: run.run_id, head_hash: run.integrity.head_hash, phase: run.phase }));
  const proposalBase = { schema_version: 1, candidate_id: candidateId, proposed_at: options.timestamp ?? new Date().toISOString(), kind, scope: options.scope ?? "project", reason: String(options.reason ?? ""), status: stale.length ? "STALE_EVIDENCE" : contradictory ? "CONFLICTING_EVIDENCE" : "REVIEW_REQUIRED", evidence, counter_evidence: contradictory ? evidence.filter((item) => ["fail", "cancel"].includes(item.phase)) : [], freshness: stale.length ? "STALE" : "CURRENT", promotion: { automatic: false, requires_human_review: true, requires_evaluation: true, reversible: true } };
  const proposal = { ...proposalBase, proposal_hash: hash(canonical(proposalBase)) };
  const file = safeOutput(root, `.ai-agent-kit/trace/proposals/${candidateId}.${proposal.proposal_hash.slice(0, 12)}.json`);
  ensurePrivateDirectory(path.dirname(file));
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { ...proposal, file };
}
