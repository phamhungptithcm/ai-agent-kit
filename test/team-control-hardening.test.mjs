import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";

import {
  createEd25519TeamIdentity,
  createSignedTeamAction,
  generateTeamSigningKeyPair,
  normalizeTeamIdentity,
  signTeamIdentity,
  teamControlDigest,
  verifySignedTeamAction
} from "../src/team-control-contract.mjs";
import { TeamControlStore, resolveTeamControlStoreLocation } from "../src/team-control-store.mjs";
import { createIntegrationPackage, enqueueIntegrationPackage, evaluateIntegrationAdmission, inspectIntegrationGitFacts, integrationInputHash, recordIntegrationDecision, recordIntegrationReview, verifyIntegrationPackage } from "../src/team-integration.mjs";
import { buildTeamMetricsFromLedger } from "../src/team-metrics.mjs";
import { acquireRepositoryClaim, inspectTeamRegistry, inspectTeamRegistryHealth, markRepositoryResultReady, migrateLegacyTeamRegistry, registerRepositoryTask, releaseRepositoryClaim } from "../src/team-registry.mjs";
import { evaluateIndependentReview, resolveRequiredOwners } from "../src/team-review.mjs";
import { inspectTeamTrust, registerTeamTrustedKey, revokeTeamTrustedKey } from "../src/team-trust.mjs";

const HMAC_SECRET = "hardening-test-0123456789abcdef0123456789abcdef";

function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-hardening-"));
  git(root, "init", "-b", "main"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "AI Agent Kit Test");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const value = 1;\n"); git(root, "add", "app.mjs"); git(root, "commit", "-m", "test base");
  return root;
}
function cleanup(root) { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }

function hmacIdentity(id, now = "2026-08-20T12:00:00.000Z", roles = ["implementer"], capabilities = ["task.register"]) {
  const unsigned = { schema_version: 1, principal_id: id, type: "AGENT", issuer: "test", subject: id, roles, capabilities, issued_at: now, expires_at: "2026-08-20T13:00:00.000Z", evidence_digest: teamControlDigest({ id }), authentication: { method: "HMAC_SHA256", key_id: "legacy-test-key", nonce: `nonce-${id}`, signature: "0".repeat(64) } };
  const identity = normalizeTeamIdentity(unsigned, { now }); identity.authentication.signature = signTeamIdentity(identity, HMAC_SECRET); return identity;
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `child exited ${code}`)));
  });
}

test("SQLite authority serializes concurrent writers without losing repository tasks", async () => {
  const root = repository();
  try {
    const contractUrl = new URL("../src/team-control-contract.mjs", import.meta.url).href;
    const registryUrl = new URL("../src/team-registry.mjs", import.meta.url).href;
    const script = `
      import { normalizeTeamIdentity, signTeamIdentity, teamControlDigest } from ${JSON.stringify(contractUrl)};
      import { registerRepositoryTask } from ${JSON.stringify(registryUrl)};
      const [root, id] = process.argv.slice(1);
      const now = '2026-08-20T12:00:00.000Z';
      const unsigned = { schema_version: 1, principal_id: id, type: 'AGENT', issuer: 'test', subject: id, roles: ['implementer'], capabilities: ['task.register'], issued_at: now, expires_at: '2026-08-20T13:00:00.000Z', evidence_digest: teamControlDigest({ id }), authentication: { method: 'HMAC_SHA256', key_id: 'legacy-test-key', nonce: 'nonce-' + id, signature: '0'.repeat(64) } };
      const identity = normalizeTeamIdentity(unsigned, { now }); identity.authentication.signature = signTeamIdentity(identity, ${JSON.stringify(HMAC_SECRET)});
      registerRepositoryTask({ target: root, taskId: id, identity, identitySecret: ${JSON.stringify(HMAC_SECRET)}, now });
    `;
    await Promise.all(Array.from({ length: 12 }, (_, index) => runNode(script, [root, `task-${index}`])));
    const registry = inspectTeamRegistry({ target: root, now: "2026-08-20T12:00:01.000Z" });
    assert.equal(registry.tasks.length, 12); assert.equal(registry.revision, 12); assert.equal(registry.storage.backend, "SQLITE_TRANSACTIONAL");
    assert.equal(inspectTeamRegistryHealth({ target: root }).integrity, "ok");
  } finally { cleanup(root); }
});

