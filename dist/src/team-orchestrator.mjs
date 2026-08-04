import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";
import { acknowledgeTeamHandoff, activateTeamContext, briefHash, initializeTeamContext, inspectTeamContext, teamContextSummary } from "./team-context.mjs";

const MAX_FILE = 2 * 1024 * 1024;
const TEAM_TYPES = new Set(["SOLO", "PRODUCT_WORKCELL", "BUG_WORKCELL", "ASSURANCE_WORKCELL"]);
const RESULT_STATUSES = new Set(["COMPLETED", "BLOCKED", "REJECTED", "TIMED_OUT"]);
const ADAPTERS = new Set(["codex", "claude", "other"]);

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

function classify({ goal, risk = "medium", changedAreas = [], shape }) {
  if (shape) { const selected = shape.toUpperCase(); if (!TEAM_TYPES.has(selected)) throw new Error("team shape is invalid"); return { team_type: selected, reasons: ["explicit team shape"] }; }
  const value = `${goal} ${changedAreas.join(" ")}`.toLowerCase();
  const high = risk === "high" || /auth|security|permission|tenant|secret|payment|billing|migration|schema|transaction|concurr|infrastructure|production|deploy/.test(value);
  if (high) return { team_type: "ASSURANCE_WORKCELL", reasons: [risk === "high" ? "high task risk" : "security, data, concurrency, or operational boundary"] };
  if (changedAreas.length <= 1 && /typo|spelling|copy edit|formatting|small documentation/.test(value)) return { team_type: "SOLO", reasons: ["bounded documentation-only task"] };
  if (/\bbug\b|\bfix\b|defect|regression|incident|crash|broken|incorrect|failure/.test(value)) return { team_type: "BUG_WORKCELL", reasons: ["bug or failure intent"] };
  const substantial = changedAreas.length > 1 || /feature|implement|build|add|create|refactor|architecture|api|website/.test(value);
  if (substantial) return { team_type: "PRODUCT_WORKCELL", reasons: [changedAreas.length > 1 ? "multiple change areas" : "feature or architecture intent"] };
  return { team_type: "SOLO", reasons: ["bounded low-complexity task"] };
}

function role(id, name, objective, { write = false, paths = [], dependsOn = [] } = {}) {
  return { id, role: name, objective, write_access: write, allowed_paths: paths, depends_on: dependsOn, status: "PENDING", evidence_hashes: [], finding_count: 0 };
}

function assignments(type, paths) {
  const reviewer = role("independent-reviewer", "Independent Code Reviewer", "Review requirement match, correctness, bad paths, security, production readiness, and trade-offs independently.", { dependsOn: ["implementation-engineer"] });
  if (type === "SOLO") return [role("implementation-engineer", "Implementation Engineer", "Own the approved change and focused verification.", { write: true, paths }), reviewer];
  if (type === "BUG_WORKCELL") return [role("investigator", "Domain Analyst", "Reproduce the bug and identify the first incorrect state."), role("impact-explorer", "Impact Explorer", "Trace callers, consumers, regressions, and preserved behavior."), role("implementation-engineer", "Implementation Engineer", "Implement the smallest approved root-cause fix.", { write: true, paths, dependsOn: ["investigator", "impact-explorer"] }), role("qa-lead", "QA Lead", "Validate the regression, bad paths, and recovery behavior.", { dependsOn: ["implementation-engineer"] }), reviewer];
  if (type === "ASSURANCE_WORKCELL") return [role("impact-explorer", "Impact Explorer", "Map scope, contracts, data, and operational blast radius."), role("solution-architect", "Solution Architect", "Check boundaries, alternatives, failure behavior, and rollback."), role("implementation-engineer", "Implementation Engineer", "Implement only the approved scope.", { write: true, paths, dependsOn: ["impact-explorer", "solution-architect"] }), role("security-reviewer", "Security Reviewer", "Review threats, authorization, sensitive data, abuse, and supply-chain risk.", { dependsOn: ["implementation-engineer"] }), role("qa-lead", "QA Lead", "Validate success, failure, recovery, compatibility, and evidence.", { dependsOn: ["implementation-engineer"] }), reviewer];
  return [role("domain-analyst", "Domain Analyst", "Verify the outcome, requirements, and preserved behavior."), role("impact-explorer", "Impact Explorer", "Map code, data, tests, and downstream impact."), role("implementation-engineer", "Implementation Engineer", "Implement the approved feature as the sole write owner.", { write: true, paths, dependsOn: ["domain-analyst", "impact-explorer"] }), role("qa-lead", "QA Lead", "Validate acceptance criteria and important failure paths.", { dependsOn: ["implementation-engineer"] }), reviewer];
}

function verifyTeam(team) {
  const copy = structuredClone(team); const claimed = copy.team_hash; delete copy.team_hash;
  if (!claimed || hash(copy) !== claimed) throw new Error("team contract hash mismatch");
  return team;
}

