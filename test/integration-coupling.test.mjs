import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { main } from "../src/cli.mjs";
import { compileContext } from "../src/context-compiler.mjs";
import { generatePassportKey, issueChangePassport, verifyChangePassport } from "../src/change-passport.mjs";
import { recordFinalReview } from "../src/final-review.mjs";
import { addContext, createTask, revisePlan, transitionTask } from "../src/governed-runtime.mjs";
import { buildProofReplay } from "../src/proof-replay.mjs";
import { recordCriterionStatus, recordQualityCheck } from "../src/task-report.mjs";
import { briefHash, inspectTeamContext } from "../src/team-context.mjs";
import { cancelTeamRun, dispatchTeamAssignment, ingestTeamResult } from "../src/team-executor.mjs";
import { inspectTeam, startTeam } from "../src/team-orchestrator.mjs";

const HOST_CAPABILITIES = { bridge_kind: "HOST_NATIVE", native_spawn: true, parallel_dispatch: true, cancellation: true, structured_result: true, max_concurrency: 3 };
const CORE_FILES = ["instruction-precedence.md", "mission.md", "engineering-principles.md", "required-workflow.md", "risk-model.md", "quality-gates.md", "output-contract.md", "memory-policy.md"];

function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }

function repository(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aak-coupling-${name}-`));
  git(root, "init", "-q"); git(root, "config", "user.email", "coupling@example.invalid"); git(root, "config", "user.name", "Coupling Test");
  fs.writeFileSync(path.join(root, ".gitignore"), ".ai-agent-kit/\n.ai/local/\nreview-input.json\n");
  fs.writeFileSync(path.join(root, "README.md"), "coupling fixture\n");
  git(root, "add", ".gitignore", "README.md"); git(root, "commit", "-qm", "fixture");
  return root;
}

function writeReview(root, id) {
  const dimensions = Object.fromEntries(["requirement_match", "security", "code_quality", "failure_paths", "error_handling", "production_readiness", "trade_offs"].map((name) => [name, { status: "PASSED", summary: `${name} reviewed`, evidence_refs: [`fixture://${name}`] }]));
  const file = path.join(root, "review-input.json");
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, task_id: id, status: "PASSED", dimensions, findings: [], residual_risks: [], limitations: [] }));
  recordFinalReview({ target: root, id, file });
}

function advance(root, id, approvalHash, capabilityHash) {
  transitionTask({ target: root, id, to: "ANALYZE" });
  addContext({ target: root, id, kind: "fact", statement: "Integration source inspected", source: "fixture://source" });
  revisePlan({ target: root, id, trigger: "Integration evidence collected", steps: ["Verify the complete flow"] });
  transitionTask({ target: root, id, to: "PLAN_READY", evidence: { repository_intelligence: "READY" } });
  transitionTask({ target: root, id, to: "APPROVED", evidence: { approval_hash: approvalHash, approver: "repository-owner" } });
  transitionTask({ target: root, id, to: "IMPLEMENTING", evidence: { capability_hash: capabilityHash } });
  transitionTask({ target: root, id, to: "VERIFYING", evidence: { diff_scope: "approved-paths" } });
}

function teamResult(root, id, assignment) {
  return { schema_version: 1, assignment_id: assignment, status: "COMPLETED", usage: { tokens: 10, actions: 1, duration_seconds: 1 }, handoff: { brief_hash: briefHash(inspectTeamContext({ target: root, id })), facts: ["Bounded result"], affected_paths: [], evidence: [{ path: "README.md", line_start: 1, line_end: 1 }] } };
}

