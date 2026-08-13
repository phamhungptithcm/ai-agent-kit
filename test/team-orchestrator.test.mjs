import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { addContext, createTask } from "../src/governed-runtime.mjs";
import { main, parseTeamArgs } from "../src/cli.mjs";
import { evaluateTeamCases, inspectTeam, planTeam, recordTeamResult, reportTeam, startTeam } from "../src/team-orchestrator.mjs";
import { briefHash, claimTeamWork, inspectTeamContext, publishTeamHandoff } from "../src/team-context.mjs";

const HOST_CAPABILITIES = { bridge_kind: "HOST_NATIVE", native_spawn: true, parallel_dispatch: true, cancellation: true, structured_result: true, max_concurrency: 3 };

function fixture(id, goal, paths = ["src/**"], risk = "medium") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-"));
  fs.writeFileSync(path.join(root, "evidence.txt"), "grounded team evidence\n");
  createTask({ target: root, id, goal, acceptanceCriteria: ["verified"], paths, tools: ["read", "edit"], risk });
  return root;
}

const evidence = (value) => value.repeat(64);
const record = (options) => {
  const context = inspectTeamContext(options); const agent = `${options.assignment}-agent`;
  const claimed = claimTeamWork({ ...options, agent, expectedRevision: context.revision });
  const handoff = publishTeamHandoff({ ...options, agent, claim: claimed.claim.claim_id, expectedRevision: claimed.revision, payload: { brief_hash: briefHash(context), facts: options.status === "REJECTED" ? [] : [`${options.assignment} completed`], findings: options.findingCount ? [`${options.findingCount} findings require fixes`] : [], evidence: [{ path: "evidence.txt", line_start: 1, line_end: 1 }], status: options.status } });
  return recordTeamResult({ tokens: 100, actions: 1, durationSeconds: 10, ...options, handoffHash: handoff.handoff_hash });
};

test("classifier chooses the smallest useful workcell", () => {
  const small = fixture("TEAM-SMALL", "Fix a typo in one document", ["docs/README.md"], "low");
  assert.equal(planTeam({ target: small, id: "TEAM-SMALL" }).team_type, "SOLO");
  const feature = fixture("TEAM-FEATURE", "Implement a new account export feature");
  assert.equal(planTeam({ target: feature, id: "TEAM-FEATURE" }).team_type, "PRODUCT_WORKCELL");
  const bug = fixture("TEAM-BUG", "Fix a checkout regression");
  assert.equal(planTeam({ target: bug, id: "TEAM-BUG" }).team_type, "BUG_WORKCELL");
  const secure = fixture("TEAM-SECURE", "Change tenant authorization and payment access", ["src/auth/**"], "high");
  assert.equal(planTeam({ target: secure, id: "TEAM-SECURE" }).team_type, "ASSURANCE_WORKCELL");
  const bounded = fixture("TEAM-TWO", "Implement a new account export feature");
  assert.equal(planTeam({ target: bounded, id: "TEAM-TWO", maxAgents: 2 }).assignments.length, 2);
  assert.throws(() => planTeam({ target: bounded, id: "TEAM-TWO", maxAgents: 7 }), /cannot exceed 6/);
});

test("task creation automatically plans orchestration without requiring a second prompt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-auto-"));
  const task = createTask({ target: root, id: "TEAM-AUTO", goal: "Implement a new API feature", paths: ["src/**"], risk: "medium" });
  assert.equal(task.orchestration.status, "PLANNED");
  assert.equal(task.orchestration.team_type, "PRODUCT_WORKCELL");
  assert.ok(fs.existsSync(path.join(root, ".ai-agent-kit/runtime/teams/TEAM-AUTO.json")));
});

