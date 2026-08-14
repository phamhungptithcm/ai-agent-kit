import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createMemoryEntry, resolveRepositoryIdentity } from "../src/memory-contract.mjs";
import { migrateLegacyMemory, rollbackMemoryMigration } from "../src/memory-migration.mjs";
import { createMemoryPack, importMemoryPack } from "../src/memory-pack.mjs";
import { promoteTeamMemoryCandidate } from "../src/memory-promotion.mjs";
import { LocalSqliteMemoryStore, RemoteMemoryStore, ResilientMemoryStore } from "../src/memory-store.mjs";
import { retrieveScopedMemory } from "../src/memory-lifecycle.mjs";
import { approveMemory, createTask, proposeMemory, queryMemory } from "../src/governed-runtime.mjs";
import { briefHash, claimTeamWork, decideTeamConflict, inspectTeamContext, listTeamMemoryCandidates, publishTeamHandoff, recordTeamConflict, reviewTeamMemoryCandidate } from "../src/team-context.mjs";
import { recordTeamResult, startTeam } from "../src/team-orchestrator.mjs";
import { cancelTeamRun } from "../src/team-executor.mjs";

function repository(prefix = "aak-v130-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnSync("git", ["init"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Memory Test"], { cwd: root });
  fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src", "memory.mjs"), "export const memory = true;\n");
  spawnSync("git", ["add", "."], { cwd: root }); spawnSync("git", ["commit", "-m", "base"], { cwd: root });
  return root;
}

