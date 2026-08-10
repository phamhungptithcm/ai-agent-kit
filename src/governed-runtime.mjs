import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  actionDigest,
  assessAction,
  normalizeActionEnvelope,
  privacyMinimizedAction
} from "./action-gateway.mjs";
import { assertFinalReviewPassed } from "./final-review.mjs";
import { memoryHealth, queryEligibleMemory, transitionMemory } from "./memory-lifecycle.mjs";
import { loadRepositoryPolicyOverlays } from "./policy-overlays.mjs";
import { getPackageVersion } from "./version.mjs";
import { planTeam } from "./team-orchestrator.mjs";

const STATES = ["DISCOVER", "ANALYZE", "PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING", "REVIEW_READY", "RELEASED"];
const NEXT_STATE = new Map(STATES.slice(0, -1).map((state, index) => [state, STATES[index + 1]]));
const REQUIRED_EVIDENCE = {
  ANALYZE: [],
  PLAN_READY: ["repository_intelligence"],
  APPROVED: ["approval_hash", "approver"],
  IMPLEMENTING: ["capability_hash"],
  VERIFYING: ["diff_scope"],
  REVIEW_READY: ["tests", "independent_verifier", "final_review"],
  RELEASED: ["release_reference"]
};

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

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("task id must be 1-128 safe characters");
  return value;
}

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function runtimeRoot(root) {
  return path.join(root, ".ai-agent-kit", "runtime");
}

function taskPath(root, id) {
  return path.join(runtimeRoot(root), "tasks", `${safeId(id)}.json`);
}

function evidencePath(root, id) {
  return path.join(runtimeRoot(root), "evidence", `${safeId(id)}.jsonl`);
}

function telemetryPath(root) {
  return path.join(runtimeRoot(root), "telemetry", "spans.jsonl");
}

function memoryPath(root) {
  return path.join(runtimeRoot(root), "memory", "entries.jsonl");
}