test("an uncommitted process crash rolls back and leaves the SQLite authority healthy", async () => {
  const root = repository();
  try {
    const storeUrl = new URL("../src/team-control-store.mjs", import.meta.url).href;
    const script = `
      import { TeamControlStore } from ${JSON.stringify(storeUrl)};
      const store = new TeamControlStore({ target: process.argv[1] });
      store.database.exec('BEGIN IMMEDIATE');
      store.database.prepare('UPDATE repository_meta SET revision = 999 WHERE repository_id = ?').run(store.location.repository_id);
      process.exit(0);
    `;
    await runNode(script, [root]);
    assert.equal(inspectTeamRegistry({ target: root }).revision, 0);
    const actor = hmacIdentity("after-crash");
    assert.equal(registerRepositoryTask({ target: root, taskId: "after-crash", identity: actor, identitySecret: HMAC_SECRET, now: "2026-08-20T12:00:00.000Z" }).revision, 1);
    assert.equal(inspectTeamRegistryHealth({ target: root }).status, "READY");
  } finally { cleanup(root); }
});

test("canonical row tampering fails closed instead of returning forged task state", () => {
  const root = repository();
  try {
    const actor = hmacIdentity("tamper-test");
    registerRepositoryTask({ target: root, taskId: "tamper-test", identity: actor, identitySecret: HMAC_SECRET, now: "2026-08-20T12:00:00.000Z" });
    const store = new TeamControlStore({ target: root });
    try {
      const task = store.database.prepare("SELECT record_json FROM tasks WHERE task_id = ?").get("tamper-test");
      const forged = { ...JSON.parse(task.record_json), status: "ADMITTED" };
      store.database.prepare("UPDATE tasks SET record_json = ? WHERE task_id = ?").run(JSON.stringify(forged), "tamper-test");
    } finally { store.close(); }
    assert.throws(() => inspectTeamRegistry({ target: root }), /hash mismatch/);
    assert.equal(inspectTeamRegistryHealth({ target: root }).status, "DEGRADED");
  } finally { cleanup(root); }
});

test("CODEOWNERS uses repository precedence and last matching rule", () => {
  const root = repository();
  try {
    fs.mkdirSync(path.join(root, ".github"), { recursive: true });
    fs.writeFileSync(path.join(root, "CODEOWNERS"), "* @root-owner\n");
    fs.writeFileSync(path.join(root, ".github", "CODEOWNERS"), "* @default-owner\n/app.mjs @app-owner\n");
    const resolved = resolveRequiredOwners({ target: root, changedPaths: ["app.mjs", "docs/readme.md"] });
    assert.equal(resolved.source, ".github/CODEOWNERS");
    assert.deepEqual(resolved.by_path["app.mjs"], ["@app-owner"]);
    assert.deepEqual(resolved.by_path["docs/readme.md"], ["@default-owner"]);
    const author = hmacIdentity("code-author");
    const reviewer = hmacIdentity("code-reviewer", undefined, ["reviewer"], ["review.submit"]);
    const owner = hmacIdentity("app-owner");
    const input = { target: root, packageId: "codeowners-package", inputHash: "a".repeat(64), changedPaths: ["app.mjs"], author, reviewer, evidenceHash: "b".repeat(64), identitySecret: HMAC_SECRET, now: "2026-08-20T12:00:00.000Z" };
    assert.deepEqual(evaluateIndependentReview(input).blockers, ["CODEOWNER_APPROVAL_MISSING"]);
    assert.equal(evaluateIndependentReview({ ...input, ownerApprovals: [{ owner: "@app-owner", identity: owner, evidence_hash: "c".repeat(64) }] }).status, "ACCEPTED");
    git(root, "add", ".github/CODEOWNERS"); git(root, "commit", "-m", "protect app ownership");
    const protectedCommit = git(root, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(root, ".github", "CODEOWNERS"), "* @weakened-owner\n");
    assert.deepEqual(resolveRequiredOwners({ target: root, changedPaths: ["app.mjs"], codeownersRef: protectedCommit }).owners, ["@app-owner"]);
  } finally { cleanup(root); }
});