function futureDate(days = 90) { return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); }

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("memory-entry-v3 rejects forbidden durable fields and sensitive content", () => {
  const root = repository();
  try {
    assert.throws(() => createMemoryEntry({ target: root, title: "Bad", content: "Keep this", source: "src/memory.mjs", raw_prompt: "hidden" }), /forbidden/);
    assert.throws(() => createMemoryEntry({ target: root, title: "Bad", content: "password=unsafe-value", source: "src/memory.mjs" }), /sensitive/);
    const entry = createMemoryEntry({ target: root, title: "Transaction rule", content: "Use one transaction for each lifecycle transition.", source: "src/memory.mjs", createdBy: "agent-a" });
    assert.equal(entry.schema_version, 3); assert.equal(entry.status, "PROPOSED"); assert.equal(entry.scope.visibility, "repository");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("SQLite memory lifecycle is revisioned, scoped, receipt-backed, and deterministic", () => {
  const root = repository();
  try {
    createTask({ target: root, id: "MEM-1", goal: "Preserve a durable rule", acceptanceCriteria: ["Rule is retrievable"] });
    const proposed = proposeMemory({ target: root, id: "MEM-1", title: "Transaction rule", content: "Use transactions for shared memory lifecycle updates.", source: "src/memory.mjs", createdBy: "agent-a" });
    assert.notEqual(proposed.id, "MEM-1"); assert.equal(proposed.revision, 1);
    assert.throws(() => approveMemory({ target: root, memoryId: proposed.id, approver: "agent-a", reviewDate: futureDate() }), /self-approve/);
    const approved = approveMemory({ target: root, memoryId: proposed.id, approver: "memory-owner", reviewDate: futureDate() });
    assert.equal(approved.status, "APPROVED"); assert.equal(approved.revision, 2);
    const first = queryMemory({ target: root, query: "transactions", withReceipt: true, limit: 5, tokenBudget: 500 });
    const second = queryMemory({ target: root, query: "transactions", withReceipt: true, limit: 5, tokenBudget: 500 });
    assert.deepEqual(first.entries.map((item) => item.id), second.entries.map((item) => item.id));
    assert.equal(first.entries.length, 1); assert.match(first.receipt.audit_receipt_hash, /^[a-f0-9]{64}$/);
    const denied = queryMemory({ target: root, query: "transactions", withReceipt: true, actorRepositoryId: "foreign-repository" });
    assert.equal(denied.entries.length, 0); assert.ok(denied.receipt.excluded.some((item) => item.reason_code === "ACL_DENIED" || item.reason_code === "SCOPE_MISMATCH"));
    const store = new LocalSqliteMemoryStore({ target: root });
    try {
      assert.equal(store.health().wal, true);
      assert.throws(() => store.transition(approved.id, "revoke", { approver: "memory-owner", reason: "obsolete", expectedRevision: 1 }), /revision conflict/);
      assert.throws(() => store.transition(approved.id, "reject", { approver: "memory-owner", reason: "invalid state" }), /requires memory in PROPOSED status/);
      const exported = store.exportEntries(); assert.equal(exported, store.exportEntries());
    } finally { store.close(); }
    const databaseFile = path.join(root, ".ai-agent-kit", "runtime", "memory", "memory.sqlite3");
    const raw = new Database(databaseFile); raw.prepare("UPDATE memory_entries SET repository_id = ? WHERE id = ?").run("foreign-repository", proposed.id); raw.close();
    const tampered = new LocalSqliteMemoryStore({ target: root });
    try { assert.throws(() => tampered.list(), /inconsistent with its canonical record/); } finally { tampered.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("bounded concurrent CLI proposals do not lose SQLite writes", async () => {
  const root = repository();
  try {
    for (let index = 0; index < 8; index += 1) createTask({ target: root, id: `CON-${index}`, goal: "Concurrent memory proposal" });
    const commands = Array.from({ length: 8 }, (_, index) => run(process.execPath, [path.resolve("bin/ai-agent-kit.mjs"), "runtime", "memory", "propose", "--target", root, "--id", `CON-${index}`, "--title", `Rule ${index}`, "--content", `Concurrent transaction rule number ${index}.`, "--source", "src/memory.mjs", "--created-by", `agent-${index}`], process.cwd()));
    const results = await Promise.all(commands);
    assert.deepEqual(results.map((item) => item.code), Array(8).fill(0), results.map((item) => item.stderr).join("\n"));
    const store = new LocalSqliteMemoryStore({ target: root });
    try { assert.equal(store.list().length, 8); assert.equal(store.health().status, "HEALTHY"); } finally { store.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("v2 JSONL migration is previewable, backed up, idempotent, and reversible", () => {
  const root = repository();
  try {
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
    const directory = path.join(root, ".ai-agent-kit", "runtime", "memory"); fs.mkdirSync(directory, { recursive: true });
    const legacy = { id: "legacy-1", task_id: "OLD", title: "Legacy rule", category: "learning", scope: "repository", content: "Legacy memory remains readable during migration.", source: "src/memory.mjs", source_commit: commit, confidence: 0.9, trust_tier: "reviewed", status: "approved", approver: "legacy-owner", review_date: futureDate(), created_at: new Date().toISOString(), approved_at: new Date().toISOString() };
    fs.writeFileSync(path.join(directory, "entries.jsonl"), `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const preview = migrateLegacyMemory({ target: root }); assert.equal(preview.status, "PREVIEW"); assert.deepEqual(preview.preview.create, ["legacy-1"]);
    const applied = migrateLegacyMemory({ target: root, apply: true }); assert.equal(applied.status, "APPLIED"); assert.ok(fs.existsSync(path.join(root, applied.backup_path)));
    const repeated = migrateLegacyMemory({ target: root, apply: true }); assert.deepEqual(repeated, applied);
    assert.throws(() => migrateLegacyMemory({ target: root, migrationId: "../escape" }), /safe bounded identifier/);
    const rolledBack = rollbackMemoryMigration({ target: root, migrationId: applied.migration_id }); assert.equal(rolledBack.status, "ROLLED_BACK");
    const store = new LocalSqliteMemoryStore({ target: root }); try { assert.equal(store.get("legacy-1"), null); } finally { store.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("subagent handoff candidates require current evidence, team review, and independent approval", () => {
  const root = repository();
  try {
    createTask({ target: root, id: "TEAM-MEM", goal: "Reuse a verified subagent learning", acceptanceCriteria: ["Memory is approved"], paths: ["src/**"], risk: "medium" });
    startTeam({ target: root, id: "TEAM-MEM", adapter: "codex" });
    let context = inspectTeamContext({ target: root, id: "TEAM-MEM" });
    const assignmentId = context.assignments[0].id;
    const claim = claimTeamWork({ target: root, id: "TEAM-MEM", assignment: assignmentId, agent: "analyst-a", expectedRevision: context.revision });
    const handoff = publishTeamHandoff({ target: root, id: "TEAM-MEM", claim: claim.claim.claim_id, agent: "analyst-a", expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: ["Transaction boundary verified"], evidence: [{ path: "src/memory.mjs", line_start: 1, line_end: 1 }], memory_candidates: [{ title: "Shared transaction rule", content: "Use a transaction for every shared memory lifecycle change.", category: "implementation-pattern", scope: "repository", confidence: 0.9 }] } });
    recordTeamResult({ target: root, id: "TEAM-MEM", assignment: assignmentId, status: "COMPLETED", tokens: 10, actions: 1, durationSeconds: 1, handoffHash: handoff.handoff_hash, evidenceHash: "a".repeat(64) });
    const candidate = listTeamMemoryCandidates({ target: root, id: "TEAM-MEM" })[0]; assert.equal(candidate.status, "PROPOSED");
    context = inspectTeamContext({ target: root, id: "TEAM-MEM" });
    const reviewed = reviewTeamMemoryCandidate({ target: root, id: "TEAM-MEM", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, decision: "VERIFIED", reviewedBy: "team-lead", reason: "Evidence matches the current source.", expectedRevision: context.revision });
    assert.equal(reviewed.review.status, "VERIFIED");
    assert.throws(() => promoteTeamMemoryCandidate({ target: root, id: "TEAM-MEM", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, approver: "analyst-a", reviewDate: futureDate() }), /self-approved/);
    const promoted = promoteTeamMemoryCandidate({ target: root, id: "TEAM-MEM", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, approver: "memory-owner", reviewDate: futureDate() });
    assert.equal(promoted.status, "PROMOTED"); assert.equal(promoted.memory.status, "APPROVED"); assert.equal(promoted.memory.provenance.handoff_hash, handoff.handoff_hash);
    const repeated = promoteTeamMemoryCandidate({ target: root, id: "TEAM-MEM", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, approver: "memory-owner", reviewDate: futureDate() });
    assert.equal(repeated.status, "ALREADY_PROMOTED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("signed memory packs reject tampering, replay, and foreign repositories", () => {
  const root = repository(); const foreign = repository("aak-v130-foreign-"); const secret = "x".repeat(32);
  try {
    const identity = resolveRepositoryIdentity({ target: root }); const store = new LocalSqliteMemoryStore({ target: root });
    const entry = createMemoryEntry({ target: root, repositoryIdentity: identity, title: "Pack rule", content: "Signed packs bind memory to one repository.", source: "src/memory.mjs", createdBy: "agent-a" });
    store.propose(entry); store.approve(entry.id, { approver: "memory-owner", reviewDate: futureDate() });
    const pack = createMemoryPack(store, { target: root, repositoryIdentity: identity, signingSecret: secret });
    assert.equal(pack.entries.length, 1); assert.ok(pack.entries.every((item) => item.status === "APPROVED"));
    const target = new LocalSqliteMemoryStore({ target: root, database: path.join(root, ".ai-agent-kit/runtime/memory/import.sqlite3") });
    try {
      assert.equal(importMemoryPack(target, pack, { target: root, repositoryIdentity: identity, signingSecret: secret }).status, "PREVIEW");
      assert.equal(importMemoryPack(target, pack, { target: root, repositoryIdentity: identity, signingSecret: secret, apply: true }).status, "APPLIED");
      assert.throws(() => importMemoryPack(target, pack, { target: root, repositoryIdentity: identity, signingSecret: secret, apply: true }), /replay/);
      const tampered = structuredClone(pack); tampered.entries[0].content = "tampered";
      assert.throws(() => importMemoryPack(target, tampered, { target: root, repositoryIdentity: identity, signingSecret: secret }), /signature/);
      assert.throws(() => importMemoryPack(target, pack, { target: foreign, repositoryIdentity: resolveRepositoryIdentity({ target: foreign }), signingSecret: secret }), /foreign/);
    } finally { target.close(); store.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(foreign, { recursive: true, force: true }); }
});

test("remote capability negotiation fails closed and local fallback remains explicit", () => {
  const root = repository();
  try {
    const identity = resolveRepositoryIdentity({ target: root });
    assert.throws(() => new RemoteMemoryStore({ repositoryIdentity: identity, transport: { request: () => ({ protocol: "aak-memory-store-v1", capabilities: {} }) }, capabilityVerifier: () => true }), /unverified/);
    const capabilities = Object.fromEntries(["repository_binding", "acl", "audit_receipts", "transport_encryption", "at_rest_encryption", "retention", "replay_protection"].map((key) => [key, true]));
    assert.throws(() => new RemoteMemoryStore({ repositoryIdentity: identity, transport: { request: () => ({ protocol: "aak-memory-store-v1", capabilities }) } }), /independent capability verifier/);
    const transport = { request: ({ action }) => action === "capabilities" ? { protocol: "aak-memory-store-v1", capabilities } : (() => { throw new Error("offline"); })() };
    const remote = new RemoteMemoryStore({ repositoryIdentity: identity, transport, capabilityVerifier: () => true });
    assert.throws(() => remote.propose({}, {}), /separate authorization/);
    const invalidAuthorization = new RemoteMemoryStore({ repositoryIdentity: identity, transport, capabilityVerifier: () => true, authorizationVerifier: () => true, writeAuthorization: { authorization_id: "auth-1", repository_id: "foreign", expires_at: new Date(Date.now() + 60_000).toISOString(), actions: ["propose"] } });
    assert.throws(() => invalidAuthorization.propose({}, {}), /invalid or unverified/);
    const local = new LocalSqliteMemoryStore({ target: root }); const resilient = new ResilientMemoryStore({ local, remote });
    try { const health = resilient.health(); assert.equal(health.status, "DEGRADED"); assert.equal(health.mode, "LOCAL_FALLBACK"); assert.deepEqual(resilient.list(), []); } finally { resilient.close(); }
    const degradedRemote = new RemoteMemoryStore({ repositoryIdentity: identity, capabilityVerifier: () => true, transport: { request: ({ action }) => action === "capabilities" ? { protocol: "aak-memory-store-v1", capabilities } : { status: "DEGRADED", reason_code: "REMOTE_UNAVAILABLE" } } });
    const fallback = new ResilientMemoryStore({ local: new LocalSqliteMemoryStore({ target: root }), remote: degradedRemote });
    try { assert.deepEqual(fallback.list(), []); assert.equal(fallback.health().mode, "LOCAL_FALLBACK"); } finally { fallback.close(); }
    const foreignEntry = createMemoryEntry({ target: root, repositoryIdentity: { ...identity, repository_id: "foreign-repository" }, title: "Foreign rule", content: "This entry must not cross repository boundaries.", source: "src/memory.mjs" });
    const foreignRemote = new RemoteMemoryStore({ repositoryIdentity: identity, capabilityVerifier: () => true, transport: { request: ({ action }) => action === "capabilities" ? { protocol: "aak-memory-store-v1", capabilities } : { status: "OK", result: [foreignEntry] } } });
    assert.throws(() => foreignRemote.list(), /foreign organization or repository/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("unsafe database paths and malformed databases fail closed", () => {
  const root = repository();
  try {
    assert.throws(() => new LocalSqliteMemoryStore({ target: root, database: path.join(root, "..", "outside.sqlite3") }), /inside/);
    const file = path.join(root, ".ai-agent-kit", "runtime", "memory", "bad.sqlite3"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "not sqlite");
    assert.throws(() => new LocalSqliteMemoryStore({ target: root, database: file }), /failed closed|opened safely/);
    const malformedSchema = path.join(root, ".ai-agent-kit", "runtime", "memory", "wrong-schema.sqlite3");
    const database = new Database(malformedSchema); database.exec("CREATE TABLE memory_entries (id TEXT PRIMARY KEY); PRAGMA user_version = 1;"); database.close();
    assert.throws(() => new LocalSqliteMemoryStore({ target: root, database: malformedSchema }), /does not match the supported schema/);
    const linked = path.join(root, ".ai-agent-kit", "runtime", "memory", "linked.sqlite3"); fs.writeFileSync(linked, ""); fs.linkSync(linked, `${linked}.copy`);
    assert.throws(() => new LocalSqliteMemoryStore({ target: root, database: linked }), /non-linked regular file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("memory artifact commands reject symlinked parent paths", () => {
  const root = repository(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-v130-output-"));
  try {
    fs.symlinkSync(outside, path.join(root, "memory-output"), "dir");
    const result = spawnSync(process.execPath, [path.resolve("bin/ai-agent-kit.mjs"), "runtime", "memory", "export", "--target", root, "--output", "memory-output/export.jsonl"], { cwd: process.cwd(), encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /non-symlinked repository path/); assert.equal(fs.existsSync(path.join(outside, "export.jsonl")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("hard filters precede semantic ranking and enforce default entry and token bounds", () => {
  const root = repository();
  try {
    const identity = resolveRepositoryIdentity({ target: root }); const store = new LocalSqliteMemoryStore({ target: root });
    try {
      const entries = Array.from({ length: 7 }, (_, index) => createMemoryEntry({ target: root, repositoryIdentity: identity, title: `Retrieval rule ${index}`, content: `Deterministic shared memory retrieval rule number ${index}.`, source: "src/memory.mjs", status: "APPROVED", approver: "memory-owner", approvedAt: new Date().toISOString(), reviewDate: futureDate(), trustTier: "reviewed", createdBy: `agent-${index}` }));
      store.importEntries(entries, { apply: true });
      const bounded = retrieveScopedMemory({ target: root, store, query: "retrieval rule", tokenBudget: 1000 });
      assert.equal(bounded.entries.length, 5); assert.ok(bounded.receipt.excluded.some((item) => item.reason_code === "ENTRY_LIMIT"));
      const fallback = retrieveScopedMemory({ target: root, store, query: "retrieval", tokenBudget: 1000 }, { semanticRanker: () => { throw new Error("semantic service unavailable"); } });
      assert.equal(fallback.receipt.status, "DEGRADED"); assert.equal(fallback.receipt.semantic.reason_code, "SEMANTIC_FALLBACK"); assert.equal(fallback.entries.length, 5);
      const taskScoped = createMemoryEntry({ target: root, repositoryIdentity: identity, title: "Task-only rule", content: "This memory belongs only to task A.", source: "src/memory.mjs", scope: "task", taskId: "TASK-A", status: "APPROVED", approver: "memory-owner", approvedAt: new Date().toISOString(), reviewDate: futureDate(), createdBy: "agent-a" });
      const deleteExpired = createMemoryEntry({ target: root, repositoryIdentity: identity, title: "Deletion-expired rule", content: "This memory has crossed its deletion deadline.", source: "src/memory.mjs", status: "APPROVED", approver: "memory-owner", approvedAt: new Date().toISOString(), reviewDate: futureDate(), deleteAfter: new Date(Date.now() - 60_000).toISOString(), createdBy: "agent-a" });
      store.importEntries([taskScoped, deleteExpired], { apply: true });
      const wrongTask = retrieveScopedMemory({ target: root, store, query: "Task-only", taskId: "TASK-B", tokenBudget: 1000 });
      assert.ok(!wrongTask.entries.some((entry) => entry.id === taskScoped.id)); assert.ok(wrongTask.receipt.excluded.some((item) => item.id === taskScoped.id && item.reason_code === "SCOPE_MISMATCH"));
      const expired = retrieveScopedMemory({ target: root, store, query: "Deletion-expired", tokenBudget: 1000 });
      assert.ok(!expired.entries.some((entry) => entry.id === deleteExpired.id)); assert.ok(expired.receipt.excluded.some((item) => item.id === deleteExpired.id && item.reason_code === "DELETE_AFTER_PASSED"));
    } finally { store.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("candidate review rejects evidence drift and cancelled runs cannot promote", () => {
  const root = repository();
  try {
    createTask({ target: root, id: "TEAM-CANCEL", goal: "Implement a new API feature with reusable learning", acceptanceCriteria: ["Learning is verified"], paths: ["src/**"], risk: "medium" });
    startTeam({ target: root, id: "TEAM-CANCEL", adapter: "codex" });
    let context = inspectTeamContext({ target: root, id: "TEAM-CANCEL" }); const assignmentId = context.assignments[0].id;
    const claim = claimTeamWork({ target: root, id: "TEAM-CANCEL", assignment: assignmentId, agent: "analyst-b", expectedRevision: context.revision });
    const handoff = publishTeamHandoff({ target: root, id: "TEAM-CANCEL", claim: claim.claim.claim_id, agent: "analyst-b", expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: ["Evidence-bound rule"], evidence: [{ path: "src/memory.mjs" }], memory_candidates: [{ title: "Cancelled candidate", content: "Cancelled runs must not publish durable memory.", category: "failure-mode", confidence: 0.9 }] } });
    recordTeamResult({ target: root, id: "TEAM-CANCEL", assignment: assignmentId, status: "COMPLETED", tokens: 10, actions: 1, durationSeconds: 1, handoffHash: handoff.handoff_hash, evidenceHash: "b".repeat(64) });
    const candidate = listTeamMemoryCandidates({ target: root, id: "TEAM-CANCEL" })[0];
    fs.writeFileSync(path.join(root, "src", "memory.mjs"), "export const memory = 'drifted';\n"); context = inspectTeamContext({ target: root, id: "TEAM-CANCEL" });
    assert.throws(() => reviewTeamMemoryCandidate({ target: root, id: "TEAM-CANCEL", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, decision: "VERIFIED", reviewedBy: "team-lead", reason: "Review", expectedRevision: context.revision }), /hash does not match|stale|changed/);
    fs.writeFileSync(path.join(root, "src", "memory.mjs"), "export const memory = true;\n"); context = inspectTeamContext({ target: root, id: "TEAM-CANCEL" });
    reviewTeamMemoryCandidate({ target: root, id: "TEAM-CANCEL", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, decision: "VERIFIED", reviewedBy: "team-lead", reason: "Restored evidence matches.", expectedRevision: context.revision });
    cancelTeamRun({ target: root, id: "TEAM-CANCEL", reason: "Owner cancelled remaining work" });
    assert.throws(() => promoteTeamMemoryCandidate({ target: root, id: "TEAM-CANCEL", candidateHash: candidate.candidate_hash, handoffHash: handoff.handoff_hash, approver: "memory-owner", reviewDate: futureDate() }), /failed or cancelled/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("same repository worktrees share identity while independent repositories do not", () => {
  const root = repository(); const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "aak-v130-worktree-")); fs.rmSync(worktree, { recursive: true, force: true });
  try {
    const added = spawnSync("git", ["worktree", "add", "--detach", worktree, "HEAD"], { cwd: root, encoding: "utf8" }); assert.equal(added.status, 0, added.stderr);
    assert.equal(resolveRepositoryIdentity({ target: root }).repository_id, resolveRepositoryIdentity({ target: worktree }).repository_id);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root }); fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migration preview reports malformed legacy records before apply", () => {
  const root = repository();
  try {
    const directory = path.join(root, ".ai-agent-kit", "runtime", "memory"); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "entries.jsonl"), "{not-json}\n");
    const preview = migrateLegacyMemory({ target: root }); assert.equal(preview.status, "BLOCKED"); assert.equal(preview.preview.reject.length, 1);
    assert.throws(() => migrateLegacyMemory({ target: root, apply: true }), /rejected or conflicting/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("conflicting candidates stay blocked until an evidence-bound handoff decision selects one", () => {
  const root = repository();
  try {
    createTask({ target: root, id: "TEAM-CONFLICT-MEM", goal: "Implement a new API feature across modules", acceptanceCriteria: ["Compatibility is verified"], paths: ["src/**"], risk: "medium" });
    startTeam({ target: root, id: "TEAM-CONFLICT-MEM", adapter: "codex" });
    let context = inspectTeamContext({ target: root, id: "TEAM-CONFLICT-MEM" }); const assignments = context.assignments.filter((item) => item.depends_on.length === 0).slice(0, 2); assert.equal(assignments.length, 2);
    const hashes = [];
    for (const [index, assignment] of assignments.entries()) {
      context = inspectTeamContext({ target: root, id: "TEAM-CONFLICT-MEM" });
      const claim = claimTeamWork({ target: root, id: "TEAM-CONFLICT-MEM", assignment: assignment.id, agent: `specialist-${index}`, expectedRevision: context.revision });
      const handoff = publishTeamHandoff({ target: root, id: "TEAM-CONFLICT-MEM", claim: claim.claim.claim_id, agent: `specialist-${index}`, expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: [`Option ${index}`], evidence: [{ path: "src/memory.mjs" }], memory_candidates: [{ title: "API compatibility rule", content: index === 0 ? "Preserve compatibility with option A." : "Preserve compatibility with option B.", category: "architecture", confidence: 0.8 }] } });
      recordTeamResult({ target: root, id: "TEAM-CONFLICT-MEM", assignment: assignment.id, status: "COMPLETED", tokens: 10, actions: 1, durationSeconds: 1, handoffHash: handoff.handoff_hash, evidenceHash: `${index + 1}`.repeat(64) }); hashes.push(handoff.handoff_hash);
    }
    assert.ok(listTeamMemoryCandidates({ target: root, id: "TEAM-CONFLICT-MEM" }).every((item) => item.status === "CONFLICTED"));
    context = inspectTeamContext({ target: root, id: "TEAM-CONFLICT-MEM" }); const conflict = recordTeamConflict({ target: root, id: "TEAM-CONFLICT-MEM", expectedRevision: context.revision, handoffHashes: hashes, summary: "The specialists disagree about the durable compatibility rule." });
    decideTeamConflict({ target: root, id: "TEAM-CONFLICT-MEM", expectedRevision: conflict.revision, conflict: conflict.conflict_id, selectedHandoff: hashes[1], reason: "The selected handoff matches the current compatibility evidence.", decidedBy: "team-lead" });
    const decided = listTeamMemoryCandidates({ target: root, id: "TEAM-CONFLICT-MEM" });
    assert.equal(decided.find((item) => item.handoff_hash === hashes[1]).status, "PROPOSED"); assert.equal(decided.find((item) => item.handoff_hash === hashes[1]).conflict_selected, true);
    assert.equal(decided.find((item) => item.handoff_hash === hashes[0]).status, "REJECTED_BY_CONFLICT_DECISION");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
