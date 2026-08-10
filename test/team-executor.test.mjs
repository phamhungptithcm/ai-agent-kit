import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { addContext, createTask } from "../src/governed-runtime.mjs";
import { resolveExecutionAdapter } from "../src/execution-adapters.mjs";
import { briefHash, inspectTeamContext } from "../src/team-context.mjs";
import { inspectTeam, planTeam, reportTeam, startTeam } from "../src/team-orchestrator.mjs";
import { cancelTeamRun, dispatchTeamAssignment, heartbeatTeamAssignment, ingestTeamResult, nextTeamWave, resumeTeamRun, validateTeamResult } from "../src/team-executor.mjs";

function setup(id, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-executor-"));
  fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const ready = true;\n");
  createTask({ target: root, id, goal: options.goal ?? "Implement a new account export feature", acceptanceCriteria: ["Feature is verified"], paths: ["src/**"], tools: ["read", "edit"], risk: options.risk ?? "medium", approvalHash: options.approved === false ? null : "a".repeat(64) });
  if (options.timeoutSeconds) planTeam({ target: root, id, timeoutSeconds: options.timeoutSeconds });
  return root;
}

function result(root, id, assignment, extra = {}) {
  const context = inspectTeamContext({ target: root, id });
  return {
    schema_version: 1,
    assignment_id: assignment,
    status: extra.status ?? "COMPLETED",
    usage: { tokens: 100, actions: 1, duration_seconds: 10, ...extra.usage },
    handoff: {
      brief_hash: briefHash(context),
      facts: [`${assignment} completed`],
      findings: [],
      structured_findings: extra.structuredFindings ?? [],
      affected_paths: assignment === "implementation-engineer" ? ["src/feature.mjs"] : [],
      evidence: [{ path: "src/feature.mjs", line_start: 1, line_end: 1 }],
      ...extra.handoff
    }
  };
}

function dispatchAndIngest(root, id, assignment, extra = {}) {
  const dispatched = dispatchTeamAssignment({ target: root, id, assignment, agent: `${assignment}-agent`, externalRunId: `external-${assignment}`, now: extra.now });
  const ingested = ingestTeamResult({ target: root, id, assignment, result: result(root, id, assignment, extra), now: extra.completeNow ?? extra.now });
  return { dispatched, ingested };
}

test("execution adapter capabilities are explicit and validated", () => {
  const codex = resolveExecutionAdapter("codex");
  assert.equal(codex.bridge_kind, "HOST_NATIVE"); assert.equal(codex.parallel_dispatch, true);
  const serial = resolveExecutionAdapter("cursor");
  assert.equal(serial.bridge_kind, "SERIAL_PERSONAS"); assert.equal(serial.max_concurrency, 1);
  assert.throws(() => resolveExecutionAdapter("codex", { structured_result: false }), /structured result/);
  assert.throws(() => resolveExecutionAdapter("codex", { native_spawn: "false" }), /must be booleans/);
  const declaredSerial = resolveExecutionAdapter("codex", { native_spawn: false });
  assert.equal(declaredSerial.parallel_dispatch, false); assert.equal(declaredSerial.max_concurrency, 1);
  assert.throws(() => resolveExecutionAdapter("unknown"), /unsupported/);
});

test("planner reconciles repository context immediately before dispatch", () => {
  const root = setup("TEAM-REPLAN", { goal: "Investigate an unexpected behavior", approved: false });
  const before = inspectTeam({ target: root, id: "TEAM-REPLAN" });
  addContext({ target: root, id: "TEAM-REPLAN", kind: "fact", statement: "The change alters a database migration and transaction boundary", source: "src/feature.mjs:1" });
  const started = startTeam({ target: root, id: "TEAM-REPLAN", adapter: "codex" });
  assert.equal(before.team_type, "SOLO"); assert.equal(started.team_type, "ASSURANCE_WORKCELL");
  assert.ok(started.planning.revision > before.planning.revision); assert.equal(started.planning.signals.migration, true);
});