test("Git facts include deletions and both sides of a rename", () => {
  const root = repository();
  try {
    fs.writeFileSync(path.join(root, "delete-me.mjs"), "export const removed = true;\n");
    fs.writeFileSync(path.join(root, "rename-me.mjs"), "export const renamed = true;\n");
    git(root, "add", "."); git(root, "commit", "-m", "add change fixtures");
    const parentCommit = git(root, "rev-parse", "HEAD");
    fs.unlinkSync(path.join(root, "delete-me.mjs"));
    git(root, "mv", "rename-me.mjs", "renamed.mjs");
    git(root, "commit", "-am", "delete and rename");
    const commit = git(root, "rev-parse", "HEAD");
    const facts = inspectIntegrationGitFacts({ target: root, commit, parentCommit });
    assert.deepEqual(facts.changed_paths, ["delete-me.mjs", "rename-me.mjs", "renamed.mjs"]);
  } finally { cleanup(root); }
});

test("integration path coverage does not broaden a single-segment glob", () => {
  const root = repository();
  try {
    fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "nested", "secret.txt"), "sensitive\n");
    const parentCommit = git(root, "rev-parse", "HEAD");
    git(root, "add", "."); git(root, "commit", "-m", "nested change");
    const commit = git(root, "rev-parse", "HEAD");
    const author = hmacIdentity("glob-author", undefined, ["implementer"], ["integration.enqueue"]);
    assert.throws(() => createIntegrationPackage({ target: root, taskId: "glob-task", assignmentId: "writer", commit, parentCommit, claimId: "glob-claim", fencingToken: 1, completionReceiptHash: "a".repeat(64), author, identitySecret: HMAC_SECRET, surfaces: [{ kind: "PATH", name: "src/*.mjs", mode: "WRITE" }], evidenceHashes: ["b".repeat(64)], rollbackRef: "main", now: "2026-08-20T12:00:00.000Z" }), /outside its declared surfaces/);
  } finally { cleanup(root); }
});

test("legacy JSON migration previews, backs up, applies once, and retains source files", () => {
  const root = repository();
  try {
    const location = resolveTeamControlStoreLocation({ target: root }); fs.mkdirSync(location.state_directory, { recursive: true });
    const now = "2026-08-20T12:00:00.000Z";
    const task = { task_id: "legacy-task", goal_hash: null, parent_commit: git(root, "rev-parse", "HEAD"), status: "ACTIVE", registered_by: { principal_id: "legacy", type: "AGENT", issuer: "legacy", roles: ["implementer"], capabilities: ["task.register"], expires_at: "2026-08-20T13:00:00.000Z", evidence_digest: "a".repeat(64), authentication_key_id: "legacy" }, created_at: now, updated_at: now };
    const registryBase = { schema_version: 1, repository_id: location.repository_id, revision: 1, fencing_counter: 0, tasks: [task], claims: [], host_attestations: [], events: [], created_at: now, updated_at: now };
    const registry = { ...registryBase, registry_hash: teamControlDigest(registryBase) };
    const queueBase = { schema_version: 1, revision: 0, packages: [], decisions: [], updated_at: null };
    const queue = { ...queueBase, queue_hash: teamControlDigest(queueBase) };
    fs.writeFileSync(location.legacy_registry_file, `${JSON.stringify(registry)}\n`); fs.writeFileSync(location.legacy_queue_file, `${JSON.stringify(queue)}\n`);
    assert.equal(migrateLegacyTeamRegistry({ target: root }).status, "READY");
    const applied = migrateLegacyTeamRegistry({ target: root, apply: true, migrationId: "legacy-test", now });
    assert.equal(applied.status, "APPLIED"); assert.ok(fs.existsSync(applied.receipt.backup_directory)); assert.ok(fs.existsSync(location.legacy_registry_file));
    assert.equal(inspectTeamRegistry({ target: root }).tasks[0].task_id, "legacy-task");
    assert.equal(migrateLegacyTeamRegistry({ target: root }).status, "APPLIED"); assert.equal(inspectTeamRegistryHealth({ target: root }).status, "READY");
  } finally { cleanup(root); }
});