function seal(team) { const copy = structuredClone(team); delete copy.team_hash; team.team_hash = hash(copy); return team; }

export function planTeam(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  const existing = readJson(root, teamPath(id), "team contract", false);
  if (existing && verifyTeam(existing).state !== "PLANNED") throw new Error("an active or completed team cannot be replanned");
  const task = readJson(root, taskPath(id), "task record");
  const goal = text(options.goal ?? task.goal, "team goal");
  const paths = [...new Set([...(options.paths ?? []), ...(task.capability?.allowed_paths ?? [])])].slice(0, 100);
  const changedAreas = paths.map((item) => item.split("/")[0]);
  const decision = classify({ goal, risk: options.risk ?? task.capability?.max_risk ?? "medium", changedAreas, shape: options.shape });
  const maxAgents = number(options.maxAgents ?? 6, "max agents", { min: 2 });
  const candidates = assignments(decision.team_type, paths);
  const requiredIds = new Set(["implementation-engineer", "independent-reviewer"]);
  const selected = candidates.length <= maxAgents ? candidates : [...candidates.filter((item) => !requiredIds.has(item.id)).slice(0, Math.max(0, maxAgents - 2)), ...candidates.filter((item) => requiredIds.has(item.id))];
  const selectedIds = new Set(selected.map((item) => item.id));
  for (const item of selected) item.depends_on = item.depends_on.filter((id) => selectedIds.has(id));
  if (!selected.some((item) => item.id === "independent-reviewer")) throw new Error("team budget must preserve an independent reviewer");
  const writeOwners = selected.filter((item) => item.write_access);
  if (writeOwners.length > 1) throw new Error("workcell has overlapping write ownership");
  const team = { schema_version: 1, task_id: id, goal_hash: hash(goal), state: "PLANNED", team_type: decision.team_type, decision_reasons: decision.reasons, execution_mode: "UNSELECTED", adapter: null, repository_brief_required: true, context_protocol_required: true, approval_required_before_writes: true, budgets: { max_agents: maxAgents, max_depth: 1, token_budget: number(options.tokenBudget ?? 60000, "token budget", { min: 1000 }), timeout_seconds: number(options.timeoutSeconds ?? 1800, "timeout", { min: 30 }), max_actions: number(options.maxActions ?? 100, "max actions", { min: 1 }) }, assignments: selected, result_history: [], conflicts: [], created_at: options.now ?? new Date().toISOString(), updated_at: options.now ?? new Date().toISOString() };
  const context = initializeTeamContext({ target: root, id, goalHash: team.goal_hash, paths, acceptanceCriteria: task.acceptance_criteria ?? [], repositoryCommit: task.capability?.repository_commit ?? null, repositoryBriefHash: task.context ? hash(task.context) : null, repositoryIntelligence: task.context?.repository_intelligence?.mode ?? "DEGRADED", approvalHash: task.capability?.approval_hash ?? null, assignments: selected, now: options.now });
  team.context_hash = context.context_hash; team.context_revision = context.revision;
  seal(team); writeJson(root, teamPath(id), team, "team contract");
  return team;
}