test("native and serial dispatch preserve one write owner and independent review", () => {
  const root = fixture("TEAM-NATIVE", "Implement a new API feature");
  planTeam({ target: root, id: "TEAM-NATIVE" });
  const native = startTeam({ target: root, id: "TEAM-NATIVE", adapter: "codex", capabilities: HOST_CAPABILITIES });
  assert.equal(native.execution_mode, "NATIVE_SUBAGENTS");
  assert.equal(native.assignments.filter((item) => item.write_access).length, 1);
  assert.equal(native.assignments.find((item) => item.id === "independent-reviewer").write_access, false);
  const fallbackRoot = fixture("TEAM-FALLBACK", "Implement a new API feature");
  planTeam({ target: fallbackRoot, id: "TEAM-FALLBACK" });
  assert.equal(startTeam({ target: fallbackRoot, id: "TEAM-FALLBACK", adapter: "other" }).execution_mode, "SERIAL_PERSONAS");
});

test("team start refreshes the shared brief after repository facts change", () => {
  const root = fixture("TEAM-REFRESH", "Implement a new API feature"); const before = inspectTeamContext({ target: root, id: "TEAM-REFRESH" });
  addContext({ target: root, id: "TEAM-REFRESH", kind: "fact", statement: "The API entry point was inspected", source: "src/api.mjs:1" });
  startTeam({ target: root, id: "TEAM-REFRESH", adapter: "codex" }); const after = inspectTeamContext({ target: root, id: "TEAM-REFRESH" });
  assert.notEqual(after.brief.repository_brief_hash, before.brief.repository_brief_hash); assert.equal(after.state, "ACTIVE");
});

test("review findings force fix and a fresh independent review", () => {
  const root = fixture("TEAM-LOOP", "Implement a new account export feature");
  planTeam({ target: root, id: "TEAM-LOOP" }); startTeam({ target: root, id: "TEAM-LOOP", adapter: "claude" });
  record({ target: root, id: "TEAM-LOOP", assignment: "domain-analyst", status: "COMPLETED", evidenceHash: evidence("a") });
  record({ target: root, id: "TEAM-LOOP", assignment: "impact-explorer", status: "COMPLETED", evidenceHash: evidence("b") });
  record({ target: root, id: "TEAM-LOOP", assignment: "implementation-engineer", status: "COMPLETED", evidenceHash: evidence("c") });
  record({ target: root, id: "TEAM-LOOP", assignment: "qa-lead", status: "COMPLETED", evidenceHash: evidence("d") });
  const rejected = record({ target: root, id: "TEAM-LOOP", assignment: "independent-reviewer", status: "REJECTED", findingCount: 2 });
  assert.equal(rejected.assignments.find((item) => item.id === "implementation-engineer").status, "PENDING");
  assert.equal(rejected.assignments.find((item) => item.id === "qa-lead").status, "PENDING");
  assert.equal(reportTeam({ target: root, id: "TEAM-LOOP" }).status, "NOT_READY");
  record({ target: root, id: "TEAM-LOOP", assignment: "implementation-engineer", status: "COMPLETED", evidenceHash: evidence("e") });
  record({ target: root, id: "TEAM-LOOP", assignment: "qa-lead", status: "COMPLETED", evidenceHash: evidence("f") });
  record({ target: root, id: "TEAM-LOOP", assignment: "independent-reviewer", status: "COMPLETED", evidenceHash: evidence("1"), findingCount: 0 });
  const report = reportTeam({ target: root, id: "TEAM-LOOP" });
  assert.equal(report.status, "READY");
  assert.equal(report.review_independence, "VERIFIED");
  assert.equal(inspectTeam({ target: root, id: "TEAM-LOOP" }).result_history.filter((item) => item.assignment_id === "independent-reviewer").length, 2);
});

