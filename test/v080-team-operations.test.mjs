import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { compareOutcomes, recordOutcome, summarizeOutcomes } from "../src/outcome-analytics.mjs";
import { memoryHealth, queryEligibleMemory, transitionMemory } from "../src/memory-lifecycle.mjs";
import { createTask, proposeMemory } from "../src/governed-runtime.mjs";
import { loadRepositoryPolicyOverlays, resolvePolicyOverlays, signableBundle, verifyPolicyBundle } from "../src/policy-overlays.mjs";

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-v080-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

function signedBundle(layer, rules, extra = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const bundle = {
    schema_version: 1,
    id: `${layer}-policy`,
    layer,
    version: "1.0.0",
    compatibility: { kit: ">=0.8.0 <0.9.0" },
    rules,
    signer: { key_id: `${layer}-test`, public_key: publicKey.export({ type: "spki", format: "pem" }) },
    ...extra
  };
  bundle.signature = crypto.sign(null, Buffer.from(signableBundle(bundle)), privateKey).toString("base64");
  return bundle;
}

test("policy overlays verify signatures, preserve provenance, and obey precedence", () => {
  const organization = signedBundle("organization", { security: { review: "required" }, limits: { actions: 100 } });
  const repository = signedBundle("repository", { limits: { actions: 40 } });
  const result = resolvePolicyOverlays({ bundles: [repository, organization], kitVersion: "0.8.0" });
  assert.equal(result.effective.security.review, "required");
  assert.equal(result.effective.limits.actions, 40);
  assert.equal(result.provenance["limits.actions"].layer, "repository");
  const tampered = structuredClone(repository);
  tampered.rules.limits.actions = 999;
  assert.throws(() => verifyPolicyBundle(tampered, { kitVersion: "0.8.0" }), /signature verification failed/);
});

test("locked policy conflicts and unsupported compatibility fail closed", () => {
  const organization = signedBundle("organization", { security: { release: "ask" } }, { locks: ["security.release"] });
  const repository = signedBundle("repository", { security: { release: "allow" } });
  assert.throws(() => resolvePolicyOverlays({ bundles: [organization, repository], kitVersion: "0.8.0" }), /locked by organization:organization-policy/);
  assert.throws(() => verifyPolicyBundle(organization, { kitVersion: "0.9.0" }), /outside compatibility range/);
});

test("repository policy activation requires a trusted signer authorized for its layer", () => {
  const root = tempRepo();
  const directory = path.join(root, ".ai/policies");
  fs.mkdirSync(directory, { recursive: true });
  const repository = signedBundle("repository", { release: { mode: "ask" } });
  fs.writeFileSync(path.join(directory, "repository.json"), JSON.stringify(repository));
  assert.throws(() => loadRepositoryPolicyOverlays({ target: root, kitVersion: "0.8.0" }), /signer is not trusted/);
  fs.writeFileSync(path.join(directory, "trusted-keys.json"), JSON.stringify({
    schema_version: 1,
    keys: [{ key_id: repository.signer.key_id, public_key: repository.signer.public_key, allowed_layers: ["repository"], revoked: false }]
  }));
  const result = loadRepositoryPolicyOverlays({ target: root, kitVersion: "0.8.0" });
  assert.equal(result.effective.release.mode, "ask");
});

test("local analytics rejects content fields, reports missing data, and gates claims", () => {
  const root = tempRepo();
  assert.throws(() => recordOutcome({ target: root, taskId: "T-1", event: { source: "private code" } }), /privacy boundary/);
  recordOutcome({ target: root, taskId: "T-1", event: { completed: true, verified: true, scope_violation: false, review_time_ms: 1200, rework: false, action_decisions: ["allow", "deny"], eval_score: 0.9, action_count: 2 } });
  const summary = summarizeOutcomes({ target: root });
  assert.equal(summary.metrics.verified_task_success_rate.value, 1);
  assert.equal(summary.metrics.rollback_rate.value, null);
  assert.equal(summary.metrics.rollback_rate.missing, true);
  const comparison = compareOutcomes({ baseline: summary, current: summary });
  assert.equal(comparison.claims_allowed, false);
  assert.match(comparison.claim_blockers[0], /at least 10/);
});

test("memory lifecycle excludes stale, revoked, superseded, and unreachable memory", () => {
  const root = tempRepo();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const file = path.join(root, ".ai-agent-kit/runtime/memory/entries.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const future = "2999-01-01";
  const entries = [
    { id: "good", title: "Good", content: "current guidance", status: "approved", confidence: 0.9, scope: "repository", source: "README.md", source_commit: commit, review_date: future },
    { id: "expired", title: "Expired", content: "old", status: "approved", confidence: 1, scope: "repository", source: "README.md", source_commit: commit, review_date: future, expires_at: "2000-01-01T00:00:00Z" },
    { id: "unreachable", title: "Unknown", content: "bad", status: "approved", confidence: 1, scope: "repository", source: "README.md", source_commit: "0000000000000000000000000000000000000000", review_date: future }
  ];
  fs.writeFileSync(file, entries.map(JSON.stringify).join("\n") + "\n");
  assert.deepEqual(queryEligibleMemory({ target: root }).map((entry) => entry.id), ["good"]);
  transitionMemory({ target: root, memoryId: "good", action: "revoke", approver: "owner", reason: "invalidated" });
  assert.equal(queryEligibleMemory({ target: root }).length, 0);
  const health = memoryHealth({ target: root });
  assert.equal(health.status, "ATTENTION");
  assert.equal(health.counts.revoked, 1);
  assert.equal(health.counts.expired, 1);
  assert.equal(health.counts.stale, 1);
});

test("conflicting approved memory is excluded and secret-like proposals fail safely", () => {
  const root = tempRepo();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const file = path.join(root, ".ai-agent-kit/runtime/memory/entries.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const base = { title: "Deployment", status: "approved", confidence: 0.9, scope: "repository", source: "README.md", source_commit: commit, review_date: "2999-01-01" };
  fs.writeFileSync(file, `${JSON.stringify({ ...base, id: "one", content: "use blue" })}\n${JSON.stringify({ ...base, id: "two", content: "use green" })}\n`);
  assert.equal(queryEligibleMemory({ target: root }).length, 0);
  assert.equal(memoryHealth({ target: root }).conflicts.length, 1);
  createTask({ target: root, id: "T-SECRET" });
  assert.throws(() => proposeMemory({ target: root, id: "T-SECRET", title: "Credential", content: "api_key=not-allowed", source: "manual" }), /secret-like/);
});

test("analytics and memory ledgers refuse symbolic-link traversal", () => {
  const root = tempRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-outside-"));
  fs.mkdirSync(path.join(root, ".ai-agent-kit/runtime"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, ".ai-agent-kit/runtime/analytics"), "dir");
  assert.throws(() => recordOutcome({ target: root, taskId: "T-1", event: { completed: true } }), /symbolic link/);
  fs.symlinkSync(outside, path.join(root, ".ai-agent-kit/runtime/memory"), "dir");
  assert.throws(() => memoryHealth({ target: root }), /symbolic link/);
});