test("host bridge dispatches dependency waves and ingests evidence-bound results", () => {
  const root = setup("TEAM-RUN"); const team = startTeam({ target: root, id: "TEAM-RUN", adapter: "codex", maxConcurrency: 2 });
  assert.equal(team.run.state, "READY"); assert.equal(team.execution_mode, "NATIVE_SUBAGENTS");
  const first = nextTeamWave({ target: root, id: "TEAM-RUN" });
  assert.deepEqual(first.assignments.map((item) => item.assignment_id), ["domain-analyst", "impact-explorer"]);
  const domain = dispatchTeamAssignment({ target: root, id: "TEAM-RUN", assignment: "domain-analyst", agent: "domain-agent" });
  assert.match(domain.spawn_id, /^spawn-/); assert.equal(domain.input_trust.repository_context, "UNTRUSTED_DATA");
  dispatchTeamAssignment({ target: root, id: "TEAM-RUN", assignment: "impact-explorer", agent: "impact-agent" });
  ingestTeamResult({ target: root, id: "TEAM-RUN", assignment: "domain-analyst", result: result(root, "TEAM-RUN", "domain-analyst") });
  ingestTeamResult({ target: root, id: "TEAM-RUN", assignment: "impact-explorer", result: result(root, "TEAM-RUN", "impact-explorer") });

  assert.deepEqual(nextTeamWave({ target: root, id: "TEAM-RUN" }).assignments.map((item) => item.assignment_id), ["implementation-engineer"]);
  const implementation = dispatchTeamAssignment({ target: root, id: "TEAM-RUN", assignment: "implementation-engineer", agent: "implementation-agent" });
  const heartbeat = heartbeatTeamAssignment({ target: root, id: "TEAM-RUN", assignment: "implementation-engineer" });
  assert.equal(heartbeat.spawn_id, implementation.spawn_id);
  ingestTeamResult({ target: root, id: "TEAM-RUN", assignment: "implementation-engineer", result: result(root, "TEAM-RUN", "implementation-engineer") });

  dispatchAndIngest(root, "TEAM-RUN", "qa-lead");
  dispatchAndIngest(root, "TEAM-RUN", "independent-reviewer");
  const report = reportTeam({ target: root, id: "TEAM-RUN" });
  assert.equal(report.status, "READY"); assert.equal(report.run.state, "COMPLETED");
  assert.ok(fs.existsSync(path.join(root, ".ai-agent-kit/runtime/analytics/team-role-events.jsonl")));
});

test("implementation waits for recorded approval while read-only discovery proceeds", () => {
  const root = setup("TEAM-APPROVAL", { approved: false }); startTeam({ target: root, id: "TEAM-APPROVAL", adapter: "codex" });
  dispatchAndIngest(root, "TEAM-APPROVAL", "domain-analyst"); dispatchAndIngest(root, "TEAM-APPROVAL", "impact-explorer");
  const wave = nextTeamWave({ target: root, id: "TEAM-APPROVAL" });
  assert.deepEqual(wave.assignments, []); assert.deepEqual(wave.blocked_by_approval, ["implementation-engineer"]);
  assert.throws(() => dispatchTeamAssignment({ target: root, id: "TEAM-APPROVAL", assignment: "implementation-engineer", agent: "builder" }), /recorded approval/);
});

