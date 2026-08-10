import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTask } from "./governed-runtime.mjs";
import { approveTeamRun, dispatchTeamAssignment, ingestTeamResult, nextTeamWave } from "./team-executor.mjs";
import { briefHash, inspectTeamContext } from "./team-context.mjs";
import { reportTeam, startTeam } from "./team-orchestrator.mjs";
import { buildTeamTimeline, recordTeamEvent, writeTeamTimeline } from "./team-events.mjs";
import { hasSymlinkComponent } from "./paths.mjs";

function result(root, id, assignment, options = {}) {
  const context = inspectTeamContext({ target: root, id });
  return {
    schema_version: 1,
    assignment_id: assignment,
    status: options.status ?? "COMPLETED",
    usage: { tokens: options.tokens ?? 120, actions: options.actions ?? 1, duration_seconds: options.durationSeconds ?? 8 },
    handoff: {
      brief_hash: briefHash(context), facts: options.status === "REJECTED" ? [] : [`${assignment} produced bounded synthetic evidence`],
      findings: options.status === "REJECTED" ? ["Synthetic authorization regression requires a fix"] : [],
      structured_findings: options.status === "REJECTED" ? [{ severity: "HIGH", confidence: 0.95, category: "authorization", summary: "Tenant ownership check is missing", path: "src/auth.mjs", line: 1, recommendation: "Require tenant ownership before returning account data" }] : [],
      affected_paths: assignment === "implementation-engineer" ? ["src/auth.mjs"] : [], tests_recommended: ["Run the bounded authorization regression"],
      evidence: [{ path: "src/auth.mjs", line_start: 1, line_end: 1 }]
    }
  };
}

function runAssignment(root, id, assignment, options = {}) {
  dispatchTeamAssignment({ target: root, id, assignment, agent: `demo-${assignment}`, externalRunId: `synthetic-${assignment}-${options.attempt ?? 1}`, now: options.now });
  return ingestTeamResult({ target: root, id, assignment, result: result(root, id, assignment, options), now: options.now });
}

export function runTeamDemo(options = {}) {
  const target = path.resolve(options.target ?? process.cwd()); const id = options.id ?? "agent-department-demo";
  const demoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-team-demo-"));
  try {
    fs.mkdirSync(path.join(demoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(demoRoot, "src", "auth.mjs"), "export const authorizeTenant = (actor, tenant) => actor.tenant === tenant;\n", { mode: 0o600 });
    createTask({ target: demoRoot, id, goal: "Change a tenant authorization API safely and verify failure recovery", acceptanceCriteria: ["Tenant isolation is preserved", "Independent review is clean"], paths: ["src/**"], tools: ["read", "edit", "test"], risk: "high", approvalHash: null });
    startTeam({ target: demoRoot, id, adapter: "codex", maxConcurrency: 3, now: "2026-08-09T12:00:00.000Z" });

    for (const item of nextTeamWave({ target: demoRoot, id }).assignments) runAssignment(demoRoot, id, item.assignment_id, { now: "2026-08-09T12:01:00.000Z" });
    const blocked = nextTeamWave({ target: demoRoot, id });
    if (!blocked.blocked_by_approval.includes("implementation-engineer")) throw new Error("synthetic demo failed to exercise the approval gate");
    recordTeamEvent({ target: demoRoot, id, type: "APPROVAL_BLOCKED", now: "2026-08-09T12:02:00.000Z", data: { run_id: blocked.run_id, assignment_id: "implementation-engineer", status: "BLOCKED", reason_code: "APPROVAL_REQUIRED" } });
    approveTeamRun({ target: demoRoot, id, approvalHash: "a".repeat(64), now: "2026-08-09T12:03:00.000Z" });

    runAssignment(demoRoot, id, "implementation-engineer", { now: "2026-08-09T12:04:00.000Z", attempt: 1 });
    runAssignment(demoRoot, id, "qa-lead", { now: "2026-08-09T12:05:00.000Z", status: "REJECTED", attempt: 1 });
    runAssignment(demoRoot, id, "implementation-engineer", { now: "2026-08-09T12:06:00.000Z", attempt: 2 });
    for (const item of nextTeamWave({ target: demoRoot, id }).assignments) runAssignment(demoRoot, id, item.assignment_id, { now: "2026-08-09T12:07:00.000Z", attempt: 2 });
    const finalWave = nextTeamWave({ target: demoRoot, id });
    for (const item of finalWave.assignments) runAssignment(demoRoot, id, item.assignment_id, { now: "2026-08-09T12:08:00.000Z" });

    const report = reportTeam({ target: demoRoot, id }); const timeline = buildTeamTimeline({ target: demoRoot, id, synthetic: true });
    if (report.status !== "READY") throw new Error(`synthetic demo did not reach READY: ${report.blockers.join(", ")}`);
    const output = path.resolve(target, options.output ?? ".ai-agent-kit/demo/agent-department"); const relative = path.relative(target, output);
    if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(target, relative)) throw new Error("team demo output must remain inside the repository");
    const artifacts = writeTeamTimeline({ target, id, output: relative, timeline });
    const summary = { schema_version: 1, synthetic: true, non_production_evidence: true, task_id: id, scenario: "approval gate plus assurance fix loop", status: report.status, team_type: report.team_type, execution_mode: report.execution_mode, completed_assignments: report.completed_assignments, total_assignments: report.total_assignments, review_independence: report.review_independence, usage: report.usage, journal_head: timeline.journal_head, claims: ["Actual planner, scheduler, approval gate, shared context, fix loop, evidence report, and journal were exercised.", "No external AI host was invoked; host behavior is simulated and must not be presented as live conformance."] };
    const summaryFile = path.join(output, "demo-summary.json"); if (fs.existsSync(summaryFile) && fs.lstatSync(summaryFile).isSymbolicLink()) throw new Error("team demo summary cannot be a symbolic link");
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    return { ...summary, output, artifacts: { ...artifacts.artifacts, summary: summaryFile } };
  } finally {
    fs.rmSync(demoRoot, { recursive: true, force: true });
  }
}
