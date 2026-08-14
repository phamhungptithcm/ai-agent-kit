import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { briefHash, cancelTeamClaim, claimTeamWork, inspectTeamContext, publishTeamHandoff, recordTeamApproval, renewTeamClaim } from "./team-context.mjs";
import { readTeamContract, recordTeamResult, writeTeamContract } from "./team-orchestrator.mjs";
import { hasSymlinkComponent } from "./paths.mjs";
import { findTeamEvent, readTeamEvents, recordTeamEvent, verifyTeamJournal } from "./team-events.mjs";
import { recordTaskApproval } from "./governed-runtime.mjs";
import { acquireRepositoryClaim, consumeHostAttestation, heartbeatRepositoryClaim, releaseRepositoryClaim, validateRepositoryFence } from "./team-registry.mjs";
import { evaluateParentSnapshot, inspectTeamWorkspace } from "./team-workspace.mjs";
import { verifyHostAttestation } from "./team-host-bridge.mjs";

const INGEST_STATUSES = new Set(["COMPLETED", "BLOCKED", "REJECTED", "TIMED_OUT", "CANCELLED", "ORPHANED"]);
const FORBIDDEN_RESULT_KEYS = new Set(["prompt", "raw_prompt", "conversation", "chat_history", "chain_of_thought", "credentials", "secrets"]);
const RESULT_KEYS = new Set(["schema_version", "assignment_id", "status", "usage", "handoff"]);
const USAGE_KEYS = new Set(["tokens", "actions", "duration_seconds"]);
const HANDOFF_KEYS = new Set(["brief_hash", "facts", "findings", "structured_findings", "decisions_needed", "risks", "unresolved_questions", "affected_paths", "tests_recommended", "evidence", "memory_candidates"]);
const MAX_TRANSACTIONS_PER_TASK = 1000;
const MAX_ANALYTICS_BYTES = 16 * 1024 * 1024;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function now(options) { const value = options.now ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(value))) throw new Error("execution timestamp is invalid"); return new Date(value).toISOString(); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function integer(value, label) { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`); return value; }

function transactionPath(root, taskId, key) {
  const relative = `.ai-agent-kit/runtime/team-transactions/${safe(taskId, "task id")}-${safe(key, "transaction id")}.json`;
  if (hasSymlinkComponent(root, relative)) throw new Error("team transaction path cannot contain a symbolic link");
  return path.join(root, relative);
}

function readTransaction(root, taskId, key) {
  const file = transactionPath(root, taskId, key);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("team transaction must be a bounded regular file");
  const transaction = JSON.parse(fs.readFileSync(file, "utf8"));
  const claimed = transaction.transaction_hash;
  const copy = { ...transaction }; delete copy.transaction_hash;
  if (!claimed || digest(copy) !== claimed) throw new Error("team transaction hash mismatch");
  return transaction;
}

function writeTransaction(root, transaction) {
  const file = transactionPath(root, transaction.task_id, transaction.transaction_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...transaction };
  delete next.transaction_hash;
  next.transaction_hash = digest(next);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
  return next;
}

function transactionFiles(root, taskId) {
  const relative = ".ai-agent-kit/runtime/team-transactions";
  if (hasSymlinkComponent(root, relative)) throw new Error("team transaction directory cannot contain a symbolic link");
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  const prefix = `${safe(taskId, "task id")}-`;
  const files = fs.readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
  if (files.length > MAX_TRANSACTIONS_PER_TASK) throw new Error("team transaction history exceeds the recovery scan limit");
  return files;
}

function pendingTransactions(root, taskId) {
  return transactionFiles(root, taskId).map((name) => readTransaction(root, taskId, name.slice(taskId.length + 1, -5))).filter((item) => item.state !== "COMMITTED");
}

function transactionByResult(root, taskId, assignmentId, resultHash) {
  for (const name of transactionFiles(root, taskId)) {
    const transaction = readTransaction(root, taskId, name.slice(taskId.length + 1, -5));
    if (transaction.assignment_id === assignmentId && transaction.result_hash === resultHash) return transaction;
  }
  return null;
}

function rejectForbiddenResultKeys(value, currentPath = "result") {
  if (Array.isArray(value)) { value.forEach((item, index) => rejectForbiddenResultKeys(item, `${currentPath}[${index}]`)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_RESULT_KEYS.has(key.toLowerCase())) throw new Error(`${currentPath}.${key} is forbidden in a structured team result`);
    rejectForbiddenResultKeys(item, `${currentPath}.${key}`);
  }
}

function assignmentFor(team, id) {
  const assignment = team.assignments.find((item) => item.id === id);
  if (!assignment) throw new Error("team assignment does not exist");
  return assignment;
}

function dependenciesComplete(team, assignment) {
  return assignment.depends_on.every((id) => team.assignments.find((item) => item.id === id)?.status === "COMPLETED");
}

function instructionFor(team, assignmentId) {
  const instruction = team.dispatch_instructions?.find((item) => item.assignment_id === assignmentId);
  if (!instruction) throw new Error("team dispatch instruction is missing");
  return instruction;
}

function runReady(team) {
  if (!["DISPATCH_READY", "IN_PROGRESS"].includes(team.state)) throw new Error("team is not ready for execution");
  if (!team.run || ["CANCELLED", "BLOCKED", "COMPLETED"].includes(team.run.state)) throw new Error("team run is not accepting execution work");
}

function approvedForWrite(context) { return Boolean(context.brief.approval_hash); }

function journal(options) {
  try { return { status: "RECORDED", event: recordTeamEvent(options) }; }
  catch (error) { return { status: "UNAVAILABLE", reason: error.message }; }
}

function preflightResultBudget(team, assignment, result) {
  const cumulative = team.result_history.reduce((sum, item) => ({
    tokens: sum.tokens + (item.usage?.tokens ?? 0),
    actions: sum.actions + (item.usage?.actions ?? 0)
  }), { tokens: 0, actions: 0 });
  if (team.result_history.length >= team.budgets.max_actions) throw new Error("team result budget exceeded");
  if (cumulative.tokens + result.usage.tokens > team.budgets.token_budget) throw new Error("team token budget exceeded");
  if (cumulative.actions + result.usage.actions > team.budgets.max_actions) throw new Error("team action budget exceeded");
  if (result.usage.duration_seconds > team.budgets.timeout_seconds) throw new Error("assignment timeout exceeded");
  if (!dependenciesComplete(team, assignment)) throw new Error("assignment dependencies are incomplete");
}

export function nextTeamWave(options) {
  const team = readTeamContract(options); runReady(team);
  const context = inspectTeamContext(options);
  const active = team.assignments.filter((item) => item.status === "RUNNING").length;
  const capacity = Math.max(0, Math.min(team.run.max_concurrency, team.adapter_capabilities?.parallel_dispatch === false ? 1 : team.run.max_concurrency) - active);
  const ready = team.assignments.filter((item) => item.status === "PENDING" && dependenciesComplete(team, item));
  const blockedByApproval = ready.filter((item) => item.write_access && team.approval_required_before_writes && !approvedForWrite(context));
  const dispatchable = ready.filter((item) => !blockedByApproval.includes(item)).slice(0, capacity);
  return {
    schema_version: 1,
    task_id: team.task_id,
    run_id: team.run.run_id,
    execution_mode: team.execution_mode,
    capacity,
    assignments: dispatchable.map((item) => instructionFor(team, item.id)),
    blocked_by_approval: blockedByApproval.map((item) => item.id),
    pending_dependencies: team.assignments.filter((item) => item.status === "PENDING" && !dependenciesComplete(team, item)).map((item) => ({ assignment_id: item.id, depends_on: item.depends_on.filter((id) => team.assignments.find((candidate) => candidate.id === id)?.status !== "COMPLETED") }))
  };
}

export function approveTeamRun(options) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id }); const expectedTeamHash = team.team_hash;
  if (!team.run || ["COMPLETED", "CANCELLED"].includes(team.run.state)) throw new Error("team run cannot accept approval");
  const timestamp = now(options); recordTaskApproval({ target: root, id: team.task_id, approvalHash: options.approvalHash });
  const context = recordTeamApproval({ target: root, id: team.task_id, approvalHash: options.approvalHash, now: timestamp });
  team.context_hash = context.context_hash; team.context_revision = context.revision; team.updated_at = timestamp; if (team.run) team.run.updated_at = timestamp;
  const updated = writeTeamContract({ target: root, team, expectedTeamHash });
  const journalResult = journal({ target: root, id: team.task_id, type: "APPROVAL_RECORDED", now: timestamp, data: { team_hash: updated.team_hash, context_hash: context.context_hash, run_id: updated.run.run_id, approval_hash: options.approvalHash, status: updated.state } });
  return { team: updated, approval_hash: options.approvalHash, journal_status: journalResult.status };
}

export function dispatchTeamAssignment(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id }); const expectedTeamHash = team.team_hash; runReady(team);
  const assignment = assignmentFor(team, options.assignment); const wave = nextTeamWave({ target: root, id: options.id });
  if (!wave.assignments.some((item) => item.assignment_id === assignment.id)) {
    if (wave.blocked_by_approval.includes(assignment.id)) throw new Error("write assignment requires recorded approval before dispatch");
    throw new Error("assignment is not ready for dispatch");
  }
  if (assignment.attempts >= assignment.max_attempts) throw new Error("assignment retry budget is exhausted");
  const agent = safe(options.agent, "agent id"); const timestamp = now(options);
  const context = inspectTeamContext({ target: root, id: options.id });
  const claimed = claimTeamWork({ target: root, id: options.id, assignment: assignment.id, agent, expectedRevision: context.revision, leaseSeconds: options.leaseSeconds, now: timestamp });
  const instruction = instructionFor(team, assignment.id);
  let repositoryClaim = null; let workspaceBinding = null; let hostAttestation = null;
  if (team.control_plane?.enabled) {
    if (!options.identity) {
      cancelTeamClaim({ target: root, id: options.id, claim: claimed.claim.claim_id, agent, reason: "repository identity missing", now: timestamp });
      throw new Error("repository control-plane dispatch requires an authenticated identity");
    }
    try {
      const workspaceTarget = path.resolve(options.workspacePath ?? root);
      if (assignment.write_access && workspaceTarget === root) throw new Error("write assignment requires an isolated worktree path");
      const workspace = inspectTeamWorkspace({ target: workspaceTarget, now: timestamp });
      const coordinator = inspectTeamWorkspace({ target: root, now: timestamp });
      if (workspace.common_git_dir !== coordinator.common_git_dir) throw new Error("assignment worktree does not share the repository Git common directory");
      const parent = evaluateParentSnapshot({ target: workspaceTarget, parentCommit: team.control_plane.parent_commit, allowDirty: false });
      if (parent.status !== "ADMITTED") throw new Error(`assignment workspace failed parent gate: ${parent.blockers.join(", ")}`);
      workspaceBinding = { root: workspace.root, branch: workspace.branch, commit: workspace.commit, snapshot_hash: parent.snapshot_hash };
      repositoryClaim = acquireRepositoryClaim({ target: root, taskId: team.task_id, assignmentId: assignment.id, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, surfaces: assignment.allowed_paths.map((name) => ({ kind: "PATH", name, mode: assignment.write_access ? "WRITE" : "READ" })), workspace: workspaceBinding, leaseSeconds: options.leaseSeconds, now: timestamp }).claim;
      if (team.adapter_capabilities?.native_spawn) {
        if (!options.hostAttestation) throw new Error("native control-plane dispatch requires a host attestation");
        hostAttestation = verifyHostAttestation(options.hostAttestation, { now: timestamp, resolveKey: deps.resolveHostKey, seenNonces: deps.seenHostNonces });
        if (hostAttestation.status !== "VERIFIED" || !hostAttestation.capabilities.includes("native-spawn") || !hostAttestation.capabilities.includes("structured-result")) throw new Error("native host bridge attestation is not verified for required capabilities");
        consumeHostAttestation({ target: root, attestationHash: hostAttestation.attestation_hash, nonceKey: `${options.hostAttestation.key_id}:${options.hostAttestation.nonce}`, expiresAt: hostAttestation.expires_at, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, now: timestamp });
      }
    } catch (error) {
      if (repositoryClaim) try { releaseRepositoryClaim({ target: root, claimId: repositoryClaim.claim_id, fencingToken: repositoryClaim.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp }); } catch { /* preserve admission error */ }
      try { cancelTeamClaim({ target: root, id: options.id, claim: claimed.claim.claim_id, agent, reason: "repository control-plane admission failed", now: timestamp }); } catch { /* preserve admission error */ }
      throw error;
    }
  }
  let externalRunId = options.externalRunId ? safe(options.externalRunId, "external run id") : null;
  let hostExecution = team.adapter_capabilities?.native_spawn ? "ATTESTED_EXTERNAL" : "SERIAL_PERSONA";
  if (team.adapter_capabilities?.native_spawn && deps.hostBridge?.spawn) {
    let response;
    try {
      response = deps.hostBridge.spawn({ task_id: team.task_id, run_id: team.run.run_id, assignment_id: assignment.id, agent_id: agent, instruction, claim_id: claimed.claim.claim_id, repository_claim_id: repositoryClaim?.claim_id ?? null, fencing_token: repositoryClaim?.fencing_token ?? null, workspace: workspaceBinding });
      if (response && typeof response.then === "function") throw new Error("asynchronous host bridges are not supported by the synchronous dispatcher");
      externalRunId = safe(response?.external_run_id, "host external run id");
      hostExecution = "EXECUTED_BY_BRIDGE";
    } catch (error) {
      if (repositoryClaim) try { releaseRepositoryClaim({ target: root, claimId: repositoryClaim.claim_id, fencingToken: repositoryClaim.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp }); } catch { /* preserve host error */ }
      try { cancelTeamClaim({ target: root, id: options.id, claim: claimed.claim.claim_id, agent, reason: "host spawn failed", now: timestamp }); } catch { /* preserve host error */ }
      throw error;
    }
  } else if (team.adapter_capabilities?.native_spawn && !externalRunId) {
    if (repositoryClaim) try { releaseRepositoryClaim({ target: root, claimId: repositoryClaim.claim_id, fencingToken: repositoryClaim.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp }); } catch { /* preserve validation error */ }
    try { cancelTeamClaim({ target: root, id: options.id, claim: claimed.claim.claim_id, agent, reason: "host execution evidence missing", now: timestamp }); } catch { /* preserve validation error */ }
    throw new Error("native dispatch requires a host bridge or --external-run-id evidence");
  }
  const spawnId = `spawn-${crypto.randomUUID()}`;
  delete assignment.blocker;
  assignment.status = "RUNNING"; assignment.attempts += 1;
  assignment.execution = { state: "RUNNING", spawn_id: spawnId, external_run_id: externalRunId, host_execution: hostAttestation ? "VERIFIED_HOST_BRIDGE" : hostExecution, host_attestation_hash: hostAttestation?.attestation_hash ?? null, claim_id: claimed.claim.claim_id, repository_claim_id: repositoryClaim?.claim_id ?? null, fencing_token: repositoryClaim?.fencing_token ?? null, workspace: workspaceBinding, agent_id: agent, principal_id: repositoryClaim?.principal?.principal_id ?? null, started_at: timestamp, last_heartbeat_at: timestamp, previous_spawns: assignment.execution?.spawn_id ? [...(assignment.execution.previous_spawns ?? []), assignment.execution.spawn_id] : [] };
  team.state = "IN_PROGRESS"; team.run.state = "RUNNING"; team.run.dispatch_state = "HOST_DISPATCH_ACTIVE"; team.run.active_assignments = team.assignments.filter((item) => item.status === "RUNNING").length; team.run.updated_at = timestamp; team.updated_at = timestamp;
  try {
    writeTeamContract({ target: root, team, expectedTeamHash });
  } catch (error) {
    if (repositoryClaim) try { releaseRepositoryClaim({ target: root, claimId: repositoryClaim.claim_id, fencingToken: repositoryClaim.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp }); } catch { /* preserve original write failure */ }
    try { cancelTeamClaim({ target: root, id: options.id, claim: claimed.claim.claim_id, agent, reason: "dispatch state write failed", now: timestamp }); } catch { /* preserve the original atomic-write failure */ }
    throw error;
  }
  const journalResult = journal({ target: root, id: team.task_id, type: "ASSIGNMENT_DISPATCHED", now: timestamp, data: { team_hash: team.team_hash, context_hash: claimed.context_hash, run_id: team.run.run_id, assignment_id: assignment.id, spawn_id: spawnId, external_run_id: assignment.execution.external_run_id, agent_id: agent, claim_id: claimed.claim.claim_id, principal_id: assignment.execution.principal_id, repository_claim_id: assignment.execution.repository_claim_id, fencing_token: assignment.execution.fencing_token, workspace_hash: assignment.execution.workspace?.snapshot_hash ?? null, host_attestation_hash: assignment.execution.host_attestation_hash, status: "RUNNING" } });
  return {
    schema_version: 1,
    task_id: team.task_id,
    run_id: team.run.run_id,
    spawn_id: spawnId,
    claim_id: claimed.claim.claim_id,
    agent_id: agent,
    assignment_id: assignment.id,
    context_revision: claimed.revision,
    input_trust: { instructions: "TRUSTED_CONTROL", repository_context: "UNTRUSTED_DATA" },
    instruction: repositoryClaim ? { ...instruction, repository_claim_id: repositoryClaim.claim_id, fencing_token: repositoryClaim.fencing_token, workspace: workspaceBinding, host_attestation_hash: hostAttestation?.attestation_hash ?? null } : instruction,
    repository_claim_id: repositoryClaim?.claim_id ?? null,
    fencing_token: repositoryClaim?.fencing_token ?? null,
    workspace: workspaceBinding,
    host_execution: assignment.execution.host_execution,
    journal_status: journalResult.status
  };
}

export function heartbeatTeamAssignment(options) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id }); const expectedTeamHash = team.team_hash; runReady(team);
  const assignment = assignmentFor(team, options.assignment);
  if (assignment.status !== "RUNNING" || !assignment.execution?.claim_id || !assignment.execution.agent_id) throw new Error("assignment is not running");
  const timestamp = now(options); const context = inspectTeamContext({ target: root, id: options.id });
  const renewed = renewTeamClaim({ target: root, id: options.id, claim: assignment.execution.claim_id, agent: assignment.execution.agent_id, expectedRevision: context.revision, leaseSeconds: options.leaseSeconds, now: timestamp });
  let repositoryRenewed = null;
  if (team.control_plane?.enabled) {
    if (!options.identity) throw new Error("repository control-plane heartbeat requires an authenticated identity");
    repositoryRenewed = heartbeatRepositoryClaim({ target: root, claimId: assignment.execution.repository_claim_id, fencingToken: assignment.execution.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, leaseSeconds: options.leaseSeconds, now: timestamp });
  }
  assignment.execution.last_heartbeat_at = timestamp; team.run.updated_at = timestamp; team.updated_at = timestamp; writeTeamContract({ target: root, team, expectedTeamHash });
  const journalResult = journal({ target: root, id: team.task_id, type: "ASSIGNMENT_HEARTBEAT", now: timestamp, data: { team_hash: team.team_hash, context_hash: renewed.context_hash, run_id: team.run.run_id, assignment_id: assignment.id, spawn_id: assignment.execution.spawn_id, status: "RUNNING" } });
  return { assignment_id: assignment.id, spawn_id: assignment.execution.spawn_id, expires_at: renewed.expires_at, context_revision: renewed.revision, repository_expires_at: repositoryRenewed?.expires_at ?? null, fencing_token: repositoryRenewed?.fencing_token ?? null, journal_status: journalResult.status };
}

export function validateTeamResult(result, expectedAssignment = null) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("team result must be an object");
  rejectForbiddenResultKeys(result);
  if (Object.keys(result).some((key) => !RESULT_KEYS.has(key))) throw new Error("team result contains an unsupported field");
  if (result.schema_version !== 1) throw new Error("team result schema version is invalid");
  const assignmentId = safe(result.assignment_id, "result assignment id");
  if (expectedAssignment && assignmentId !== expectedAssignment) throw new Error("team result assignment does not match the active assignment");
  if (!INGEST_STATUSES.has(result.status)) throw new Error("team result status is invalid");
  if (!result.usage || typeof result.usage !== "object") throw new Error("team result usage is required");
  if (Array.isArray(result.usage) || Object.keys(result.usage).some((key) => !USAGE_KEYS.has(key))) throw new Error("team result usage contains an unsupported field");
  const usage = { tokens: integer(result.usage.tokens, "result tokens"), actions: integer(result.usage.actions, "result actions"), duration_seconds: integer(result.usage.duration_seconds, "result duration") };
  const noHandoff = ["TIMED_OUT", "CANCELLED", "ORPHANED"].includes(result.status);
  if (!noHandoff && (!result.handoff || typeof result.handoff !== "object" || Array.isArray(result.handoff))) throw new Error("team result handoff is required");
  if (result.handoff && Object.keys(result.handoff).some((key) => !HANDOFF_KEYS.has(key))) throw new Error("team result handoff contains an unsupported field");
  return { assignment_id: assignmentId, status: result.status, usage, handoff: noHandoff ? null : result.handoff };
}

function appendRoleEvent(root, team, assignment, result, timestamp, idempotencyKey) {
  const relative = ".ai-agent-kit/runtime/analytics/team-role-events.jsonl";
  if (hasSymlinkComponent(root, relative)) throw new Error("team role analytics path cannot contain a symbolic link");
  const directory = path.join(root, ".ai-agent-kit", "runtime", "analytics"); const file = path.join(root, relative);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("team role analytics must be a regular file");
    if (stat.size > MAX_ANALYTICS_BYTES) throw new Error("team role analytics exceeds the idempotency scan limit");
    const exists = fs.readFileSync(file, "utf8").split("\n").some((line) => {
      if (!line.trim()) return false;
      try { return JSON.parse(line).idempotency_key === idempotencyKey; } catch { throw new Error("team role analytics contains invalid JSON"); }
    });
    if (exists) return "SKIPPED_DUPLICATE";
  }
  const event = { schema_version: 1, idempotency_key: idempotencyKey, task_id_hash: digest(team.task_id), run_id: team.run?.run_id ?? null, team_type: team.team_type, assignment_id: assignment.id, required: assignment.required !== false, status: result.status, finding_count: (result.handoff?.structured_findings?.length ?? 0) + (result.handoff?.findings?.length ?? 0), usage: result.usage, timestamp };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return "RECORDED";
}

export function ingestTeamResult(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id });
  const assignment = assignmentFor(team, options.assignment); const result = validateTeamResult(options.result, assignment.id);
  const resultHash = digest(result);
  const priorTransaction = assignment.execution?.spawn_id ? null : transactionByResult(root, team.task_id, assignment.id, resultHash);
  const idempotencyKey = priorTransaction?.transaction_id ?? digest({ task_id: team.task_id, assignment_id: assignment.id, spawn_id: assignment.execution?.spawn_id ?? null, result });
  let transaction = readTransaction(root, team.task_id, idempotencyKey);
  if (transaction?.state === "COMMITTED") return { team, handoff_hash: transaction.handoff_hash, evidence_hash: transaction.evidence_hash, analytics_status: "SKIPPED_DUPLICATE", journal_status: verifyTeamJournal({ target: root, id: team.task_id }).status, duplicate: true, idempotency_key: idempotencyKey };
  const priorResult = team.result_history.findLast((item) => item.idempotency_key === idempotencyKey);
  const duplicate = findTeamEvent({ target: root, id: team.task_id, type: "RESULT_INGESTED", match: { idempotency_key: idempotencyKey } });
  if (duplicate && !priorResult) return { team, handoff_hash: duplicate.data?.handoff_hash ?? null, evidence_hash: duplicate.data?.evidence_hash ?? null, analytics_status: "SKIPPED_DUPLICATE", journal_status: verifyTeamJournal({ target: root, id: team.task_id }).status, duplicate: true, idempotency_key: idempotencyKey };
  if (priorResult && transaction?.state !== "COMMITTED") {
    const completed = writeTransaction(root, { schema_version: 1, transaction_id: idempotencyKey, task_id: team.task_id, assignment_id: assignment.id, spawn_id: transaction?.spawn_id ?? assignment.execution?.spawn_id ?? null, result_hash: resultHash, prepared_at: transaction?.prepared_at ?? now(options), ...transaction, state: "COMMITTED", handoff_hash: priorResult.handoff_hash, evidence_hash: priorResult.evidence_hash, team_hash: team.team_hash, committed_at: now(options) });
    let analyticsStatus = "RECOVERED";
    try { analyticsStatus = appendRoleEvent(root, team, assignment, result, completed.committed_at, idempotencyKey) === "RECORDED" ? "RECOVERED" : "SKIPPED_DUPLICATE"; } catch { analyticsStatus = "UNAVAILABLE"; }
    const journalResult = duplicate ? { status: verifyTeamJournal({ target: root, id: team.task_id }).status } : journal({ target: root, id: team.task_id, type: "RESULT_INGESTED", now: completed.committed_at, data: { team_hash: team.team_hash, context_hash: team.context_hash, run_id: team.run?.run_id ?? null, assignment_id: assignment.id, spawn_id: transaction?.spawn_id ?? null, status: team.state, result_status: result.status, idempotency_key: idempotencyKey, handoff_hash: completed.handoff_hash, evidence_hash: completed.evidence_hash, usage: result.usage, duplicate: true } });
    return { team, handoff_hash: completed.handoff_hash, evidence_hash: completed.evidence_hash, analytics_status: analyticsStatus, journal_status: journalResult.status, duplicate: true, idempotency_key: idempotencyKey };
  }
  runReady(team);
  if (assignment.status !== "RUNNING") throw new Error("assignment is not running");
  if (team.control_plane?.enabled) {
    const fence = validateRepositoryFence({ target: root, claimId: assignment.execution?.repository_claim_id, fencingToken: assignment.execution?.fencing_token, principalId: assignment.execution?.principal_id, now: options.now });
    if (fence.status !== "VALID") throw new Error("stale or invalid repository fencing token rejects assignment result");
    if (!options.identity) throw new Error("repository control-plane result ingest requires an authenticated identity");
  }
  preflightResultBudget(team, assignment, result); const timestamp = now(options); let handoffHash = transaction?.handoff_hash ?? null;
  if (!transaction) transaction = writeTransaction(root, { schema_version: 1, transaction_id: idempotencyKey, task_id: team.task_id, assignment_id: assignment.id, spawn_id: assignment.execution?.spawn_id ?? null, claim_id: assignment.execution?.claim_id ?? null, state: "PREPARED", result_hash: resultHash, prepared_at: timestamp });
  if (!result.handoff && assignment.execution?.claim_id && assignment.execution.agent_id) cancelTeamClaim({ target: root, id: options.id, claim: assignment.execution.claim_id, agent: assignment.execution.agent_id, reason: `assignment ended with ${result.status}`, now: timestamp });
  if (result.handoff && !handoffHash) {
    const context = inspectTeamContext({ target: root, id: options.id });
    const recovered = context.handoffs.findLast((item) => item.claim_id === assignment.execution.claim_id);
    if (recovered) handoffHash = recovered.handoff_hash;
    else {
      const payload = { ...result.handoff, status: result.status };
      const handoff = publishTeamHandoff({ target: root, id: options.id, claim: assignment.execution.claim_id, agent: assignment.execution.agent_id, expectedRevision: context.revision, payload, now: timestamp });
      handoffHash = handoff.handoff_hash;
    }
    transaction = writeTransaction(root, { ...transaction, state: "HANDOFF_PUBLISHED", handoff_hash: handoffHash, handoff_published_at: timestamp });
  }
  const findingCount = (result.handoff?.structured_findings?.length ?? 0) + (result.handoff?.findings?.length ?? 0);
  const evidenceHash = handoffHash ? digest({ handoff_hash: handoffHash, assignment_id: assignment.id, status: result.status }) : null;
  const updated = (deps.recordTeamResult ?? recordTeamResult)({ target: root, id: options.id, assignment: assignment.id, status: result.status, tokens: result.usage.tokens, actions: result.usage.actions, durationSeconds: result.usage.duration_seconds, handoffHash, evidenceHash, idempotencyKey, findingCount, now: timestamp });
  deps.afterTeamStateCommit?.({ team: updated, assignment: assignment.id, idempotencyKey });
  transaction = writeTransaction(root, { ...transaction, state: "STATE_COMMITTED", handoff_hash: handoffHash, evidence_hash: evidenceHash, team_hash: updated.team_hash, state_committed_at: timestamp });
  let analyticsStatus = "RECORDED";
  try { analyticsStatus = appendRoleEvent(root, updated, updated.assignments.find((item) => item.id === assignment.id), result, timestamp, idempotencyKey); } catch { analyticsStatus = "UNAVAILABLE"; }
  const journalResult = journal({ target: root, id: updated.task_id, type: "RESULT_INGESTED", now: timestamp, data: { team_hash: updated.team_hash, context_hash: updated.context_hash, run_id: updated.run?.run_id ?? null, assignment_id: assignment.id, spawn_id: assignment.execution?.spawn_id ?? null, status: updated.state, result_status: result.status, idempotency_key: idempotencyKey, handoff_hash: handoffHash, evidence_hash: evidenceHash, usage: result.usage, duplicate: false } });
  writeTransaction(root, { ...transaction, state: "COMMITTED", analytics_status: analyticsStatus, journal_status: journalResult.status, committed_at: timestamp });
  let repositoryRelease = null;
  if (team.control_plane?.enabled) repositoryRelease = releaseRepositoryClaim({ target: root, claimId: assignment.execution.repository_claim_id, fencingToken: assignment.execution.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: result.status === "COMPLETED" ? "RELEASED" : "CANCELLED", now: timestamp });
  return { team: updated, handoff_hash: handoffHash, evidence_hash: evidenceHash, analytics_status: analyticsStatus, journal_status: journalResult.status, repository_release: repositoryRelease, duplicate: false, idempotency_key: idempotencyKey };
}

export function cancelTeamRun(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id }); const expectedTeamHash = team.team_hash;
  if (!team.run || ["COMPLETED", "CANCELLED"].includes(team.run.state)) throw new Error("team run cannot be cancelled");
  const timestamp = now(options); const reason = String(options.reason ?? "cancelled by task owner").trim(); if (!reason || reason.length > 1000) throw new Error("cancellation reason is invalid");
  const cancellationTargets = team.assignments.filter((item) => item.status === "RUNNING").map((item) => ({ assignment_id: item.id, spawn_id: item.execution?.spawn_id ?? null, external_run_id: item.execution?.external_run_id ?? null, agent_id: item.execution?.agent_id ?? null }));
  if (cancellationTargets.length && team.adapter_capabilities?.native_spawn) {
    if (!team.adapter_capabilities.cancellation || !deps.hostBridge?.cancel) {
      team.state = "BLOCKED"; team.run.state = "CANCELLATION_PENDING"; team.run.dispatch_state = "HOST_ACTION_REQUIRED"; team.run.cancellation_reason = reason; team.run.cancellation_targets = cancellationTargets; team.run.external_cancellation = team.adapter_capabilities.cancellation ? "HOST_ACTION_REQUIRED" : "UNSUPPORTED"; team.run.updated_at = timestamp; team.updated_at = timestamp;
      return writeTeamContract({ target: root, team, expectedTeamHash });
    }
    for (const target of cancellationTargets) {
      const response = deps.hostBridge.cancel({ ...target, task_id: team.task_id, run_id: team.run.run_id, reason });
      if (response && typeof response.then === "function") throw new Error("asynchronous host bridges are not supported by the synchronous canceller");
      if (response?.status !== "CANCELLED") throw new Error(`host cancellation was not confirmed for ${target.assignment_id}`);
    }
  }
  for (const assignment of team.assignments) {
    if (team.control_plane?.enabled && assignment.status === "RUNNING" && assignment.execution?.repository_claim_id) {
      if (!options.identity) throw new Error("repository control-plane cancellation requires an authenticated identity");
      releaseRepositoryClaim({ target: root, claimId: assignment.execution.repository_claim_id, fencingToken: assignment.execution.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp });
    }
    if (assignment.status === "RUNNING" && assignment.execution?.claim_id && assignment.execution.agent_id) cancelTeamClaim({ target: root, id: team.task_id, claim: assignment.execution.claim_id, agent: assignment.execution.agent_id, reason, now: timestamp });
    if (["PENDING", "RUNNING"].includes(assignment.status)) { assignment.status = "CANCELLED"; assignment.completed_at = timestamp; if (assignment.execution) assignment.execution.state = "CANCELLED"; }
  }
  team.state = "CANCELLED"; team.run.state = "CANCELLED"; team.run.dispatch_state = "CANCELLED"; team.run.active_assignments = 0; team.run.cancelled_at = timestamp; team.run.cancellation_reason = reason; team.run.cancellation_targets = cancellationTargets; team.run.external_cancellation = cancellationTargets.length && team.adapter_capabilities?.native_spawn ? "CONFIRMED" : "NOT_REQUIRED"; team.run.updated_at = timestamp; team.updated_at = timestamp;
  const updated = writeTeamContract({ target: root, team, expectedTeamHash });
  journal({ target: root, id: team.task_id, type: "TEAM_CANCELLED", now: timestamp, data: { team_hash: updated.team_hash, run_id: updated.run.run_id, status: updated.state, reason_code: "OWNER_CANCELLED" } });
  return updated;
}

export function resumeTeamRun(options) {
  const root = path.resolve(options.target ?? process.cwd()); const team = readTeamContract({ target: root, id: options.id }); const expectedTeamHash = team.team_hash;
  if (!team.run || ["COMPLETED", "CANCELLED"].includes(team.run.state)) throw new Error("team run cannot be resumed");
  if (team.control_plane?.enabled && !options.identity) throw new Error("repository control-plane recovery requires an authenticated identity");
  const timestamp = now(options); const stale = []; const context = inspectTeamContext({ target: root, id: options.id });
  if (options.reviewedOrphanedWriter) {
    const reviewed = assignmentFor(team, safe(options.reviewedOrphanedWriter, "reviewed orphaned writer"));
    if (!reviewed.write_access || reviewed.status !== "ORPHANED") throw new Error("reviewed orphaned writer must identify the orphaned write assignment");
    if (reviewed.attempts >= reviewed.max_attempts) throw new Error("orphaned writer retry budget is exhausted");
    reviewed.status = "PENDING"; delete reviewed.blocker;
    reviewed.execution.previous_spawns = [...new Set([...(reviewed.execution.previous_spawns ?? []), reviewed.execution.spawn_id].filter(Boolean))];
    reviewed.execution.state = "PENDING"; reviewed.execution.spawn_id = null; reviewed.execution.external_run_id = null; reviewed.execution.claim_id = null; reviewed.execution.agent_id = null;
  }
  for (const assignment of team.assignments.filter((item) => item.status === "RUNNING")) {
    const last = Date.parse(assignment.execution?.last_heartbeat_at ?? assignment.execution?.started_at ?? team.run.prepared_at); const ageSeconds = (Date.parse(timestamp) - last) / 1000;
    const claim = context.claims.find((item) => item.claim_id === assignment.execution?.claim_id);
    const leaseExpired = !claim || claim.status !== "ACTIVE" || Date.parse(claim.expires_at) <= Date.parse(timestamp);
    if (!leaseExpired && ageSeconds <= team.budgets.timeout_seconds) continue;
    stale.push(assignment.id);
    if (team.control_plane?.enabled && assignment.execution?.repository_claim_id) {
      const fence = validateRepositoryFence({ target: root, claimId: assignment.execution.repository_claim_id, fencingToken: assignment.execution.fencing_token, principalId: assignment.execution.principal_id, now: timestamp });
      if (fence.status === "VALID") releaseRepositoryClaim({ target: root, claimId: assignment.execution.repository_claim_id, fencingToken: assignment.execution.fencing_token, identity: options.identity, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, status: "CANCELLED", now: timestamp });
    }
    if (assignment.execution?.claim_id && assignment.execution.agent_id) cancelTeamClaim({ target: root, id: team.task_id, claim: assignment.execution.claim_id, agent: assignment.execution.agent_id, reason: "stale execution lease", now: timestamp });
    assignment.execution.state = "ORPHANED";
    if (assignment.write_access || assignment.attempts >= assignment.max_attempts) { assignment.status = "ORPHANED"; assignment.blocker = assignment.write_access ? "WRITE_AGENT_ORPHANED_REVIEW_REQUIRED" : "RETRY_BUDGET_EXHAUSTED"; }
    else { assignment.status = "PENDING"; assignment.execution.previous_spawns = [...(assignment.execution.previous_spawns ?? []), assignment.execution.spawn_id].filter(Boolean); assignment.execution.spawn_id = null; assignment.execution.claim_id = null; assignment.execution.agent_id = null; }
  }
  const requiredFailed = team.assignments.some((item) => item.required !== false && ["BLOCKED", "ORPHANED"].includes(item.status));
  team.state = requiredFailed ? "BLOCKED" : team.assignments.some((item) => item.status === "RUNNING") ? "IN_PROGRESS" : "DISPATCH_READY"; team.run.state = requiredFailed ? "BLOCKED" : "READY"; team.run.dispatch_state = requiredFailed ? "HUMAN_REVIEW_REQUIRED" : "READY_FOR_HOST"; team.run.active_assignments = team.assignments.filter((item) => item.status === "RUNNING").length; team.run.updated_at = timestamp; team.updated_at = timestamp;
  writeTeamContract({ target: root, team, expectedTeamHash });
  const journalResult = journal({ target: root, id: team.task_id, type: "TEAM_RESUMED", now: timestamp, data: { team_hash: team.team_hash, run_id: team.run.run_id, status: team.state, stale_assignments: stale } });
  return { team, stale_assignments: stale, next: requiredFailed ? null : nextTeamWave({ target: root, id: team.task_id }), journal_status: journalResult.status };
}

export function recoverTeamRun(options) {
  const root = path.resolve(options.target ?? process.cwd()); const before = verifyTeamJournal({ target: root, id: options.id });
  if (before.status !== "VERIFIED") throw new Error(`team journal verification failed at sequence ${before.failed_sequence}`);
  let team = readTeamContract({ target: root, id: options.id });
  const last = readTeamEvents({ target: root, id: team.task_id }).findLast((event) => event.data?.team_hash) ?? null;
  let reconciled = false;
  if (last?.data?.team_hash && last.data.team_hash !== team.team_hash) {
    journal({ target: root, id: team.task_id, type: "JOURNAL_RECONCILED", now: options.now, data: { team_hash: team.team_hash, context_hash: team.context_hash, run_id: team.run?.run_id ?? null, journal_head: before.journal_head, status: team.state, reason_code: "STATE_AHEAD_OF_JOURNAL" } });
    reconciled = true;
  }
  let recovery = null;
  if (team.run && !["COMPLETED", "CANCELLED"].includes(team.run.state)) {
    recovery = resumeTeamRun(options); team = recovery.team;
  }
  const event = journal({ target: root, id: team.task_id, type: "TEAM_RECOVERED", now: options.now, data: { team_hash: team.team_hash, context_hash: team.context_hash, run_id: team.run?.run_id ?? null, status: team.state, stale_assignments: recovery?.stale_assignments ?? [], reason_code: reconciled ? "JOURNAL_RECONCILED" : "STATE_VERIFIED" } });
  const pending = pendingTransactions(root, team.task_id).map((item) => ({ transaction_id: item.transaction_id, assignment_id: item.assignment_id, state: item.state }));
  return { schema_version: 1, task_id: team.task_id, status: event.status === "RECORDED" && !pending.length ? "RECOVERED" : "DEGRADED", reconciled, stale_assignments: recovery?.stale_assignments ?? [], pending_ingest_transactions: pending, team, next: recovery?.next ?? null, journal: verifyTeamJournal({ target: root, id: team.task_id }) };
}