export function startTeam(options) {
  const root = path.resolve(options.target ?? process.cwd()); const team = verifyTeam(readJson(root, teamPath(options.id), "team contract"));
  if (team.state !== "PLANNED") throw new Error("only a planned team can start");
  const adapter = options.adapter ?? "other"; if (!ADAPTERS.has(adapter)) throw new Error("team adapter is invalid");
  team.state = "DISPATCH_READY"; team.adapter = adapter; team.execution_mode = ["codex", "claude"].includes(adapter) ? "NATIVE_SUBAGENTS" : "SERIAL_PERSONAS"; team.updated_at = options.now ?? new Date().toISOString();
  const profiles = { "implementation-engineer": "implementer", "independent-reviewer": "reviewer", "impact-explorer": "explorer", investigator: "explorer", "domain-analyst": "explorer", "security-reviewer": "security-engineer", "qa-lead": "qa-lead", "solution-architect": "solution-architect" };
  const task = readJson(root, taskPath(options.id), "task record"); let plannedContext = inspectTeamContext({ target: root, id: options.id });
  if (plannedContext.brief.repository_brief_hash !== hash(task.context ?? {})) plannedContext = initializeTeamContext({ target: root, id: options.id, goalHash: team.goal_hash, paths: task.capability?.allowed_paths ?? [], acceptanceCriteria: task.acceptance_criteria ?? [], repositoryCommit: task.capability?.repository_commit ?? null, repositoryBriefHash: hash(task.context ?? {}), repositoryIntelligence: task.context?.repository_intelligence?.mode ?? "DEGRADED", approvalHash: task.capability?.approval_hash ?? null, assignments: team.assignments, now: options.now });
  const context = activateTeamContext({ target: root, id: options.id, now: options.now });
  team.context_hash = context.context_hash; team.context_revision = context.revision;
  team.dispatch_instructions = team.assignments.map((item) => ({ assignment_id: item.id, native_profile: profiles[item.id] ?? "explorer", objective: item.objective, depends_on: item.depends_on, write_access: item.write_access, allowed_paths: item.allowed_paths, shared_context: `.ai-agent-kit/runtime/team-contexts/${team.task_id}.json`, shared_context_trust: "UNTRUSTED_DATA", brief_hash: briefHash(context), required_handoff: true }));
  seal(team); writeJson(root, teamPath(options.id), team, "team contract"); return team;
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
  if (!["TIMED_OUT"].includes(status) && (!handoffHash || contextAssignment?.latest_handoff_hash !== handoffHash)) throw new Error("assignment result requires its latest shared-context handoff hash");
  if (assignment.id === "independent-reviewer" && status === "COMPLETED" && findingCount > 0) throw new Error("independent review with findings must be REJECTED until fixes are reviewed again");
  if (handoffHash) acknowledgeTeamHandoff({ target: root, id: options.id, assignment: assignment.id, handoffHash, status, now: options.now });
  assignment.status = status; assignment.evidence_hashes = evidence ? [...new Set([...assignment.evidence_hashes, evidence])] : assignment.evidence_hashes; assignment.finding_count = findingCount; assignment.completed_at = options.now ?? new Date().toISOString();
  team.result_history.push({ assignment_id: assignment.id, status, evidence_hash: evidence, handoff_hash: handoffHash, finding_count: findingCount, usage, timestamp: assignment.completed_at });
  if (assignment.id === "independent-reviewer" && status === "REJECTED" && findingCount > 0) { const implementer = team.assignments.find((item) => item.id === "implementation-engineer"); if (implementer) implementer.status = "PENDING"; assignment.status = "PENDING"; }
  team.state = team.assignments.every((item) => item.status === "COMPLETED") ? "COMPLETED" : team.assignments.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "IN_PROGRESS"; team.updated_at = assignment.completed_at;
  seal(team); writeJson(root, teamPath(options.id), team, "team contract"); return team;
}

export function inspectTeam(options) { const root = path.resolve(options.target ?? process.cwd()); return verifyTeam(readJson(root, teamPath(options.id), "team contract")); }

export function reportTeam(options) {
  const team = inspectTeam(options); const completed = team.assignments.filter((item) => item.status === "COMPLETED"); const reviewer = team.assignments.find((item) => item.id === "independent-reviewer"); const context = teamContextSummary(options);
  const usage = team.result_history.reduce((sum, item) => ({ tokens: sum.tokens + (item.usage?.tokens ?? 0), actions: sum.actions + (item.usage?.actions ?? 0), duration_seconds: sum.duration_seconds + (item.usage?.duration_seconds ?? 0) }), { tokens: 0, actions: 0, duration_seconds: 0 });
  const blockers = [];
  if (team.state !== "COMPLETED") blockers.push(`team state is ${team.state}`);
  if (reviewer?.status !== "COMPLETED") blockers.push("independent review is incomplete");
  if (team.assignments.some((item) => item.write_access && item.id === reviewer?.id)) blockers.push("review independence is violated");
  if (context.status !== "READY") blockers.push(`${context.open_conflicts} shared-context conflicts are unresolved`);
  if (completed.some((item) => { const entry = context.assignment_handoffs.find((candidate) => candidate.assignment_id === item.id); return !entry?.latest_handoff_hash || entry.acknowledged_handoff_hash !== entry.latest_handoff_hash || entry.acknowledged_status !== "COMPLETED"; })) blockers.push("completed assignments are missing accepted shared-context handoffs");
  return { schema_version: 1, task_id: team.task_id, team_type: team.team_type, execution_mode: team.execution_mode, status: blockers.length ? "NOT_READY" : "READY", completed_assignments: completed.length, total_assignments: team.assignments.length, review_independence: reviewer && !reviewer.write_access ? "VERIFIED" : "REJECTED", context: { status: context.status, revision: context.revision, knowledge_revision: context.knowledge_revision, handoff_count: context.handoff_count, open_conflicts: context.open_conflicts, context_hash: context.context_hash }, usage, budgets: team.budgets, evidence_hashes: [...new Set(completed.flatMap((item) => item.evidence_hashes))], blockers, team_hash: team.team_hash };
}

export function evaluateTeamCases(fixture) {
  if (fixture?.schema_version !== 1 || !Array.isArray(fixture.cases) || !fixture.cases.length) throw new Error("team orchestration fixture is invalid");
  const results = fixture.cases.map((item) => { const decision = classify({ goal: text(item.goal, "eval goal"), risk: item.risk ?? "medium", changedAreas: (item.paths ?? []).map((entry) => entry.split("/")[0]) }); return { id: safe(item.id, "eval case id"), expected: item.expected_team, actual: decision.team_type, status: decision.team_type === item.expected_team ? "PASSED" : "FAILED" }; });
  return { schema_version: 1, status: results.every((item) => item.status === "PASSED") ? "PASSED" : "FAILED", results };
}