test("structured findings are schema-validated, deduplicated, and preserve disagreement", () => {
  const root = setup("TEAM-FINDINGS", { goal: "Change authorization API behavior", risk: "high" }); startTeam({ target: root, id: "TEAM-FINDINGS", adapter: "claude", maxConcurrency: 3 });
  for (const assignment of nextTeamWave({ target: root, id: "TEAM-FINDINGS" }).assignments) dispatchAndIngest(root, "TEAM-FINDINGS", assignment.assignment_id);
  dispatchAndIngest(root, "TEAM-FINDINGS", "implementation-engineer");
  const finding = { severity: "HIGH", confidence: 0.8, category: "authorization", summary: "Tenant authorization is not verified", path: "src/feature.mjs", line: 1, recommendation: "Verify tenant ownership" };
  for (const assignment of nextTeamWave({ target: root, id: "TEAM-FINDINGS" }).assignments) {
    const values = ["qa-lead", "security-reviewer"].includes(assignment.assignment_id) ? [{ ...finding, severity: assignment.assignment_id === "qa-lead" ? "MEDIUM" : "HIGH" }] : [];
    dispatchAndIngest(root, "TEAM-FINDINGS", assignment.assignment_id, { structuredFindings: values });
  }
  const report = reportTeam({ target: root, id: "TEAM-FINDINGS" });
  assert.equal(report.findings.length, 1); assert.equal(report.findings[0].confirmations, 2); assert.equal(report.findings[0].disagreement, true);
});

test("cancel and resume make lifecycle failures explicit", () => {
  const cancelRoot = setup("TEAM-CANCEL"); startTeam({ target: cancelRoot, id: "TEAM-CANCEL", adapter: "codex" });
  dispatchTeamAssignment({ target: cancelRoot, id: "TEAM-CANCEL", assignment: "domain-analyst", agent: "domain-agent" });
  const cancelled = cancelTeamRun({ target: cancelRoot, id: "TEAM-CANCEL", reason: "owner stopped the run" });
  assert.equal(cancelled.state, "CANCELLED"); assert.equal(cancelled.run.state, "CANCELLED");

  const resumeRoot = setup("TEAM-RESUME", { goal: "Fix a typo in one document", timeoutSeconds: 30 });
  startTeam({ target: resumeRoot, id: "TEAM-RESUME", adapter: "codex", now: "2026-08-09T10:00:00.000Z" });
  dispatchTeamAssignment({ target: resumeRoot, id: "TEAM-RESUME", assignment: "implementation-engineer", agent: "builder", now: "2026-08-09T10:00:00.000Z" });
  const resumed = resumeTeamRun({ target: resumeRoot, id: "TEAM-RESUME", now: "2026-08-09T10:00:31.000Z" });
  assert.deepEqual(resumed.stale_assignments, ["implementation-engineer"]); assert.equal(resumed.team.state, "BLOCKED");
  assert.equal(resumed.team.assignments.find((item) => item.id === "implementation-engineer").blocker, "WRITE_AGENT_ORPHANED_REVIEW_REQUIRED");
  const reviewed = resumeTeamRun({ target: resumeRoot, id: "TEAM-RESUME", reviewedOrphanedWriter: "implementation-engineer", now: "2026-08-09T10:00:32.000Z" });
  assert.equal(reviewed.team.state, "DISPATCH_READY");
  assert.deepEqual(reviewed.next.assignments.map((item) => item.assignment_id), ["implementation-engineer"]);
});

test("team result rejects raw prompt material and malformed usage", () => {
  assert.throws(() => validateTeamResult({ schema_version: 1, assignment_id: "qa-lead", status: "COMPLETED", usage: { tokens: 1, actions: 1, duration_seconds: 1 }, raw_prompt: "do something", handoff: {} }), /forbidden/);
  assert.throws(() => validateTeamResult({ schema_version: 1, assignment_id: "qa-lead", status: "COMPLETED", usage: { tokens: -1, actions: 1, duration_seconds: 1 }, handoff: {} }), /non-negative/);
  assert.throws(() => validateTeamResult({ schema_version: 1, assignment_id: "qa-lead", status: "COMPLETED", usage: { tokens: 1, actions: 1, duration_seconds: 1 }, handoff: {}, commentary: "extra" }), /unsupported field/);
});

