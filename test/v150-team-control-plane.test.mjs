import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { normalizeTeamIdentity, signTeamIdentity, teamControlDigest } from "../src/team-control-contract.mjs";
import { createTask } from "../src/governed-runtime.mjs";
import { briefHash, inspectTeamContext } from "../src/team-context.mjs";
import { dispatchTeamAssignment, ingestTeamResult } from "../src/team-executor.mjs";
import { planTeam, startTeam } from "../src/team-orchestrator.mjs";
import { signHostAttestation, verifyHostAttestation } from "../src/team-host-bridge.mjs";
import { createIntegrationPackage, enqueueIntegrationPackage, evaluateIntegrationAdmission, inspectIntegrationQueue, recordIntegrationDecision } from "../src/team-integration.mjs";
import { buildTeamMetrics, evaluateTeamSlos } from "../src/team-metrics.mjs";
import { acquireRepositoryClaim, consumeHostAttestation, heartbeatRepositoryClaim, inspectTeamRegistry, registerRepositoryTask, releaseRepositoryClaim, validateRepositoryFence } from "../src/team-registry.mjs";
import { evaluateIndependentReview } from "../src/team-review.mjs";
import { cleanupTeamWorkspace, evaluateParentSnapshot, planTeamWorkspace, provisionTeamWorkspace } from "../src/team-workspace.mjs";
import { evaluateTeamBenchmark } from "../src/team-benchmark.mjs";
import { analyzeTeamConflicts } from "../src/team-conflicts.mjs";

function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
const IDENTITY_SECRET = "identity-test-key-0123456789abcdef0123456789abcdef";
const authenticated = (options) => ({ ...options, identitySecret: IDENTITY_SECRET });
function identity(id, roles, capabilities, now = "2026-08-14T12:00:00.000Z") {
  const unsigned = { schema_version: 1, principal_id: id, type: id.startsWith("host") ? "HOST" : "AGENT", issuer: "local-test", subject: id, roles, capabilities, issued_at: "2026-08-14T11:55:00.000Z", expires_at: "2026-08-14T13:00:00.000Z", evidence_digest: teamControlDigest({ id }), authentication: { method: "HMAC_SHA256", key_id: "identity-key-1", nonce: `nonce-${id}`, signature: "0".repeat(64) } };
  const canonical = normalizeTeamIdentity(unsigned, { now }); canonical.authentication.signature = signTeamIdentity(canonical, IDENTITY_SECRET);
  return normalizeTeamIdentity(canonical, { now });
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-v150-"));
  git(root, "init", "-b", "main"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "AI Agent Kit Test");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const value = 1;\n"); git(root, "add", "app.mjs"); git(root, "commit", "-m", "test base");
  return root;
}

