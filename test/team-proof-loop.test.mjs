import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTask } from "../src/governed-runtime.mjs";
import { buildTeamBenchmarkTemplate, evaluateTeamBenchmark } from "../src/team-benchmark.mjs";
import { buildTeamConformanceTemplate, verifyTeamConformance } from "../src/team-conformance.mjs";
import { briefHash, inspectTeamContext } from "../src/team-context.mjs";
import { runTeamDemo } from "../src/team-demo.mjs";
import { dispatchTeamAssignment, ingestTeamResult, recoverTeamRun } from "../src/team-executor.mjs";
import { buildTeamTimeline, readTeamEvents, verifyTeamJournal, writeTeamTimeline } from "../src/team-events.mjs";
import { startTeam } from "../src/team-orchestrator.mjs";

function root() { const value = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-proof-")); fs.mkdirSync(path.join(value, "src")); fs.writeFileSync(path.join(value, "src", "proof.mjs"), "export const proof = true;\n"); return value; }

function completedResult(target, id, assignment) {
  const context = inspectTeamContext({ target, id });
  return { schema_version: 1, assignment_id: assignment, status: "COMPLETED", usage: { tokens: 10, actions: 1, duration_seconds: 1 }, handoff: { brief_hash: briefHash(context), facts: ["bounded evidence"], findings: [], affected_paths: [], evidence: [{ path: "src/proof.mjs", line_start: 1, line_end: 1 }] } };
}

test("team journal is hash chained and timeline artifacts are replayable", () => {
  const target = root(); createTask({ target, id: "JOURNAL", goal: "Implement an API proof", paths: ["src/**"], approvalHash: "a".repeat(64) }); startTeam({ target, id: "JOURNAL", adapter: "codex" });
  const events = readTeamEvents({ target, id: "JOURNAL" }); assert.deepEqual(events.map((item) => item.type), ["TEAM_PLANNED", "TEAM_STARTED"]);
  assert.equal(verifyTeamJournal({ target, id: "JOURNAL" }).status, "VERIFIED");
  const written = writeTeamTimeline({ target, id: "JOURNAL", timeline: buildTeamTimeline({ target, id: "JOURNAL" }) });
  assert.ok(fs.readFileSync(written.artifacts.html, "utf8").includes("Execution proof, not agent theater"));
  const file = path.join(target, ".ai-agent-kit/runtime/team-events/JOURNAL.jsonl"); const lines = fs.readFileSync(file, "utf8").trim().split("\n"); const changed = JSON.parse(lines[0]); changed.data.status = "TAMPERED"; lines[0] = JSON.stringify(changed); fs.writeFileSync(file, `${lines.join("\n")}\n`);
  assert.equal(verifyTeamJournal({ target, id: "JOURNAL" }).status, "FAILED");
});

test("result ingest is idempotent across client retries", () => {
  const target = root(); createTask({ target, id: "IDEMPOTENT", goal: "Implement an API proof", paths: ["src/**"], approvalHash: "a".repeat(64) }); startTeam({ target, id: "IDEMPOTENT", adapter: "codex" });
  dispatchTeamAssignment({ target, id: "IDEMPOTENT", assignment: "domain-analyst", agent: "analyst" }); const result = completedResult(target, "IDEMPOTENT", "domain-analyst");
  const first = ingestTeamResult({ target, id: "IDEMPOTENT", assignment: "domain-analyst", result }); const second = ingestTeamResult({ target, id: "IDEMPOTENT", assignment: "domain-analyst", result });
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(second.idempotency_key, first.idempotency_key); assert.equal(second.handoff_hash, first.handoff_hash);
});

test("recovery verifies state and reconciles a journal gap", () => {
  const target = root(); createTask({ target, id: "RECOVER", goal: "Implement an API proof", paths: ["src/**"], approvalHash: "a".repeat(64) }); startTeam({ target, id: "RECOVER", adapter: "codex" });
  const recovered = recoverTeamRun({ target, id: "RECOVER" }); assert.equal(recovered.status, "RECOVERED"); assert.equal(recovered.reconciled, false); assert.equal(recovered.journal.status, "VERIFIED");
});

test("zero-config team demo exercises approval and assurance recovery without claiming a live host", () => {
  const target = root(); const demo = runTeamDemo({ target }); assert.equal(demo.status, "READY"); assert.equal(demo.synthetic, true); assert.equal(demo.non_production_evidence, true); assert.equal(demo.review_independence, "VERIFIED");
  const timeline = JSON.parse(fs.readFileSync(demo.artifacts.json, "utf8")); assert.ok(timeline.events.some((item) => item.type === "APPROVAL_BLOCKED")); assert.ok(timeline.events.filter((item) => item.type === "RESULT_INGESTED" && item.data.assignment_id === "implementation-engineer").length >= 2);
});

test("live conformance distinguishes templates from evidence-bound host attestations", () => {
  const template = buildTeamConformanceTemplate({ adapter: "claude" }); assert.equal(verifyTeamConformance(template).status, "NOT_RUN");
  const attestation = { ...template, host_version: "test-host-1", task_id: "T1", run_id: "run-1", observed_at: "2026-08-09T12:00:00.000Z", journal_head: "a".repeat(64), capabilities_observed: { native_spawn: true, parallel_dispatch: true, cancellation: false, resume: false, structured_result: true }, lifecycle: [{ type: "TEAM_STARTED", timestamp: "2026-08-09T12:00:00.000Z" }, { type: "ASSIGNMENT_DISPATCHED", timestamp: "2026-08-09T12:00:01.000Z", assignment_id: "a", spawn_id: "s1", wave_id: "wave-1" }, { type: "ASSIGNMENT_DISPATCHED", timestamp: "2026-08-09T12:00:01.000Z", assignment_id: "b", spawn_id: "s2", wave_id: "wave-1" }, { type: "RESULT_INGESTED", timestamp: "2026-08-09T12:00:02.000Z", assignment_id: "a" }], evidence_hashes: ["b".repeat(64)] };
  assert.equal(verifyTeamConformance(attestation).status, "PASSED");
  assert.equal(verifyTeamConformance({ ...attestation, write_assignment_ids: ["a"] }).status, "FAILED");
});

test("live conformance binds a local run and remains replayable after recording its receipt", () => {
  const target = root(); createTask({ target, id: "LIVE", goal: "Implement an API proof", paths: ["src/**"], approvalHash: "a".repeat(64) }); const team = startTeam({ target, id: "LIVE", adapter: "codex" });
  const dispatched = dispatchTeamAssignment({ target, id: "LIVE", assignment: "domain-analyst", agent: "live-agent", externalRunId: "host-run-1" }); const result = completedResult(target, "LIVE", "domain-analyst"); const ingested = ingestTeamResult({ target, id: "LIVE", assignment: "domain-analyst", result });
  const journal = verifyTeamJournal({ target, id: "LIVE" }); const attestation = { schema_version: 1, evidence_level: "LIVE_HOST", adapter: "codex", host_version: "test-host-1", task_id: "LIVE", run_id: team.run.run_id, observed_at: "2026-08-09T12:00:00.000Z", journal_head: journal.journal_head, capabilities_observed: { native_spawn: true, parallel_dispatch: false, cancellation: false, resume: false, structured_result: true }, write_assignment_ids: [], lifecycle: [{ type: "TEAM_STARTED", timestamp: team.run.prepared_at }, { type: "ASSIGNMENT_DISPATCHED", timestamp: team.run.prepared_at, assignment_id: "domain-analyst", external_run_id: "host-run-1", spawn_id: dispatched.spawn_id }, { type: "RESULT_INGESTED", timestamp: team.run.prepared_at, assignment_id: "domain-analyst" }], evidence_hashes: [ingested.evidence_hash] };
  const first = verifyTeamConformance(attestation, { target }); const second = verifyTeamConformance(attestation, { target });
  assert.equal(first.status, "PASSED"); assert.equal(first.journal_status, "RECORDED"); assert.equal(second.status, "PASSED"); assert.equal(second.journal_status, "ALREADY_RECORDED");
});

test("legacy three-mode benchmark remains unverified without signed runtime receipts", () => {
  assert.equal(evaluateTeamBenchmark(buildTeamBenchmarkTemplate()).status, "INSUFFICIENT_EVIDENCE");
  const run = (mode, offset) => ({ mode, status: "COMPLETED", escaped_defects: offset, scope_violations: offset, duplicate_scans: offset, tokens: 100 + offset, duration_seconds: 10 + offset, review_cycles: 1 + offset, evidence_items: 2, required_evidence_items: 2 });
  const insufficient = evaluateTeamBenchmark({ schema_version: 1, synthetic: false, methodology: { same_task: true, same_repository_commit: true, same_host: true, same_model: true, repetitions_per_mode: 3 }, cases: [{ id: "CASE-0", repository_commit: "a".repeat(40), host: "codex", model: "fixed-model", runs: [run("SINGLE_AGENT", 2), run("UNGOVERNED_MULTI_AGENT", 1), run("AGENT_DEPARTMENT", 0)] }] });
  assert.equal(insufficient.status, "UNVERIFIED");
  const measured = evaluateTeamBenchmark({ schema_version: 1, synthetic: false, methodology: { same_task: true, same_repository_commit: true, same_host: true, same_model: true, repetitions_per_mode: 3 }, cases: [{ id: "CASE-1", repository_commit: "a".repeat(40), host: "codex", model: "fixed-model", runs: [0, 1, 2].flatMap((repeat) => [run("SINGLE_AGENT", 2 + repeat), run("UNGOVERNED_MULTI_AGENT", 1 + repeat), run("AGENT_DEPARTMENT", repeat)]) }] });
  assert.equal(measured.status, "UNVERIFIED"); assert.equal(measured.conclusion_allowed, false); assert.equal(measured.results.length, 0);
});