function currentRepositoryCommit(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

function currentPolicyRevision(root) {
  const paths = [
    ".ai/guards/policy.yaml",
    ".ai/guards/capability-policy.yaml",
    ".ai/guards/sandbox-and-secrets.yaml"
  ];
  const legacyPolicy = paths.map((relPath) => {
    const file = path.join(root, relPath);
    return [relPath, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null];
  });
  const overlays = loadRepositoryPolicyOverlays({ target: root, kitVersion: getPackageVersion() });
  return digest({ legacy_policy: legacyPolicy, effective_overlays: overlays.effective, provenance: overlays.provenance });
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readTask(root, id) {
  const file = taskPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function emitSpan(root, name, attributes) {
  appendJsonl(telemetryPath(root), {
    trace_id: crypto.randomBytes(16).toString("hex"),
    span_id: crypto.randomBytes(8).toString("hex"),
    name,
    timestamp: new Date().toISOString(),
    attributes
  });
}

function appendReceipt(root, id, type, data) {
  const file = evidencePath(root, id);
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).at(-1) : "";
  const previousHash = previous ? JSON.parse(previous).receipt_hash : null;
  const receipt = {
    task_id: id,
    type,
    timestamp: new Date().toISOString(),
    previous_receipt_hash: previousHash,
    data
  };
  receipt.receipt_hash = digest(receipt);
  appendJsonl(file, receipt);
  emitSpan(root, `ai_agent.${type}`, { "ai_agent.task.id": id, "ai_agent.receipt.hash": receipt.receipt_hash });
  return receipt;
}

export function createTask(options) {
  const root = rootFor(options.target);
  const id = safeId(options.id);
  if (fs.existsSync(taskPath(root, id))) throw new Error(`task already exists: ${id}`);
  const now = new Date();
  const capability = {
    allowed_tools: options.tools?.length ? options.tools : ["read"],
    allowed_paths: options.paths?.length ? options.paths : [],
    network_domains: options.domains ?? [],
    max_risk: options.risk ?? "low",
    max_actions: Number(options.maxActions ?? 100),
    expires_at: options.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    approval_hash: options.approvalHash ?? null,
    repository_commit: options.repositoryCommit ?? currentRepositoryCommit(root),
    policy_revision: options.policyRevision ?? currentPolicyRevision(root),
    agent_adapter: options.adapter ?? "unknown"
  };
  const task = {
    version: 1,
    id,
    goal: options.goal ?? null,
    acceptance_criteria: options.acceptanceCriteria ?? [],
    state: "DISCOVER",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    capability,
    capability_hash: digest(capability),
    action_count: 0,
    context: { facts: [], assumptions: [] },
    plan: { revision: 0, trigger: "task-created", steps: [] },
    transitions: []
  };
  atomicWrite(taskPath(root, id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, id, "task.created", { state: task.state, capability_hash: task.capability_hash });
  if (task.goal) {
    try {
      const team = planTeam({ target: root, id, goal: task.goal, risk: capability.max_risk, paths: capability.allowed_paths });
      task.orchestration = { status: "PLANNED", team_type: team.team_type, team_hash: team.team_hash };
      appendReceipt(root, id, "team.planned", task.orchestration);
    } catch {
      task.orchestration = { status: "DEGRADED", reason_code: "TEAM_PLANNER_UNAVAILABLE" };
      appendReceipt(root, id, "team.degraded", task.orchestration);
    }
    task.updated_at = new Date().toISOString();
    atomicWrite(taskPath(root, id), `${JSON.stringify(task, null, 2)}\n`);
  }
  return task;
}

export function addContext(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const key = options.kind === "fact" ? "facts" : options.kind === "assumption" ? "assumptions" : null;
  if (!key) throw new Error("context kind must be fact or assumption");
  if (!options.statement) throw new Error("context statement is required");
  if (key === "facts" && !options.source) throw new Error("facts require a source");
  const entry = {
    statement: options.statement,
    source: options.source ?? null,
    confidence: Number(options.confidence ?? (key === "facts" ? 1 : 0.5)),
    recorded_at: new Date().toISOString()
  };
  if (entry.confidence < 0 || entry.confidence > 1) throw new Error("confidence must be between 0 and 1");
  task.context[key].push(entry);
  task.updated_at = entry.recorded_at;
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, `context.${options.kind}`, {
    statement_hash: digest(entry.statement),
    source_hash: entry.source ? digest(entry.source) : null,
    confidence: entry.confidence
  });
  return task;
}

export function recordTaskApproval(options) {
  const root = rootFor(options.target); const task = readTask(root, options.id);
  const approvalHash = String(options.approvalHash ?? "");
  if (!/^[a-f0-9]{64}$/.test(approvalHash)) throw new Error("approval hash must be a SHA-256 digest");
  if (task.capability.approval_hash && task.capability.approval_hash !== approvalHash) throw new Error("a different task approval is already recorded");
  if (task.capability.approval_hash === approvalHash) return task;
  task.capability.approval_hash = approvalHash; task.capability_hash = digest(task.capability); task.updated_at = new Date().toISOString();
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, "approval.recorded", { approval_hash: approvalHash, capability_hash: task.capability_hash });
  return task;
}

export function revisePlan(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  if (!["ANALYZE", "PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING"].includes(task.state)) {
    throw new Error(`task state does not permit planning: ${task.state}`);
  }
  if (!options.trigger) throw new Error("plan revision requires a trigger");
  if (!Array.isArray(options.steps) || !options.steps.length) throw new Error("plan revision requires at least one step");
  const previousHash = digest(task.plan);
  task.plan = {
    revision: task.plan.revision + 1,
    trigger: options.trigger,
    steps: options.steps.map((description, index) => ({ id: index + 1, description, status: "pending" })),
    previous_plan_hash: previousHash,
    revised_at: new Date().toISOString()
  };
  task.updated_at = task.plan.revised_at;
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, "plan.revised", {
    revision: task.plan.revision,
    trigger_hash: digest(options.trigger),
    plan_hash: digest(task.plan),
    previous_plan_hash: previousHash
  });
  return task.plan;
}