test("repository Ed25519 trust constrains delegation, revokes keys, and rejects action replay", () => {
  const root = repository();
  try {
    const now = "2026-08-20T12:00:00.000Z"; const keys = generateTeamSigningKeyPair({ keyId: "operator-key" });
    registerTeamTrustedKey({ target: root, bootstrap: true, approvedBy: "Hung-Pham", approvalHash: "a".repeat(64), now, key: { key_id: keys.key_id, issuer: "repo-owner", principal_id: "operator-1", public_key_pem: keys.public_key_pem, roles: ["operator"], capabilities: ["task.register", "trust.admin"], max_ttl_seconds: 600, status: "ACTIVE", valid_from: now, valid_until: "2026-08-20T13:00:00.000Z" } });
    assert.equal(inspectTeamRegistry({ target: root }).events.find((event) => event.type === "TRUST_KEY_REGISTERED").authorization_evidence_hash, "a".repeat(64));
    const identity = createEd25519TeamIdentity({ principal_id: "operator-1", type: "AGENT", issuer: "repo-owner", subject: "operator-1", roles: ["operator"], capabilities: ["task.register", "trust.admin"], issued_at: now, expires_at: "2026-08-20T12:10:00.000Z", evidence_digest: "b".repeat(64), authentication: { key_id: keys.key_id, nonce: "identity-nonce" } }, keys.private_key_pem, { now });
    const registered = registerRepositoryTask({ target: root, taskId: "trusted-task", identity, now });
    const repositoryId = inspectTeamRegistry({ target: root }).repository_id;
    const invalidPolicy = { key_id: "invalid-key", issuer: "repo-owner", principal_id: "invalid", public_key_pem: "not-a-public-key", roles: ["reviewer"], capabilities: ["review.submit"], max_ttl_seconds: 600, status: "ACTIVE", valid_from: now, valid_until: "2026-08-20T13:00:00.000Z" };
    const invalidAction = createSignedTeamAction({ repositoryId, operation: "trust.register", expectedRevision: registered.revision, payloadHash: teamControlDigest(invalidPolicy), keyId: keys.key_id, principalId: "operator-1", nonce: "failed-trust-nonce", issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: keys.private_key_pem });
    for (let attempt = 0; attempt < 2; attempt += 1) assert.throws(() => registerTeamTrustedKey({ target: root, key: invalidPolicy, identity, actionEnvelope: invalidAction, now }), /public key/);
    const envelope = createSignedTeamAction({ repositoryId, taskId: "trusted-task", operation: "integration.admit", expectedRevision: registered.revision, payloadHash: "c".repeat(64), keyId: keys.key_id, principalId: "operator-1", nonce: "action-nonce", issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: keys.private_key_pem });
    const verified = verifySignedTeamAction(envelope, { now, repositoryId, taskId: "trusted-task", operation: "integration.admit", payloadHash: "c".repeat(64), resolveIdentityKey: (keyId) => { const store = new TeamControlStore({ target: root }); try { return store.getTrustedKey(keyId); } finally { store.close(); } } });
    const store = new TeamControlStore({ target: root });
    try {
      store.consumeNonce({ keyId: verified.key_id, nonce: verified.nonce, operation: verified.operation, taskId: verified.task_id, expiresAt: verified.expires_at, now });
      assert.throws(() => store.consumeNonce({ keyId: verified.key_id, nonce: verified.nonce, operation: verified.operation, taskId: verified.task_id, expiresAt: verified.expires_at, now }), /replayed/);
    } finally { store.close(); }
    assert.equal(inspectTeamTrust({ target: root }).keys[0].status, "ACTIVE");
    const trustRevision = inspectTeamRegistry({ target: root }).revision;
    const revokeAction = createSignedTeamAction({ repositoryId, operation: "trust.revoke", expectedRevision: trustRevision, payloadHash: teamControlDigest({ key_id: keys.key_id }), keyId: keys.key_id, principalId: "operator-1", nonce: "revoke-nonce", issuedAt: "2026-08-20T12:01:00.000Z", expiresAt: "2026-08-20T12:06:00.000Z", privateKeyPem: keys.private_key_pem });
    revokeTeamTrustedKey({ target: root, keyId: keys.key_id, identity, actionEnvelope: revokeAction, now: "2026-08-20T12:01:00.000Z" });
    assert.throws(() => registerRepositoryTask({ target: root, taskId: "rejected-after-revocation", identity, now: "2026-08-20T12:02:00.000Z" }), /revoked or inactive/);
  } finally { cleanup(root); }
});