test("repository registry coordinates cross-task claims and rejects stale fencing", () => {
  const root = repository(); const now = "2026-08-14T12:00:00.000Z";
  try {
    const actor = identity("agent-1", ["implementer"], ["task.register", "claim.write", "claim.renew", "claim.release"], now);
    assert.throws(() => registerRepositoryTask(authenticated({ target: root, taskId: "forged", identity: { ...actor, roles: [...actor.roles, "operator"] }, now })), /signature is invalid/);
    let registered = registerRepositoryTask(authenticated({ target: root, taskId: "task-a", identity: actor, now, expectedRevision: 0 }));
    registered = registerRepositoryTask(authenticated({ target: root, taskId: "task-b", identity: actor, now, expectedRevision: registered.revision }));
    const first = acquireRepositoryClaim(authenticated({ target: root, taskId: "task-a", assignmentId: "writer", identity: actor, surfaces: [{ kind: "PATH", name: "src/**", mode: "WRITE" }], expectedRevision: registered.revision, now, leaseSeconds: 60 }));
    assert.equal(first.claim.fencing_token, 1);
    assert.throws(() => acquireRepositoryClaim(authenticated({ target: root, taskId: "task-b", assignmentId: "writer", identity: actor, surfaces: [{ kind: "PATH", name: "src/team.mjs", mode: "WRITE" }], expectedRevision: first.revision, now })), /conflicts with active claim/);
    const beat = heartbeatRepositoryClaim(authenticated({ target: root, claimId: first.claim.claim_id, fencingToken: first.claim.fencing_token, identity: actor, expectedRevision: first.revision, now: "2026-08-14T12:00:30.000Z", leaseSeconds: 60 }));
    assert.equal(beat.fencing_token, 1);
    assert.equal(validateRepositoryFence({ target: root, claimId: first.claim.claim_id, fencingToken: 1, principalId: "agent-1", now: "2026-08-14T12:00:31.000Z" }).status, "VALID");
    const released = releaseRepositoryClaim(authenticated({ target: root, claimId: first.claim.claim_id, fencingToken: 1, identity: actor, expectedRevision: beat.revision, now: "2026-08-14T12:00:40.000Z" }));
    assert.equal(released.released, true);
    assert.equal(validateRepositoryFence({ target: root, claimId: first.claim.claim_id, fencingToken: 1, now: "2026-08-14T12:00:41.000Z" }).status, "STALE_OR_INVALID");
    const second = acquireRepositoryClaim(authenticated({ target: root, taskId: "task-b", assignmentId: "writer", identity: actor, surfaces: [{ kind: "PATH", name: "src/team.mjs", mode: "WRITE" }], expectedRevision: released.revision, now: "2026-08-14T12:00:42.000Z" }));
    assert.equal(second.claim.fencing_token, 2);
    assert.equal(inspectTeamRegistry({ target: root, now: "2026-08-14T12:00:43.000Z" }).storage.authority, "GIT_COMMON_DIR");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("expired lease allows a new fenced writer but never revives the old token", () => {
  const root = repository();
  try {
    const actor = identity("agent-expiry", ["implementer"], ["task.register", "claim.write", "claim.release"]);
    let state = registerRepositoryTask(authenticated({ target: root, taskId: "task-a", identity: actor, now: "2026-08-14T12:00:00.000Z" }));
    state = registerRepositoryTask(authenticated({ target: root, taskId: "task-b", identity: actor, now: "2026-08-14T12:00:01.000Z", expectedRevision: state.revision }));
    const oldClaim = acquireRepositoryClaim(authenticated({ target: root, taskId: "task-a", assignmentId: "writer", identity: actor, surfaces: [{ kind: "SCHEMA", name: "orders", mode: "WRITE" }], now: "2026-08-14T12:00:02.000Z", expectedRevision: state.revision, leaseSeconds: 30 }));
    const nextClaim = acquireRepositoryClaim(authenticated({ target: root, taskId: "task-b", assignmentId: "writer", identity: actor, surfaces: [{ kind: "SCHEMA", name: "orders", mode: "WRITE" }], now: "2026-08-14T12:00:33.000Z", expectedRevision: oldClaim.revision }));
    assert.equal(nextClaim.claim.fencing_token, 2);
    assert.equal(validateRepositoryFence({ target: root, claimId: oldClaim.claim.claim_id, fencingToken: 1, now: "2026-08-14T12:00:34.000Z" }).status, "STALE_OR_INVALID");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("workspace gate binds exact parent and plans an isolated sibling worktree", () => {
  const root = repository();
  try {
    const commit = git(root, "rev-parse", "HEAD");
    assert.equal(evaluateParentSnapshot({ target: root, parentCommit: commit }).status, "ADMITTED");
    fs.appendFileSync(path.join(root, "app.mjs"), "// dirty\n");
    assert.deepEqual(evaluateParentSnapshot({ target: root, parentCommit: commit }).blockers, ["WORKSPACE_DIRTY"]);
    const plan = planTeamWorkspace({ target: root, taskId: "task-a", assignmentId: "writer", parentCommit: commit });
    assert.equal(plan.parent_commit, commit); assert.ok(!plan.worktree_path.startsWith(`${root}${path.sep}`)); assert.match(plan.plan_hash, /^[a-f0-9]{64}$/);
    assert.throws(() => provisionTeamWorkspace({ plan: { ...plan, worktree_path: path.join(root, "forged") } }), /plan hash mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("host attestation rejects forgery and replay", () => {
  const now = "2026-08-14T12:00:00.000Z"; const secret = "0123456789abcdef0123456789abcdef";
  const hostIdentity = identity("host-1", ["operator"], ["claim.read"], now);
  const unsigned = { schema_version: 1, attestation_id: "att-1", host_id: "host-1", key_id: "key-1", nonce: "nonce-1", issued_at: "2026-08-14T11:59:00.000Z", expires_at: "2026-08-14T12:10:00.000Z", identity: hostIdentity, capabilities: ["structured-result"], bridge_kind: "HOST_NATIVE" };
  const attestation = { ...unsigned, signature: signHostAttestation(unsigned, secret) }; const seen = new Set();
  assert.equal(verifyHostAttestation(attestation, { now, seenNonces: seen, resolveKey: () => secret }).status, "VERIFIED");
  assert.equal(verifyHostAttestation(attestation, { now, seenNonces: seen, resolveKey: () => secret }).reason, "REPLAY");
  assert.equal(verifyHostAttestation({ ...attestation, nonce: "nonce-2" }, { now, resolveKey: () => secret }).reason, "SIGNATURE_INVALID");
});

test("repository registry consumes host attestations once across processes", () => {
  const root = repository(); const now = "2026-08-14T12:00:00.000Z";
  try {
    const actor = identity("agent-host-owner", ["team-lead"], ["task.register"], now);
    registerRepositoryTask(authenticated({ target: root, taskId: "task-host", identity: actor, now }));
    const consumed = consumeHostAttestation(authenticated({ target: root, attestationHash: "a".repeat(64), nonceKey: "host-key:nonce-1", expiresAt: "2026-08-14T12:30:00.000Z", identity: actor, now }));
    assert.equal(consumed.status, "CONSUMED");
    assert.throws(() => consumeHostAttestation(authenticated({ target: root, attestationHash: "a".repeat(64), nonceKey: "host-key:nonce-1", expiresAt: "2026-08-14T12:30:00.000Z", identity: actor, now })), /already consumed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("review and integration admission require independent evidence and a live fence", () => {
  const root = repository(); const now = "2026-08-14T12:00:00.000Z";
  try {
    const author = identity("agent-author", ["implementer"], ["task.register", "claim.write", "integration.enqueue"], now);
    const reviewer = identity("agent-reviewer", ["reviewer"], ["review.submit"], now);
    const owner = identity("agent-owner", ["integration-owner"], ["integration.admit"], now);
    const registered = registerRepositoryTask(authenticated({ target: root, taskId: "task-a", identity: author, now }));
    const claim = acquireRepositoryClaim(authenticated({ target: root, taskId: "task-a", assignmentId: "writer", identity: author, surfaces: [{ kind: "PATH", name: "app.mjs", mode: "WRITE" }], expectedRevision: registered.revision, now }));
    const commit = git(root, "rev-parse", "HEAD"); const evidence = crypto.createHash("sha256").update("tests passed").digest("hex");
    const packageValue = createIntegrationPackage(authenticated({ target: root, taskId: "task-a", assignmentId: "writer", commit, parentCommit: commit, claimId: claim.claim.claim_id, fencingToken: claim.claim.fencing_token, author, surfaces: [{ kind: "PATH", name: "app.mjs", mode: "WRITE" }], evidenceHashes: [evidence], rollbackRef: "main", now }));
    const review = evaluateIndependentReview(authenticated({ packageId: packageValue.package_id, author, reviewer, requiredOwners: ["owner-a"], approvals: ["owner-a"], evidenceHash: evidence, now }));
    assert.equal(review.status, "ACCEPTED");
    const selfReviewer = identity("agent-author", ["implementer", "reviewer"], ["task.register", "claim.write", "integration.enqueue", "review.submit"], now);
    assert.equal(evaluateIndependentReview(authenticated({ packageId: packageValue.package_id, author, reviewer: selfReviewer, evidenceHash: evidence, now })).status, "REJECTED");
    const queued = enqueueIntegrationPackage({ target: root, package: packageValue, now }); assert.equal(queued.state, "QUEUED");
    const decision = evaluateIntegrationAdmission(authenticated({ target: root, package: packageValue, packages: [], integrationOwner: owner, review, currentParentCommit: commit, now }));
    assert.equal(decision.status, "ADMITTED"); recordIntegrationDecision({ target: root, decision });
    assert.equal(inspectIntegrationQueue({ target: root }).packages[0].state, "ADMITTED");
    const stalePackage = createIntegrationPackage(authenticated({ target: root, packageId: "pkg-stale", taskId: "task-a", assignmentId: "writer", commit, parentCommit: commit, claimId: claim.claim.claim_id, fencingToken: claim.claim.fencing_token, author, surfaces: [{ kind: "PATH", name: "other.mjs", mode: "WRITE" }], evidenceHashes: [evidence], rollbackRef: "main", now }));
    const staleReview = evaluateIndependentReview(authenticated({ packageId: stalePackage.package_id, author, reviewer, evidenceHash: evidence, now }));
    enqueueIntegrationPackage({ target: root, package: stalePackage, now });
    const staleDecision = evaluateIntegrationAdmission(authenticated({ target: root, package: stalePackage, packages: inspectIntegrationQueue({ target: root }).packages, integrationOwner: owner, review: staleReview, currentParentCommit: commit, now }));
    assert.equal(staleDecision.status, "ADMITTED");
    assert.throws(() => recordIntegrationDecision({ target: root, decision: staleDecision, now: "2026-08-14T12:16:00.000Z" }), /became stale/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("privacy-safe metrics preserve insufficient-evidence SLO states", () => {
  const report = buildTeamMetrics([{ name: "claim_latency_ms", value: 15, timestamp: "2026-08-14T12:00:00.000Z", repository_id: "repo-1", task_class: "code" }]);
  assert.equal(report.privacy, "BOUNDED_DIMENSIONS_NO_CONTENT");
  const slos = evaluateTeamSlos(report, { claim_latency_ms: 20, recovery_ms: 5000 });
  assert.equal(slos.status, "INSUFFICIENT_EVIDENCE"); assert.equal(slos.checks[0].status, "MET");
});

test("control-plane team lifecycle binds isolated workspace and repository fence", () => {
  const root = repository(); const now = "2026-08-14T12:00:00.000Z";
  try {
    fs.writeFileSync(path.join(root, ".gitignore"), ".ai-agent-kit/\n"); git(root, "add", ".gitignore"); git(root, "commit", "-m", "ignore runtime state");
    const parentCommit = git(root, "rev-parse", "HEAD");
    const actor = identity("agent-control", ["implementer", "team-lead"], ["task.register", "claim.write", "claim.renew", "claim.release", "workspace.provision", "workspace.cleanup"], now);
    createTask({ target: root, id: "CONTROL-1", goal: "Fix a typo in one source file", acceptanceCriteria: ["verified"], paths: ["app.mjs"], tools: ["read", "edit"], risk: "low", approvalHash: "a".repeat(64), repositoryCommit: parentCommit });
    planTeam({ target: root, id: "CONTROL-1", controlPlane: true, now });
    const team = startTeam(authenticated({ target: root, id: "CONTROL-1", adapter: "other", identity: actor, now }));
    assert.equal(team.control_plane.status, "ACTIVE");
    const workspacePlan = planTeamWorkspace({ target: root, taskId: "CONTROL-1", assignmentId: "implementation-engineer", parentCommit });
    const provisioned = provisionTeamWorkspace(authenticated({ plan: workspacePlan, identity: actor, apply: true, confirmPlanHash: workspacePlan.plan_hash, now }));
    const dispatched = dispatchTeamAssignment(authenticated({ target: root, id: "CONTROL-1", assignment: "implementation-engineer", agent: "agent-control", identity: actor, workspacePath: provisioned.worktree_path, now }));
    assert.equal(dispatched.fencing_token, 1); assert.equal(dispatched.workspace.commit, parentCommit);
    const context = inspectTeamContext({ target: root, id: "CONTROL-1" });
    const result = { schema_version: 1, assignment_id: "implementation-engineer", status: "COMPLETED", usage: { tokens: 10, actions: 1, duration_seconds: 1 }, handoff: { brief_hash: briefHash(context), facts: ["typo fix prepared"], findings: [], affected_paths: ["app.mjs"], evidence: [{ path: "app.mjs", line_start: 1, line_end: 1 }] } };
    const ingested = ingestTeamResult(authenticated({ target: root, id: "CONTROL-1", assignment: "implementation-engineer", identity: actor, result, now: "2026-08-14T12:00:01.000Z" }));
    assert.equal(ingested.repository_release.released, true);
    assert.equal(validateRepositoryFence({ target: root, claimId: dispatched.repository_claim_id, fencingToken: dispatched.fencing_token, now: "2026-08-14T12:00:02.000Z" }).status, "STALE_OR_INVALID");
    assert.equal(cleanupTeamWorkspace(authenticated({ plan: workspacePlan, identity: actor, apply: true, confirmPlanHash: workspacePlan.plan_hash, now: "2026-08-14T12:00:03.000Z" })).status, "REMOVED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("v1.5 release benchmark requires four modes across 30 comparable tasks", () => {
  const modes = ["SINGLE_AGENT", "UNGOVERNED_MULTI_AGENT", "TASK_LOCAL_GOVERNED", "REPOSITORY_CONTROL_PLANE"];
  const run = (mode) => ({ mode, status: "COMPLETED", escaped_defects: 0, scope_violations: 0, duplicate_scans: 0, tokens: 100, duration_seconds: 10, review_cycles: 1, evidence_items: 2, required_evidence_items: 2 });
  const fixture = (count) => ({ schema_version: 2, profile: "V1_5_RELEASE", synthetic: false, methodology: { same_task: true, same_repository_commit: true, same_host: true, same_model: true, repetitions_per_mode: 3, minimum_task_cases: 30 }, cases: Array.from({ length: count }, (_, index) => ({ id: `case-${index}`, repository_commit: "a".repeat(40), host: "codex", model: "fixed", runs: [0, 1, 2].flatMap(() => modes.map(run)) })) });
  assert.equal(evaluateTeamBenchmark(fixture(29)).status, "INSUFFICIENT_EVIDENCE");
  const measured = evaluateTeamBenchmark(fixture(30)); assert.equal(measured.status, "MEASURED"); assert.equal(measured.conclusion_allowed, true); assert.equal(measured.modes.length, 4);
});

test("generated and protected contract conflicts fail closed", () => {
  const generated = analyzeTeamConflicts({ packages: [{ package_id: "pkg-a", task_id: "task-a", surfaces: [{ kind: "GENERATED", name: "dist/app.mjs", mode: "WRITE" }] }] });
  assert.equal(generated.status, "BLOCKED"); assert.equal(generated.unknowns[0].reason, "generated surface has no canonical source binding");
  const schema = analyzeTeamConflicts({ packages: [{ package_id: "pkg-a", task_id: "task-a", surfaces: [{ kind: "SCHEMA", name: "orders", mode: "WRITE" }] }, { package_id: "pkg-b", task_id: "task-b", surfaces: [{ kind: "SCHEMA", name: "orders", mode: "WRITE" }] }] });
  assert.equal(schema.conflicts[0].severity, "HIGH");
});