export function transitionTask(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const to = String(options.to ?? "").toUpperCase();
  if (NEXT_STATE.get(task.state) !== to) throw new Error(`invalid transition: ${task.state} -> ${to}`);
  const evidence = options.evidence ?? {};
  const missing = (REQUIRED_EVIDENCE[to] ?? []).filter((key) => !evidence[key]);
  if (missing.length) throw new Error(`transition ${to} missing evidence: ${missing.join(", ")}`);
  if (to === "APPROVED" && evidence.approval_hash !== task.capability.approval_hash) {
    throw new Error("approval evidence does not match capability approval hash");
  }
  if (to === "REVIEW_READY") assertFinalReviewPassed({ target: root, id: task.id }, options.deps);
  const transition = { from: task.state, to, timestamp: new Date().toISOString(), evidence_hash: digest(evidence) };
  task.state = to;
  task.updated_at = transition.timestamp;
  task.transitions.push(transition);
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, "task.transition", transition);
  return task;
}

export function authorizeAction(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const envelope = normalizeActionEnvelope({
    ...options,
    approvalHash: options.approvalHash ?? task.capability.approval_hash,
    repositoryCommit: options.repositoryCommit ?? currentRepositoryCommit(root),
    policyRevision: options.policyRevision ?? currentPolicyRevision(root),
    capabilityHash: options.capabilityHash ?? task.capability_hash
  });
  const assessment = assessAction({ task, envelope, now: options.now });
  task.action_count += 1;
  task.updated_at = new Date().toISOString();
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  const receipt = appendReceipt(root, task.id, "policy.decision", {
    decision: assessment.decision,
    reason_code: assessment.reason_code,
    action: privacyMinimizedAction(envelope),
    envelope_hash: assessment.envelope_hash,
    capability_hash: task.capability_hash,
    action_count: task.action_count
  });
  return {
    decision: assessment.decision,
    reason_code: assessment.reason_code,
    envelope_hash: assessment.envelope_hash,
    receipt_hash: receipt.receipt_hash,
    decision_token: receipt.receipt_hash
  };
}

export function evaluateAction(options) {
  return authorizeAction(options);
}

export function simulateAction(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const envelope = normalizeActionEnvelope({
    ...options,
    approvalHash: options.approvalHash ?? task.capability.approval_hash,
    repositoryCommit: options.repositoryCommit ?? currentRepositoryCommit(root),
    policyRevision: options.policyRevision ?? currentPolicyRevision(root),
    capabilityHash: options.capabilityHash ?? task.capability_hash
  });
  const assessment = assessAction({ task, envelope, now: options.now });
  return {
    schema_version: 1,
    mode: "SIMULATION",
    decision: assessment.decision,
    reason_code: assessment.reason_code,
    envelope_hash: assessment.envelope_hash,
    recorded: false,
    executed: false
  };
}

function receiptByHash(root, id, receiptHash) {
  const file = evidencePath(root, id);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
    .map(JSON.parse)
    .find((receipt) => receipt.receipt_hash === receiptHash) ?? null;
}