test("coordination metrics are derived from the ledger rather than caller-provided samples", () => {
  const root = repository();
  try {
    const actor = hmacIdentity("metric-agent");
    registerRepositoryTask({ target: root, taskId: "metric-task", identity: actor, identitySecret: HMAC_SECRET, now: "2026-08-20T12:00:00.000Z" });
    const report = buildTeamMetricsFromLedger({ target: root, windowStart: "2026-08-20T11:00:00.000Z", windowEnd: "2026-08-20T13:00:00.000Z" });
    assert.equal(report.source, "TRANSACTIONAL_TEAM_CONTROL_LEDGER"); assert.match(report.event_head, /^[a-f0-9]{64}$/); assert.equal(report.privacy, "BOUNDED_DIMENSIONS_NO_CONTENT");
  } finally { cleanup(root); }
});

test("release-grade integration requires independent Ed25519 actions and exact Git evidence", () => {
  const root = repository();
  try {
    const now = "2026-08-20T12:00:00.000Z";
    const authorKeys = generateTeamSigningKeyPair({ keyId: "author-key" }); const reviewerKeys = generateTeamSigningKeyPair({ keyId: "reviewer-key" }); const ownerKeys = generateTeamSigningKeyPair({ keyId: "owner-key" });
    const authorPolicy = { key_id: authorKeys.key_id, issuer: "repo-owner", principal_id: "author", public_key_pem: authorKeys.public_key_pem, roles: ["implementer", "team-lead"], capabilities: ["claim.release", "claim.write", "integration.enqueue", "result.publish", "task.register", "trust.admin"], max_ttl_seconds: 600, status: "ACTIVE", valid_from: now, valid_until: "2026-08-20T13:00:00.000Z" };
    const reviewerPolicy = { key_id: reviewerKeys.key_id, issuer: "repo-owner", principal_id: "reviewer", public_key_pem: reviewerKeys.public_key_pem, roles: ["reviewer"], capabilities: ["review.submit"], max_ttl_seconds: 600, status: "ACTIVE", valid_from: now, valid_until: "2026-08-20T13:00:00.000Z" };
    const ownerPolicy = { key_id: ownerKeys.key_id, issuer: "repo-owner", principal_id: "owner", public_key_pem: ownerKeys.public_key_pem, roles: ["integration-owner"], capabilities: ["integration.admit", "integration.reject"], max_ttl_seconds: 600, status: "ACTIVE", valid_from: now, valid_until: "2026-08-20T13:00:00.000Z" };
    registerTeamTrustedKey({ target: root, bootstrap: true, approvedBy: "Hung-Pham", approvalHash: "a".repeat(64), now, key: authorPolicy });
    const author = createEd25519TeamIdentity({ principal_id: "author", type: "AGENT", issuer: "repo-owner", subject: "author", roles: authorPolicy.roles, capabilities: authorPolicy.capabilities, issued_at: now, expires_at: "2026-08-20T12:10:00.000Z", evidence_digest: "1".repeat(64), authentication: { key_id: authorKeys.key_id, nonce: "author-identity" } }, authorKeys.private_key_pem, { now });
    const repositoryId = inspectTeamRegistry({ target: root }).repository_id;
    for (const [policy, nonce] of [[reviewerPolicy, "trust-reviewer"], [ownerPolicy, "trust-owner"]]) {
      const revision = inspectTeamRegistry({ target: root }).revision;
      const actionEnvelope = createSignedTeamAction({ repositoryId, operation: "trust.register", expectedRevision: revision, payloadHash: teamControlDigest(policy), keyId: authorKeys.key_id, principalId: "author", nonce, issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: authorKeys.private_key_pem });
      registerTeamTrustedKey({ target: root, key: policy, identity: author, actionEnvelope, now });
    }
    const reviewer = createEd25519TeamIdentity({ principal_id: "reviewer", type: "AGENT", issuer: "repo-owner", subject: "reviewer", roles: reviewerPolicy.roles, capabilities: reviewerPolicy.capabilities, issued_at: now, expires_at: "2026-08-20T12:10:00.000Z", evidence_digest: "2".repeat(64), authentication: { key_id: reviewerKeys.key_id, nonce: "reviewer-identity" } }, reviewerKeys.private_key_pem, { now });
    const owner = createEd25519TeamIdentity({ principal_id: "owner", type: "AGENT", issuer: "repo-owner", subject: "owner", roles: ownerPolicy.roles, capabilities: ownerPolicy.capabilities, issued_at: now, expires_at: "2026-08-20T12:10:00.000Z", evidence_digest: "3".repeat(64), authentication: { key_id: ownerKeys.key_id, nonce: "owner-identity" } }, ownerKeys.private_key_pem, { now });
    const task = registerRepositoryTask({ target: root, taskId: "release-task", identity: author, now });
    const claim = acquireRepositoryClaim({ target: root, taskId: "release-task", assignmentId: "writer", identity: author, surfaces: [{ kind: "PATH", name: "app.mjs", mode: "WRITE" }], expectedRevision: task.revision, now });
    const parentCommit = git(root, "rev-parse", "HEAD"); git(root, "checkout", "-b", "release-candidate"); fs.writeFileSync(path.join(root, "app.mjs"), "export const value = 2;\n"); git(root, "add", "app.mjs"); git(root, "commit", "-m", "candidate"); const commit = git(root, "rev-parse", "HEAD"); git(root, "checkout", "main");
    const evidenceHash = crypto.createHash("sha256").update("release evidence").digest("hex"); const facts = inspectIntegrationGitFacts({ target: root, commit, parentCommit });
    const ready = markRepositoryResultReady({ target: root, claimId: claim.claim.claim_id, fencingToken: claim.claim.fencing_token, identity: author, outputCommit: commit, diffHash: facts.diff_hash, evidenceHashes: [evidenceHash], now });
    assert.throws(() => releaseRepositoryClaim({ target: root, claimId: claim.claim.claim_id, fencingToken: claim.claim.fencing_token, identity: author, status: "ADMITTED", now }), /cannot synthesize an integration decision/);
    const packageValue = createIntegrationPackage({ target: root, taskId: "release-task", assignmentId: "writer", commit, parentCommit, claimId: claim.claim.claim_id, fencingToken: claim.claim.fencing_token, completionReceiptHash: ready.receipt.receipt_hash, author, surfaces: [{ kind: "PATH", name: "app.mjs", mode: "WRITE" }], evidenceHashes: [evidenceHash], rollbackRef: "main", now });
    assert.throws(() => verifyIntegrationPackage({ ...packageValue, unbound_metadata: "not-hashed" }), /unbound fields/);
    let revision = inspectTeamRegistry({ target: root }).revision;
    const enqueueAction = createSignedTeamAction({ repositoryId, taskId: "release-task", operation: "integration.enqueue", expectedRevision: revision, payloadHash: packageValue.package_hash, keyId: authorKeys.key_id, principalId: "author", nonce: "enqueue", issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: authorKeys.private_key_pem });
    enqueueIntegrationPackage({ target: root, package: packageValue, author, actionEnvelope: enqueueAction, requireReleaseGradeTrust: true, now });
    const review = evaluateIndependentReview({ target: root, packageId: packageValue.package_id, inputHash: integrationInputHash(packageValue), changedPaths: packageValue.changed_paths, codeownersRef: packageValue.parent_commit, author, reviewer, evidenceHash, requireReleaseGradeTrust: true, now });
    revision = inspectTeamRegistry({ target: root }).revision;
    const reviewAction = createSignedTeamAction({ repositoryId, taskId: "release-task", operation: "integration.review", expectedRevision: revision, payloadHash: review.review_hash, keyId: reviewerKeys.key_id, principalId: "reviewer", nonce: "review", issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: reviewerKeys.private_key_pem });
    recordIntegrationReview({ target: root, review, reviewer, actionEnvelope: reviewAction, requireReleaseGradeTrust: true, now });
    const decision = evaluateIntegrationAdmission({ target: root, packageId: packageValue.package_id, integrationOwner: owner, requireReleaseGradeTrust: true, now }); assert.equal(decision.status, "ADMITTED");
    revision = inspectTeamRegistry({ target: root }).revision;
    const admitAction = createSignedTeamAction({ repositoryId, taskId: "release-task", operation: "integration.admit", expectedRevision: revision, payloadHash: decision.decision_hash, keyId: ownerKeys.key_id, principalId: "owner", nonce: "admit", issuedAt: now, expiresAt: "2026-08-20T12:05:00.000Z", privateKeyPem: ownerKeys.private_key_pem });
    assert.equal(recordIntegrationDecision({ target: root, decision, integrationOwner: owner, actionEnvelope: admitAction, requireReleaseGradeTrust: true, now }).state, "ADMITTED");
  } finally { cleanup(root); }
});
