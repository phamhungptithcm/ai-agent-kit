import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";
import { acknowledgeTeamHandoff, activateTeamContext, briefHash, initializeTeamContext, inspectTeamContext, synthesizeTeamFindings, teamContextSummary } from "./team-context.mjs";
import { executionModeFor, resolveExecutionAdapter } from "./execution-adapters.mjs";
import { buildTeamAssignments, classifyTeam, compileTeamSignals, teamPlanningHash } from "./team-role-catalog.mjs";
import { recordTeamEvent } from "./team-events.mjs";

const MAX_FILE = 2 * 1024 * 1024;
const RESULT_STATUSES = new Set(["COMPLETED", "BLOCKED", "REJECTED", "TIMED_OUT", "CANCELLED", "ORPHANED"]);
const TERMINAL_ASSIGNMENT_STATUSES = new Set(RESULT_STATUSES);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function text(value, label, max = 2000) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be 1-${max} characters`); return value.trim(); }
function number(value, label, { min = 0, integer = true } = {}) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) throw new Error(`${label} is invalid`); return value; }

function inside(root, rel, label) {
  const file = path.resolve(root, rel); const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error(`${label} must remain inside a non-symlinked repository path`);
  return file;
}

function readJson(root, rel, label, required = true) {
  const file = inside(root, rel, label);
  if (!fs.existsSync(file)) { if (required) throw new Error(`${label} is missing`); return null; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) throw new Error(`${label} must be a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} contains invalid JSON`); }
}

function writeJson(root, rel, value, label) {
  const file = inside(root, rel, label); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
  const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); return file;
}

function taskPath(id) { return `.ai-agent-kit/runtime/tasks/${safe(id, "task id")}.json`; }
function teamPath(id) { return `.ai-agent-kit/runtime/teams/${safe(id, "task id")}.json`; }
function teamLockPath(id) { return `.ai-agent-kit/runtime/teams/${safe(id, "task id")}.lock`; }

function withTeamLock(root, id, callback) {
  const file = inside(root, teamLockPath(id), "team contract lock"); fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try { descriptor = fs.openSync(file, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("team contract lock is unsafe");
    if (Date.now() - stat.mtimeMs <= 30000) throw new Error("team contract is being updated; sync and retry");
    fs.unlinkSync(file); descriptor = fs.openSync(file, "wx", 0o600);
  }
  try { return callback(); } finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}

function verifyTeam(team) {
  const copy = structuredClone(team); const claimed = copy.team_hash; delete copy.team_hash;
  if (!claimed || hash(copy) !== claimed) throw new Error("team contract hash mismatch");
  return team;
}

function seal(team) { const copy = structuredClone(team); delete copy.team_hash; team.team_hash = hash(copy); return team; }
function journal(options) { try { recordTeamEvent(options); } catch { /* team state remains authoritative; recover reconciles journal gaps */ } }

export function readTeamContract(options) {
  const root = path.resolve(options.target ?? process.cwd());
  return verifyTeam(readJson(root, teamPath(options.id), "team contract"));
}

export function writeTeamContract(options) {
  const root = path.resolve(options.target ?? process.cwd());
  const id = safe(options.team?.task_id, "task id");
  return withTeamLock(root, id, () => {
    if (options.expectedTeamHash) {
      const current = verifyTeam(readJson(root, teamPath(id), "team contract"));
      if (current.team_hash !== options.expectedTeamHash) throw new Error(`team contract revision conflict: expected ${options.expectedTeamHash}, current ${current.team_hash}`);
    }
    const team = seal(options.team); writeJson(root, teamPath(id), team, "team contract"); return team;
  });
}

export function planTeam(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  const existing = readJson(root, teamPath(id), "team contract", false);
  if (existing && verifyTeam(existing).state !== "PLANNED") throw new Error("an active or completed team cannot be replanned");
  const task = readJson(root, taskPath(id), "task record");
  const goal = text(options.goal ?? task.goal, "team goal");
  const paths = [...new Set([...(options.paths ?? []), ...(task.capability?.allowed_paths ?? [])])].slice(0, 100);
  const risk = options.risk ?? task.capability?.max_risk ?? "medium";
  const maxAgents = number(options.maxAgents ?? 6, "max agents", { min: 2 }); if (maxAgents > 6) throw new Error("max agents cannot exceed 6");
  const signals = compileTeamSignals({ task, goal, paths, risk });
  const decision = classifyTeam({ signals, shape: options.shape });
  const selected = buildTeamAssignments({ type: decision.team_type, paths, signals, maxAgents });
  if (!selected.some((item) => item.id === "independent-reviewer")) throw new Error("team budget must preserve an independent reviewer");
  const writeOwners = selected.filter((item) => item.write_access);
  if (writeOwners.length > 1) throw new Error("workcell has overlapping write ownership");
  const planningHash = teamPlanningHash({ goal, paths, task, risk, shape: options.shape, maxAgents });
  const team = { schema_version: 2, task_id: id, goal_hash: hash(goal), state: "PLANNED", team_type: decision.team_type, decision_reasons: decision.reasons, planning: { revision: (existing?.planning?.revision ?? 0) + 1, planning_hash: planningHash, signal_hash: signals.signal_hash, signals, requested_shape: options.shape ?? null, risk, skill_routing: task.skill_routing ?? null, execution_context: task.execution_context ?? null }, execution_mode: "UNSELECTED", adapter: null, adapter_capabilities: null, repository_brief_required: true, context_protocol_required: true, approval_required_before_writes: true, budgets: { max_agents: maxAgents, max_depth: 1, token_budget: number(options.tokenBudget ?? 60000, "token budget", { min: 1000 }), timeout_seconds: number(options.timeoutSeconds ?? 1800, "timeout", { min: 30 }), max_actions: number(options.maxActions ?? 100, "max actions", { min: 1 }), max_concurrency: number(options.maxConcurrency ?? 3, "max concurrency", { min: 1 }) }, assignments: selected, result_history: [], conflicts: [], run: null, created_at: existing?.created_at ?? options.now ?? new Date().toISOString(), updated_at: options.now ?? new Date().toISOString() };
  const context = initializeTeamContext({ target: root, id, goalHash: team.goal_hash, paths, acceptanceCriteria: task.acceptance_criteria ?? [], repositoryCommit: task.capability?.repository_commit ?? null, repositoryBriefHash: task.context ? hash(task.context) : null, repositoryIntelligence: task.context?.repository_intelligence?.mode ?? "DEGRADED", approvalHash: task.capability?.approval_hash ?? null, assignments: selected, now: options.now });
  team.context_hash = context.context_hash; team.context_revision = context.revision;
  seal(team); writeJson(root, teamPath(id), team, "team contract");
  journal({ target: root, id, type: "TEAM_PLANNED", now: team.updated_at, data: { team_hash: team.team_hash, context_hash: team.context_hash, status: team.state, team_type: team.team_type } });
  return team;
}

export function startTeam(options) {
  const root = path.resolve(options.target ?? process.cwd()); let team = verifyTeam(readJson(root, teamPath(options.id), "team contract"));
  if (team.state !== "PLANNED") throw new Error("only a planned team can start");
  const task = readJson(root, taskPath(options.id), "task record");
  const goal = text(task.goal, "team goal"); const paths = task.capability?.allowed_paths ?? [];
  const currentPlanningHash = teamPlanningHash({ goal, paths, task, risk: team.planning?.risk ?? task.capability?.max_risk ?? "medium", shape: team.planning?.requested_shape, maxAgents: team.budgets.max_agents });
  if (team.planning?.planning_hash !== currentPlanningHash) team = planTeam({ target: root, id: options.id, goal, paths, risk: team.planning?.risk, shape: team.planning?.requested_shape, maxAgents: team.budgets.max_agents, tokenBudget: team.budgets.token_budget, timeoutSeconds: team.budgets.timeout_seconds, maxActions: team.budgets.max_actions, maxConcurrency: team.budgets.max_concurrency, now: options.now });
  const adapter = options.adapter ?? "other"; const capabilities = resolveExecutionAdapter(adapter, options.capabilities);
  team.state = "DISPATCH_READY"; team.adapter = adapter; team.adapter_capabilities = capabilities; team.execution_mode = executionModeFor(capabilities); team.updated_at = options.now ?? new Date().toISOString();
  const profiles = { "implementation-engineer": "implementer", "independent-reviewer": "reviewer", "impact-explorer": "explorer", investigator: "explorer", "domain-analyst": "explorer", "security-reviewer": "security-engineer", "qa-lead": "qa-lead", "solution-architect": "solution-architect" };
  let plannedContext = inspectTeamContext({ target: root, id: options.id });
  if (plannedContext.brief.repository_brief_hash !== hash(task.context ?? {})) plannedContext = initializeTeamContext({ target: root, id: options.id, goalHash: team.goal_hash, paths: task.capability?.allowed_paths ?? [], acceptanceCriteria: task.acceptance_criteria ?? [], repositoryCommit: task.capability?.repository_commit ?? null, repositoryBriefHash: hash(task.context ?? {}), repositoryIntelligence: task.context?.repository_intelligence?.mode ?? "DEGRADED", approvalHash: task.capability?.approval_hash ?? null, assignments: team.assignments, now: options.now });
  const context = activateTeamContext({ target: root, id: options.id, now: options.now });
  team.context_hash = context.context_hash; team.context_revision = context.revision;
  const requestedConcurrency = number(options.maxConcurrency ?? team.budgets.max_concurrency ?? capabilities.max_concurrency, "max concurrency", { min: 1 });
  const maxConcurrency = Math.min(requestedConcurrency, capabilities.max_concurrency, team.budgets.max_agents);
  team.budgets.max_concurrency = maxConcurrency;
  team.run = { run_id: `run-${crypto.randomUUID()}`, state: "READY", dispatch_state: "READY_FOR_HOST", max_concurrency: maxConcurrency, active_assignments: 0, prepared_at: team.updated_at, updated_at: team.updated_at, cancelled_at: null, cancellation_reason: null };
  team.dispatch_instructions = team.assignments.map((item) => ({ assignment_id: item.id, native_profile: profiles[item.id] ?? item.id, objective: item.objective, depends_on: item.depends_on, phase: item.phase, required: item.required, blocking: item.blocking, write_access: item.write_access, allowed_paths: item.allowed_paths, shared_context: `.ai-agent-kit/runtime/team-contexts/${team.task_id}.json`, shared_context_trust: "UNTRUSTED_DATA", brief_hash: briefHash(context), skill_route_hash: task.skill_routing?.config_hash ?? null, routed_skill: task.skill_routing?.skill ?? null, context_pack_hash: task.execution_context?.content_hash ?? null, expected_output_schema: "team-result-v1", token_budget: Math.floor(team.budgets.token_budget / team.assignments.length), timeout_seconds: team.budgets.timeout_seconds, max_attempts: item.max_attempts, required_handoff: true, forbidden_actions: ["commit", "push", "deploy", "publish", "release", "external-account-mutation"] }));
  seal(team); writeJson(root, teamPath(options.id), team, "team contract");
  journal({ target: root, id: team.task_id, type: "TEAM_STARTED", now: team.updated_at, data: { team_hash: team.team_hash, context_hash: team.context_hash, run_id: team.run.run_id, status: team.state, adapter: team.adapter, execution_mode: team.execution_mode, team_type: team.team_type } });
  return team;
}

export function recordTeamResult(options) {
  const root = path.resolve(options.target ?? process.cwd()); const team = verifyTeam(readJson(root, teamPath(options.id), "team contract"));
  if (team.state !== "DISPATCH_READY" && team.state !== "IN_PROGRESS") throw new Error("team is not accepting assignment results");
  const assignment = team.assignments.find((item) => item.id === options.assignment); if (!assignment) throw new Error("team assignment does not exist");
  if (assignment.status === "COMPLETED") throw new Error("completed assignment cannot be overwritten");
  const status = options.status; if (!RESULT_STATUSES.has(status)) throw new Error("assignment result status is invalid");
  const usage = { tokens: number(options.tokens, "assignment tokens"), actions: number(options.actions, "assignment actions"), duration_seconds: number(options.durationSeconds, "assignment duration") };
  const cumulative = team.result_history.reduce((sum, item) => ({ tokens: sum.tokens + (item.usage?.tokens ?? 0), actions: sum.actions + (item.usage?.actions ?? 0), duration_seconds: sum.duration_seconds + (item.usage?.duration_seconds ?? 0) }), { tokens: 0, actions: 0, duration_seconds: 0 });
  if (team.result_history.length >= team.budgets.max_actions) throw new Error("team result budget exceeded");
  if (cumulative.tokens + usage.tokens > team.budgets.token_budget) throw new Error("team token budget exceeded");
  if (cumulative.actions + usage.actions > team.budgets.max_actions) throw new Error("team action budget exceeded");
  if (usage.duration_seconds > team.budgets.timeout_seconds) throw new Error("assignment timeout exceeded");
  if (assignment.depends_on.some((id) => team.assignments.find((item) => item.id === id)?.status !== "COMPLETED")) throw new Error("assignment dependencies are incomplete");
  const evidence = options.evidenceHash ? safe(options.evidenceHash, "evidence hash") : null;
  if (status === "COMPLETED" && !/^[a-f0-9]{64}$/.test(evidence ?? "")) throw new Error("completed assignment requires a SHA-256 evidence hash");
  const findingCount = number(options.findingCount ?? 0, "finding count");
  const context = inspectTeamContext({ target: root, id: options.id }); const contextAssignment = context.assignments.find((item) => item.id === assignment.id);
  const handoffHash = options.handoffHash ? safe(options.handoffHash, "handoff hash") : null;
  if (!["TIMED_OUT", "CANCELLED", "ORPHANED"].includes(status) && (!handoffHash || contextAssignment?.latest_handoff_hash !== handoffHash)) throw new Error("assignment result requires its latest shared-context handoff hash");
  if (assignment.id === "independent-reviewer" && status === "COMPLETED" && findingCount > 0) throw new Error("independent review with findings must be REJECTED until fixes are reviewed again");
  if (handoffHash) acknowledgeTeamHandoff({ target: root, id: options.id, assignment: assignment.id, handoffHash, status, now: options.now });
  const completedAt = options.now ?? new Date().toISOString();
  assignment.status = status; assignment.evidence_hashes = evidence ? [...new Set([...assignment.evidence_hashes, evidence])] : assignment.evidence_hashes; assignment.finding_count = findingCount; assignment.completed_at = completedAt;
  if (assignment.execution) { assignment.execution.state = status; assignment.execution.last_heartbeat_at = completedAt; }
  team.result_history.push({ assignment_id: assignment.id, status, evidence_hash: evidence, handoff_hash: handoffHash, idempotency_key: options.idempotencyKey ?? null, finding_count: findingCount, usage, timestamp: completedAt });
  if (status === "TIMED_OUT") {
    if (assignment.write_access) { assignment.status = "ORPHANED"; assignment.blocker = "WRITE_AGENT_ORPHANED_REVIEW_REQUIRED"; }
    else if (assignment.attempts < assignment.max_attempts) {
      assignment.status = "PENDING"; assignment.completed_at = null;
      if (assignment.execution) { assignment.execution.state = "PENDING"; assignment.execution.previous_spawns = [...(assignment.execution.previous_spawns ?? []), assignment.execution.spawn_id].filter(Boolean); assignment.execution.spawn_id = null; assignment.execution.external_run_id = null; assignment.execution.claim_id = null; assignment.execution.agent_id = null; }
    } else { assignment.status = "BLOCKED"; assignment.blocker = "RETRY_BUDGET_EXHAUSTED"; }
  }
  const fixLoopRequired = status === "REJECTED" && findingCount > 0 && assignment.blocking !== false && ["ASSURANCE", "REVIEW"].includes(assignment.phase);
  if (fixLoopRequired) {
    for (const candidate of team.assignments.filter((item) => item.id === "implementation-engineer" || item.id === "independent-reviewer" || item.depends_on.includes("implementation-engineer"))) {
      candidate.status = "PENDING"; candidate.completed_at = null;
      delete candidate.blocker;
      if (candidate.execution) { candidate.execution.state = "PENDING"; candidate.execution.spawn_id = null; candidate.execution.external_run_id = null; candidate.execution.claim_id = null; candidate.execution.agent_id = null; }
    }
  }
  if (status === "REJECTED" && assignment.required !== false && !fixLoopRequired) { assignment.status = "BLOCKED"; assignment.blocker = "REJECTED_ASSIGNMENT_REQUIRES_TEAM_LEAD_REVIEW"; }
  const requiredAssignments = team.assignments.filter((item) => item.required !== false);
  const allTerminal = team.assignments.every((item) => TERMINAL_ASSIGNMENT_STATUSES.has(item.status));
  const requiredComplete = requiredAssignments.every((item) => item.status === "COMPLETED");
  const requiredFailed = requiredAssignments.some((item) => ["BLOCKED", "CANCELLED", "ORPHANED"].includes(item.status));
  team.state = requiredComplete && allTerminal ? "COMPLETED" : requiredFailed ? "BLOCKED" : "IN_PROGRESS"; team.updated_at = completedAt;
  if (team.run) {
    team.run.state = team.state === "COMPLETED" ? "COMPLETED" : team.state === "BLOCKED" ? "BLOCKED" : "RUNNING";
    team.run.updated_at = team.updated_at; team.run.active_assignments = team.assignments.filter((item) => item.status === "RUNNING").length;
    team.run.dispatch_state = team.state === "COMPLETED" ? "COMPLETED" : team.state === "BLOCKED" ? "HUMAN_REVIEW_REQUIRED" : team.run.active_assignments ? "HOST_DISPATCH_ACTIVE" : "READY_FOR_HOST";
  }
  seal(team); writeJson(root, teamPath(options.id), team, "team contract"); return team;
}

export function inspectTeam(options) { return readTeamContract(options); }

export function reportTeam(options) {
  const team = inspectTeam(options); const completed = team.assignments.filter((item) => item.status === "COMPLETED"); const reviewer = team.assignments.find((item) => item.id === "independent-reviewer"); const context = teamContextSummary(options);
  const findings = synthesizeTeamFindings(options);
  const usage = team.result_history.reduce((sum, item) => ({ tokens: sum.tokens + (item.usage?.tokens ?? 0), actions: sum.actions + (item.usage?.actions ?? 0), duration_seconds: sum.duration_seconds + (item.usage?.duration_seconds ?? 0) }), { tokens: 0, actions: 0, duration_seconds: 0 });
  const blockers = [];
  if (team.state !== "COMPLETED") blockers.push(`team state is ${team.state}`);
  if (reviewer?.status !== "COMPLETED") blockers.push("independent review is incomplete");
  if (team.assignments.some((item) => item.write_access && item.id === reviewer?.id)) blockers.push("review independence is violated");
  if (context.status !== "READY") blockers.push(`${context.open_conflicts} shared-context conflicts are unresolved`);
  if (completed.some((item) => { const entry = context.assignment_handoffs.find((candidate) => candidate.assignment_id === item.id); return !entry?.latest_handoff_hash || entry.acknowledged_handoff_hash !== entry.latest_handoff_hash || entry.acknowledged_status !== "COMPLETED"; })) blockers.push("completed assignments are missing accepted shared-context handoffs");
  const optionalFailures = team.assignments.filter((item) => item.required === false && item.status !== "COMPLETED");
  const optionalIds = new Set(team.assignments.filter((item) => item.required === false).map((item) => item.id));
  const optionalFindings = findings.filter((item) => item.specialists.every((id) => optionalIds.has(id)));
  const blockingFindings = findings.filter((item) => !item.specialists.every((id) => optionalIds.has(id)));
  if (blockingFindings.length) blockers.push(`${blockingFindings.length} blocking structured findings remain open`);
  if (optionalFindings.some((item) => ["CRITICAL", "HIGH"].includes(item.severity))) blockers.push("an optional specialist reported a critical or high finding");
  return { schema_version: 2, task_id: team.task_id, team_type: team.team_type, planning: team.planning, execution_mode: team.execution_mode, adapter_capabilities: team.adapter_capabilities, run: team.run, status: blockers.length ? "NOT_READY" : optionalFailures.length || optionalFindings.length ? "DEGRADED" : "READY", completed_assignments: completed.length, total_assignments: team.assignments.length, optional_failures: optionalFailures.map((item) => ({ assignment_id: item.id, status: item.status })), optional_finding_count: optionalFindings.length, review_independence: reviewer && !reviewer.write_access ? "VERIFIED" : "REJECTED", findings, context: { status: context.status, revision: context.revision, knowledge_revision: context.knowledge_revision, handoff_count: context.handoff_count, open_conflicts: context.open_conflicts, context_hash: context.context_hash }, usage, budgets: team.budgets, evidence_hashes: [...new Set(completed.flatMap((item) => item.evidence_hashes))], blockers, team_hash: team.team_hash };
}

export function evaluateTeamCases(fixture) {
  if (fixture?.schema_version !== 1 || !Array.isArray(fixture.cases) || !fixture.cases.length) throw new Error("team orchestration fixture is invalid");
  const results = fixture.cases.map((item) => { const goal = text(item.goal, "eval goal"); const paths = item.paths ?? []; const task = { context: { facts: [], assumptions: [] } }; const signals = compileTeamSignals({ task, goal, paths, risk: item.risk ?? "medium" }); const decision = classifyTeam({ signals }); return { id: safe(item.id, "eval case id"), expected: item.expected_team, actual: decision.team_type, status: decision.team_type === item.expected_team ? "PASSED" : "FAILED" }; });
  return { schema_version: 1, status: results.every((item) => item.status === "PASSED") ? "PASSED" : "FAILED", results };
}