test("blocking assurance findings restart implementation and downstream verification", () => {
  const root = fixture("TEAM-QA-LOOP", "Implement a new account export feature");
  planTeam({ target: root, id: "TEAM-QA-LOOP" }); startTeam({ target: root, id: "TEAM-QA-LOOP", adapter: "codex" });
  record({ target: root, id: "TEAM-QA-LOOP", assignment: "domain-analyst", status: "COMPLETED", evidenceHash: evidence("a") });
  record({ target: root, id: "TEAM-QA-LOOP", assignment: "impact-explorer", status: "COMPLETED", evidenceHash: evidence("b") });
  record({ target: root, id: "TEAM-QA-LOOP", assignment: "implementation-engineer", status: "COMPLETED", evidenceHash: evidence("c") });
  const rejected = record({ target: root, id: "TEAM-QA-LOOP", assignment: "qa-lead", status: "REJECTED", findingCount: 1 });
  assert.equal(rejected.assignments.find((item) => item.id === "implementation-engineer").status, "PENDING");
  assert.equal(rejected.assignments.find((item) => item.id === "qa-lead").status, "PENDING");
  assert.equal(rejected.assignments.find((item) => item.id === "independent-reviewer").status, "PENDING");
});

test("team CLI validates contracts and exposes machine-readable reports", async () => {
  assert.throws(() => parseTeamArgs(["start", "--id", "T1"]), /requires --adapter/);
  assert.equal(parseTeamArgs(["ingest", "--id", "T1", "--assignment", "qa-lead", "--result-file", "result.json"]).options.file, "result.json");
  assert.deepEqual(parseTeamArgs(["capabilities"]).options.paths, []);
  const root = fixture("TEAM-CLI", "Fix a checkout regression"); const logs = [];
  assert.equal(await main(["team", "plan", "--target", root, "--id", "TEAM-CLI"], { log: (value) => logs.push(value) }), 0);
  assert.match(logs[0], /BUG_WORKCELL/);
  const capabilityLogs = [];
  assert.equal(await main(["team", "capabilities"], { log: (value) => capabilityLogs.push(value) }), 0);
  assert.match(capabilityLogs[0], /HOST_NATIVE/);
});

test("assignment results fail closed when reported budgets are exceeded", () => {
  const root = fixture("TEAM-BUDGET", "Implement a new API feature");
  planTeam({ target: root, id: "TEAM-BUDGET", tokenBudget: 1000, maxActions: 2, timeoutSeconds: 30 }); startTeam({ target: root, id: "TEAM-BUDGET", adapter: "codex" });
  assert.throws(() => record({ target: root, id: "TEAM-BUDGET", assignment: "domain-analyst", status: "COMPLETED", evidenceHash: evidence("a"), tokens: 1001 }), /token budget/);
  assert.throws(() => record({ target: root, id: "TEAM-BUDGET", assignment: "domain-analyst", status: "COMPLETED", evidenceHash: evidence("a"), durationSeconds: 31 }), /timeout/);

  const resultRoot = fixture("TEAM-RESULT-BUDGET", "Implement a new API feature");
  planTeam({ target: resultRoot, id: "TEAM-RESULT-BUDGET", maxActions: 1 }); startTeam({ target: resultRoot, id: "TEAM-RESULT-BUDGET", adapter: "codex" });
  record({ target: resultRoot, id: "TEAM-RESULT-BUDGET", assignment: "domain-analyst", status: "COMPLETED", evidenceHash: evidence("b"), actions: 0 });
  assert.throws(() => record({ target: resultRoot, id: "TEAM-RESULT-BUDGET", assignment: "impact-explorer", status: "COMPLETED", evidenceHash: evidence("c"), actions: 0 }), /result budget/);
});

test("offline orchestration eval covers solo, feature, bug, and assurance routing", async () => {
  const fixture = JSON.parse(fs.readFileSync("assets/enterprise-ai-agent-os/.ai/evals/e2e/team-orchestration-cases.json", "utf8"));
  assert.equal(evaluateTeamCases(fixture).status, "PASSED");
  const logs = [];
  assert.equal(await main(["team", "eval", "--fixture", "assets/enterprise-ai-agent-os/.ai/evals/e2e/team-orchestration-cases.json"], { log: (value) => logs.push(value) }), 0);
  assert.match(logs[0], /"status": "PASSED"/);
});