test("timeouts retry bounded read work and orphan a writer", () => {
  const readRoot = setup("TEAM-READ-TIMEOUT"); startTeam({ target: readRoot, id: "TEAM-READ-TIMEOUT", adapter: "codex" });
  dispatchTeamAssignment({ target: readRoot, id: "TEAM-READ-TIMEOUT", assignment: "domain-analyst", agent: "domain-agent" });
  const timedOut = { schema_version: 1, assignment_id: "domain-analyst", status: "TIMED_OUT", usage: { tokens: 10, actions: 1, duration_seconds: 10 } };
  const retry = ingestTeamResult({ target: readRoot, id: "TEAM-READ-TIMEOUT", assignment: "domain-analyst", result: timedOut });
  assert.equal(retry.team.assignments.find((item) => item.id === "domain-analyst").status, "PENDING");
  assert.ok(nextTeamWave({ target: readRoot, id: "TEAM-READ-TIMEOUT" }).assignments.some((item) => item.assignment_id === "domain-analyst"));
  dispatchTeamAssignment({ target: readRoot, id: "TEAM-READ-TIMEOUT", assignment: "domain-analyst", agent: "domain-agent-2" });
  const exhausted = ingestTeamResult({ target: readRoot, id: "TEAM-READ-TIMEOUT", assignment: "domain-analyst", result: timedOut });
  assert.equal(exhausted.team.assignments.find((item) => item.id === "domain-analyst").status, "BLOCKED");

  const writeRoot = setup("TEAM-WRITE-TIMEOUT", { goal: "Fix a typo in one document" }); startTeam({ target: writeRoot, id: "TEAM-WRITE-TIMEOUT", adapter: "codex" });
  dispatchTeamAssignment({ target: writeRoot, id: "TEAM-WRITE-TIMEOUT", assignment: "implementation-engineer", agent: "builder" });
  const writerTimeout = { ...timedOut, assignment_id: "implementation-engineer" };
  const orphaned = ingestTeamResult({ target: writeRoot, id: "TEAM-WRITE-TIMEOUT", assignment: "implementation-engineer", result: writerTimeout });
  assert.equal(orphaned.team.assignments.find((item) => item.id === "implementation-engineer").status, "ORPHANED");
  assert.equal(orphaned.team.run.dispatch_state, "HUMAN_REVIEW_REQUIRED");
  assert.equal(orphaned.team.state, "BLOCKED");
});

test("resume treats an expired claim lease as stale before the task timeout", () => {
  const root = setup("TEAM-LEASE-EXPIRED"); startTeam({ target: root, id: "TEAM-LEASE-EXPIRED", adapter: "codex", now: "2026-08-09T10:00:00.000Z" });
  dispatchTeamAssignment({ target: root, id: "TEAM-LEASE-EXPIRED", assignment: "domain-analyst", agent: "domain-agent", leaseSeconds: 30, now: "2026-08-09T10:00:00.000Z" });
  const resumed = resumeTeamRun({ target: root, id: "TEAM-LEASE-EXPIRED", now: "2026-08-09T10:00:31.000Z" });
  assert.deepEqual(resumed.stale_assignments, ["domain-analyst"]);
  assert.equal(resumed.team.assignments.find((item) => item.id === "domain-analyst").status, "PENDING");
});

test("result budget rejection happens before publishing a handoff", () => {
  const root = setup("TEAM-INGEST-BUDGET");
  planTeam({ target: root, id: "TEAM-INGEST-BUDGET", tokenBudget: 1000 });
  startTeam({ target: root, id: "TEAM-INGEST-BUDGET", adapter: "codex" });
  dispatchTeamAssignment({ target: root, id: "TEAM-INGEST-BUDGET", assignment: "domain-analyst", agent: "domain-agent" });
  const oversized = result(root, "TEAM-INGEST-BUDGET", "domain-analyst", { usage: { tokens: 1001 } });
  assert.throws(() => ingestTeamResult({ target: root, id: "TEAM-INGEST-BUDGET", assignment: "domain-analyst", result: oversized }), /token budget/);
  const context = inspectTeamContext({ target: root, id: "TEAM-INGEST-BUDGET" });
  assert.equal(context.handoffs.length, 0);
  assert.equal(context.claims.find((item) => item.assignment_id === "domain-analyst").status, "ACTIVE");
});