export function executeAuthorizedAction(options, executor) {
  if (typeof executor !== "function") throw new Error("authorized execution requires an executor");
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const envelope = normalizeActionEnvelope({
    ...options,
    approvalHash: options.approvalHash ?? task.capability.approval_hash,
    repositoryCommit: options.repositoryCommit ?? currentRepositoryCommit(root),
    policyRevision: options.policyRevision ?? currentPolicyRevision(root),
    capabilityHash: options.capabilityHash ?? task.capability_hash
  });
  const decisionReceipt = receiptByHash(root, task.id, options.decisionToken);
  if (!decisionReceipt || decisionReceipt.type !== "policy.decision") {
    appendReceipt(root, task.id, "action.execution", {
      status: "denied",
      reason_code: "DECISION_NOT_FOUND",
      envelope_hash: actionDigest(envelope)
    });
    return { status: "denied", reason_code: "DECISION_NOT_FOUND" };
  }
  if (decisionReceipt.data.decision !== "allow") {
    appendReceipt(root, task.id, "action.execution", {
      status: "denied",
      reason_code: "DECISION_NOT_ALLOW",
      decision_receipt_hash: decisionReceipt.receipt_hash
    });
    return { status: "denied", reason_code: "DECISION_NOT_ALLOW" };
  }
  if (decisionReceipt.data.envelope_hash !== actionDigest(envelope)) {
    appendReceipt(root, task.id, "action.execution", {
      status: "denied",
      reason_code: "ACTION_ENVELOPE_CHANGED",
      decision_receipt_hash: decisionReceipt.receipt_hash
    });
    return { status: "denied", reason_code: "ACTION_ENVELOPE_CHANGED" };
  }
  const current = assessAction({ task: { ...task, action_count: Math.max(0, task.action_count - 1) }, envelope });
  if (current.decision !== "allow") {
    appendReceipt(root, task.id, "action.execution", {
      status: "denied",
      reason_code: current.reason_code,
      decision_receipt_hash: decisionReceipt.receipt_hash
    });
    return { status: "denied", reason_code: current.reason_code };
  }
  try {
    const result = executor(envelope);
    const receipt = appendReceipt(root, task.id, "action.execution", {
      status: "completed",
      decision_receipt_hash: decisionReceipt.receipt_hash,
      envelope_hash: actionDigest(envelope),
      result_hash: actionDigest(result),
      exit_code: Number.isInteger(result?.exitCode) ? result.exitCode : null
    });
    return { status: "completed", result, receipt_hash: receipt.receipt_hash };
  } catch (error) {
    const receipt = appendReceipt(root, task.id, "action.execution", {
      status: "failed",
      decision_receipt_hash: decisionReceipt.receipt_hash,
      envelope_hash: actionDigest(envelope),
      error_hash: actionDigest(error instanceof Error ? error.message : String(error))
    });
    return { status: "failed", receipt_hash: receipt.receipt_hash };
  }
}

export function recordActionVerification(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const status = options.status === "verified" ? "verified" : "rejected";
  const receipt = appendReceipt(root, task.id, "action.verification", {
    status,
    execution_receipt_hash: options.executionReceiptHash ?? null,
    evidence_hash: actionDigest(options.evidence ?? {})
  });
  return { status, receipt_hash: receipt.receipt_hash };
}

export function recordSecurityDecision(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const receipt = appendReceipt(root, task.id, "security.decision", {
    decision: options.decision,
    reason_code: options.reasonCode,
    subject_hash: actionDigest(options.subject ?? {}),
    details_hash: actionDigest(options.details ?? {})
  });
  return {
    decision: options.decision,
    reason_code: options.reasonCode,
    receipt_hash: receipt.receipt_hash
  };
}

export function verifyEvidence(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const file = evidencePath(root, task.id);
  const receipts = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const errors = [];
  if (digest(task.capability) !== task.capability_hash) errors.push("capability hash mismatch");
  let previous = null;
  for (const receipt of receipts) {
    const claimed = receipt.receipt_hash;
    const copy = { ...receipt };
    delete copy.receipt_hash;
    if (receipt.previous_receipt_hash !== previous) errors.push(`broken previous hash at ${claimed}`);
    if (digest(copy) !== claimed) errors.push(`invalid receipt hash: ${claimed}`);
    previous = claimed;
  }
  let storedState = "DISCOVER";
  for (const transition of task.transitions) {
    if (transition.from !== storedState || NEXT_STATE.get(storedState) !== transition.to) errors.push("invalid stored transition order");
    storedState = transition.to;
  }
  if (storedState !== task.state) errors.push("task state does not match transition history");
  if (task.state !== "DISCOVER" && !task.goal) errors.push("task goal is missing");
  if (["PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING", "REVIEW_READY", "RELEASED"].includes(task.state)) {
    if (!task.acceptance_criteria.length) errors.push("acceptance criteria are missing");
    if (!task.plan.steps.length) errors.push("execution plan is missing");
  }
  const result = {
    status: errors.length ? "REJECTED" : "VERIFIED",
    task_id: task.id,
    state: task.state,
    receipt_count: receipts.length,
    latest_receipt_hash: previous,
    errors
  };
  emitSpan(root, "ai_agent.verification", { "ai_agent.task.id": task.id, "ai_agent.verification.status": result.status });
  return result;
}