test("skill routing and compiled context are bound into team dispatch provenance", async () => {
  const root = repository("routing");
  for (const file of CORE_FILES) { const target = path.join(root, ".ai", "core", file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${file}\n`); }
  const skill = path.join(root, ".ai", "skills-src", "fix-bug", "SKILL.md"); fs.mkdirSync(path.dirname(skill), { recursive: true }); fs.writeFileSync(skill, "---\nname: fix-bug\ndescription: Fix bugs\n---\n");
  const configFile = path.join(root, ".ai", "config", "skill-routing.json"); fs.mkdirSync(path.dirname(configFile), { recursive: true }); fs.writeFileSync(configFile, JSON.stringify({ schema_version: 1, id: "router-v1", priority: ["fix-bug"], routes: { "fix-bug": { label: "Fix bug", skill: "fix-bug/SKILL.md", rules: [{ any: ["bug"], weight: 2 }] } } }));
  git(root, "add", ".ai"); git(root, "commit", "-qm", "add governed context");
  const commit = git(root, "rev-parse", "HEAD"); const state = path.join(root, ".ai", "local", "repository-intelligence-state.json"); fs.mkdirSync(path.dirname(state), { recursive: true }); fs.writeFileSync(state, JSON.stringify({ git_commit: commit, worktree_signature: crypto.createHash("sha256").update(commit).digest("hex") }));
  const logs = [];
  assert.equal(await main(["runtime", "task", "create", "--target", root, "--id", "ROUTED", "--goal", "Fix checkout bug", "--path", "src/**", "--routing-config", ".ai/config/skill-routing.json"], { log: (value) => logs.push(value) }), 0);
  const compiled = compileContext({ target: root, id: "ROUTED", budget: 100000 });
  const started = startTeam({ target: root, id: "ROUTED", adapter: "codex" });
  assert.equal(started.planning.skill_routing.route_id, "fix-bug");
  assert.equal(started.planning.execution_context.content_hash, compiled.pack.contentHash);
  assert.equal(started.dispatch_instructions[0].skill_route_hash, compiled.pack.task.skillRouting.config_hash);
  assert.equal(started.dispatch_instructions[0].context_pack_hash, compiled.pack.contentHash);
  assert.ok(compiled.pack.items.some((item) => item.path === ".ai/skills-src/fix-bug/SKILL.md" && item.provenance.startsWith("skill-route://")));
});

test("proof and passport use the same fail-closed production readiness contract", () => {
  const root = repository("readiness"); const runtime = path.join(root, ".ai-agent-kit", "runtime"); fs.mkdirSync(runtime, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-link-")); fs.symlinkSync(outside, path.join(runtime, "teams"));
  const approval = "approved-scope";
  const task = createTask({ target: root, id: "FAIL-CLOSED", goal: "Exercise degraded planner", acceptanceCriteria: ["Required behavior is verified"], approvalHash: approval, tools: ["read"], paths: ["src/**"] });
  fs.unlinkSync(path.join(runtime, "teams"));
  advance(root, task.id, approval, task.capability_hash); writeReview(root, task.id);
  transitionTask({ target: root, id: task.id, to: "REVIEW_READY", evidence: { tests: "passed", independent_verifier: "passed", final_review: "passed" } });
  const proof = buildProofReplay({ target: root, id: task.id });
  assert.equal(task.orchestration.status, "DEGRADED"); assert.equal(proof.readiness.status, "NOT_READY");
  assert.ok(proof.readiness.blockers.some((item) => item.includes("orchestration is DEGRADED")));
  assert.ok(proof.readiness.blockers.some((item) => item.includes("Acceptance criteria")));
  assert.ok(proof.readiness.blockers.some((item) => item.includes("quality gate tests")));
  assert.throws(() => transitionTask({ target: root, id: task.id, to: "RELEASED", evidence: { release_reference: "fixture://release" } }), /release requires READY/);
  const key = generatePassportKey({ target: root, keyId: "maintainer" });
  assert.throws(() => issueChangePassport({ target: root, id: task.id, keyId: "maintainer", privateKey: key.private_key, apply: true }), /READY proof/);
});

test("real READY proof can issue and verify a change passport", () => {
  const root = repository("passport"); const approval = "approved-scope";
  const key = generatePassportKey({ target: root, keyId: "maintainer" });
  git(root, "add", ".ai/passports/trusted-keys.json"); git(root, "commit", "-qm", "trust passport signer");
  const task = createTask({ target: root, id: "PASSPORT-REAL", acceptanceCriteria: ["Flow is verified"], approvalHash: approval, tools: ["read"], paths: ["README.md"] });
  advance(root, task.id, approval, task.capability_hash);
  recordCriterionStatus({ target: root, id: task.id, criterion: 1, status: "VERIFIED", source: "fixture://criterion" });
  for (const gate of ["lint", "typecheck", "tests", "build", "security"]) recordQualityCheck({ target: root, id: task.id, gate, status: "PASSED", source: `fixture://${gate}`, exitCode: 0 });
  writeReview(root, task.id); transitionTask({ target: root, id: task.id, to: "REVIEW_READY", evidence: { tests: "passed", independent_verifier: "passed", final_review: "passed" } });
  const proof = buildProofReplay({ target: root, id: task.id }); assert.equal(proof.readiness.status, "READY");
  const issued = issueChangePassport({ target: root, id: task.id, keyId: "maintainer", privateKey: key.private_key, apply: true });
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "VERIFIED");
  assert.equal(transitionTask({ target: root, id: task.id, to: "RELEASED", evidence: { release_reference: issued.file } }).state, "RELEASED");
});

test("CLI returns nonzero for denied runtime decisions and NOT_READY proof", async () => {
  const root = repository("exit"); createTask({ target: root, id: "EXIT", tools: ["read"], paths: ["README.md"] });
  const logs = [];
  assert.equal(await main(["runtime", "gateway", "authorize", "--target", root, "--id", "EXIT", "--tool", "read", "--path", "README.md"], { log: (value) => logs.push(value) }), 1);
  assert.equal(JSON.parse(logs.at(-1)).decision, "deny");
  assert.equal(await main(["proof", "--target", root, "--id", "EXIT"], { log: () => {} }), 1);

  const approval = "approved-scope"; const executable = createTask({ target: root, id: "EXEC", goal: "Execute a governed read", acceptanceCriteria: ["Read is verified"], approvalHash: approval, tools: ["read"], paths: ["README.md"] });
  advance(root, executable.id, approval, executable.capability_hash);
  const decisions = [];
  assert.equal(await main(["runtime", "gateway", "authorize", "--target", root, "--id", executable.id, "--tool", "read", "--path", "README.md"], { log: (value) => decisions.push(value) }), 0);
  const token = JSON.parse(decisions.at(-1)).decision_token; const executions = [];
  assert.equal(await main(["runtime", "gateway", "execute", "--target", root, "--id", executable.id, "--tool", "read", "--path", "README.md", "--decision-token", token], { log: (value) => executions.push(value) }, { actionExecutor: () => ({ exitCode: 0, observed: true }) }), 0);
  assert.equal(JSON.parse(executions.at(-1)).status, "completed");
});

test("ingest transaction resumes after a handoff-to-team-state interruption", () => {
  const root = repository("transaction");
  createTask({ target: root, id: "TX", goal: "Implement a feature", acceptanceCriteria: ["Verified"], approvalHash: "a".repeat(64), tools: ["read", "edit"], paths: ["README.md"] });
  startTeam({ target: root, id: "TX", adapter: "codex" });
  const assignment = inspectTeam({ target: root, id: "TX" }).assignments.find((item) => item.status === "PENDING").id;
  dispatchTeamAssignment({ target: root, id: "TX", assignment, agent: "agent" }); const result = teamResult(root, "TX", assignment);
  assert.throws(() => ingestTeamResult({ target: root, id: "TX", assignment, result }, { recordTeamResult: () => { throw new Error("injected state interruption"); } }), /injected state interruption/);
  const recovered = ingestTeamResult({ target: root, id: "TX", assignment, result });
  assert.equal(recovered.duplicate, false); assert.equal(recovered.team.assignments.find((item) => item.id === assignment).status, "COMPLETED");
  assert.equal(inspectTeamContext({ target: root, id: "TX" }).handoffs.length, 1);
});

test("ingest recovery completes analytics and journal once after team state commits", () => {
  const root = repository("transaction-state");
  createTask({ target: root, id: "TX-STATE", goal: "Implement a feature", acceptanceCriteria: ["Verified"], approvalHash: "b".repeat(64), tools: ["read", "edit"], paths: ["README.md"] });
  startTeam({ target: root, id: "TX-STATE", adapter: "codex" });
  const assignment = inspectTeam({ target: root, id: "TX-STATE" }).assignments.find((item) => item.status === "PENDING").id;
  dispatchTeamAssignment({ target: root, id: "TX-STATE", assignment, agent: "agent" }); const result = teamResult(root, "TX-STATE", assignment);
  assert.throws(() => ingestTeamResult({ target: root, id: "TX-STATE", assignment, result }, { afterTeamStateCommit: () => { throw new Error("injected post-state interruption"); } }), /injected post-state interruption/);

  const recovered = ingestTeamResult({ target: root, id: "TX-STATE", assignment, result });
  const duplicate = ingestTeamResult({ target: root, id: "TX-STATE", assignment, result });
  const analytics = fs.readFileSync(path.join(root, ".ai-agent-kit/runtime/analytics/team-role-events.jsonl"), "utf8").trim().split("\n");
  const journal = fs.readFileSync(path.join(root, ".ai-agent-kit/runtime/team-events/TX-STATE.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(recovered.duplicate, true); assert.equal(recovered.analytics_status, "RECOVERED");
  assert.equal(duplicate.duplicate, true); assert.equal(analytics.length, 1);
  assert.equal(journal.filter((event) => event.type === "RESULT_INGESTED").length, 1);
});

test("native cancellation stays pending without a host bridge and completes with confirmation", () => {
  const root = repository("cancel"); createTask({ target: root, id: "CANCEL", goal: "Implement a feature", tools: ["read"], paths: ["README.md"] });
  startTeam({ target: root, id: "CANCEL", adapter: "codex", capabilities: HOST_CAPABILITIES });
  const assignment = inspectTeam({ target: root, id: "CANCEL" }).assignments[0].id;
  const hostBridge = { spawn: () => ({ external_run_id: "host-run" }), cancel: () => ({ status: "CANCELLED" }) };
  dispatchTeamAssignment({ target: root, id: "CANCEL", assignment, agent: "agent" }, { hostBridge });
  const pending = cancelTeamRun({ target: root, id: "CANCEL" }); assert.equal(pending.run.state, "CANCELLATION_PENDING"); assert.equal(pending.state, "BLOCKED");

  const confirmedRoot = repository("cancel-confirmed"); createTask({ target: confirmedRoot, id: "CANCELLED", goal: "Implement a feature", tools: ["read"], paths: ["README.md"] });
  startTeam({ target: confirmedRoot, id: "CANCELLED", adapter: "codex", capabilities: HOST_CAPABILITIES });
  const confirmedAssignment = inspectTeam({ target: confirmedRoot, id: "CANCELLED" }).assignments[0].id;
  dispatchTeamAssignment({ target: confirmedRoot, id: "CANCELLED", assignment: confirmedAssignment, agent: "agent" }, { hostBridge });
  const cancelled = cancelTeamRun({ target: confirmedRoot, id: "CANCELLED" }, { hostBridge }); assert.equal(cancelled.state, "CANCELLED"); assert.equal(cancelled.run.external_cancellation, "CONFIRMED");
});