export function proposeMemory(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  if (!options.title || !options.content || !options.source) {
    throw new Error("memory proposal requires title, content, and source");
  }
  if (String(options.content).length > 16_384 || String(options.title).length > 256 || String(options.source).length > 1024) {
    throw new Error("memory proposal exceeds bounded field limits");
  }
  const sensitive = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b)/i;
  if (sensitive.test(`${options.title}\n${options.content}\n${options.source}`)) {
    throw new Error("memory proposal contains secret-like content");
  }
  const entry = {
    id: digest({ task_id: task.id, title: options.title, content: options.content }).slice(0, 24),
    task_id: task.id,
    title: options.title,
    category: options.category ?? "learning",
    scope: options.scope ?? "repository",
    content: options.content,
    source: options.source,
    source_commit: options.sourceCommit ?? currentRepositoryCommit(root),
    confidence: Number(options.confidence ?? 0.5),
    trust_tier: options.trustTier ?? "provisional",
    status: "proposed",
    approver: null,
    review_date: null,
    expires_at: options.expiresAt ?? null,
    created_at: new Date().toISOString()
  };
  if (entry.confidence < 0 || entry.confidence > 1) throw new Error("confidence must be between 0 and 1");
  if (!new Set(["provisional", "reviewed", "verified"]).has(entry.trust_tier)) throw new Error("trust tier must be provisional, reviewed, or verified");
  entry.content_hash = digest({
    title: entry.title, category: entry.category, scope: entry.scope,
    content: entry.content, source: entry.source, source_commit: entry.source_commit
  });
  appendJsonl(memoryPath(root), entry);
  appendReceipt(root, task.id, "memory.proposed", {
    memory_id: entry.id, content_hash: entry.content_hash, confidence: entry.confidence
  });
  return entry;
}

export function approveMemory(options) {
  const root = rootFor(options.target);
  if (!options.memoryId || !options.approver) throw new Error("memory approval requires memory id and approver");
  const file = memoryPath(root);
  const entries = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  const proposed = [...entries].reverse().find((entry) => entry.id === options.memoryId);
  if (!proposed) throw new Error(`memory not found: ${options.memoryId}`);
  if (proposed.status !== "proposed") throw new Error("only proposed memory can be approved");
  if (!proposed.source_commit) throw new Error("memory approval requires a source commit");
  const defaultReview = new Date();
  defaultReview.setUTCDate(defaultReview.getUTCDate() + 90);
  const reviewDate = options.reviewDate ?? defaultReview.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate ?? "") || new Date(reviewDate) <= new Date(new Date().toISOString().slice(0, 10))) {
    throw new Error("memory approval requires a future review date");
  }
  const approved = {
    ...proposed,
    status: "approved",
    approver: options.approver,
    review_date: reviewDate,
    approved_at: new Date().toISOString()
  };
  appendJsonl(file, approved);
  appendReceipt(root, approved.task_id, "memory.approved", {
    memory_id: approved.id, content_hash: approved.content_hash, approver_hash: digest(approved.approver)
  });
  return approved;
}

export function queryMemory(options) {
  return queryEligibleMemory(options);
}

export function revokeMemory(options) {
  return transitionMemory({ ...options, action: "revoke" });
}

export function supersedeMemory(options) {
  return transitionMemory({ ...options, action: "supersede" });
}

export function inspectMemoryHealth(options) {
  return memoryHealth(options);
}

export function scoreTask(options) {
  const task = readTask(rootFor(options.target), options.id);
  const verification = verifyEvidence(options);
  const dimensions = {
    goal_contract: Boolean(task.goal && task.acceptance_criteria.length),
    evidence_integrity: verification.status === "VERIFIED",
    repository_grounding: task.context.facts.some((fact) => fact.source),
    adaptive_plan: task.plan.revision > 0 && task.plan.steps.length > 0,
    governed_execution: task.action_count > 0
  };
  const passed = Object.values(dimensions).filter(Boolean).length;
  return { task_id: task.id, score: passed / Object.keys(dimensions).length, passed, total: Object.keys(dimensions).length, dimensions };
}

export function inspectTask(options) {
  return readTask(rootFor(options.target), options.id);
}

export function exportEvidence(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const verification = verifyEvidence(options);
  const ledger = fs.existsSync(evidencePath(root, task.id))
    ? fs.readFileSync(evidencePath(root, task.id), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  return { schema_version: 1, task, verification, ledger };
}

export { STATES };
