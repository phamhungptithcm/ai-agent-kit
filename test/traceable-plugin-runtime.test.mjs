import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildOtelTrace,
  buildRecoveryPlan,
  explainWhy,
  exportRunBundle,
  inspectDecisionChronicle,
  inspectRun,
  inspectRunBundle,
  proposeCapabilityImprovement,
  recordDecision,
  recordRunEvent,
  resumeRun,
  resolveDecision
} from "../src/traceability.mjs";
import { applyPluginLifecycle, authorizePluginInvocation, initializePlugin, inspectPluginManifest, planPluginLifecycle, pluginTrustCenter, validatePluginManifest } from "../src/plugin-runtime.mjs";
import { evaluateReliabilityBenchmark, listTraceLabScenarios, runTraceLab, writeTraceLab } from "../src/trace-lab.mjs";
import { main, parseDecisionArgs, parsePluginArgs, parseRunArgs } from "../src/cli.mjs";
import { buildOperatorSnapshot, writeOperatorView } from "../src/operator-view.mjs";

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-trace-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "app.mjs"), "export const answer = 42;\n");
  spawnSync("git", ["add", "app.mjs"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

const PLUGIN_KEY = crypto.generateKeyPairSync("ed25519");
const CAPABILITY_KEY = crypto.generateKeyPairSync("ed25519");
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }

function writeTrustStores(root) {
  const directory = path.join(root, ".ai/plugins");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "trusted-signers.json"), JSON.stringify({ schema_version: 1, keys: [{ key_id: "fixture-signer", public_key: PLUGIN_KEY.publicKey.export({ type: "spki", format: "pem" }), revoked: false, plugin_ids: ["review-guard"], publishers: ["fixture"], surfaces: ["skills", "hooks"] }] }));
  fs.writeFileSync(path.join(directory, "trusted-capability-issuers.json"), JSON.stringify({ schema_version: 1, keys: [{ key_id: "fixture-capability", public_key: CAPABILITY_KEY.publicKey.export({ type: "spki", format: "pem" }), revoked: false }] }));
}

function capabilityToken(overrides = {}) {
  const body = { schema_version: 1, key_id: "fixture-capability", nonce: crypto.randomUUID(), expires_at: "2099-01-01T00:00:00.000Z", policy_hash: "sha256:fixture-policy", plugin_id: "review-guard", task_id: "TASK-1", run_id: "RUN-1", approval_ref: "APR-1", permissions: { filesystem_read: ["src/**"] }, ...overrides };
  const signature = crypto.sign(null, Buffer.from(canonical(body)), CAPABILITY_KEY.privateKey).toString("base64");
  return Buffer.from(JSON.stringify({ body, signature })).toString("base64url");
}

function manifest(overrides = {}) {
  const raw = {
    id: "review-guard",
    name: "Review Guard",
    version: "1.0.0",
    publisher: "fixture",
    surfaces: ["skills", "hooks"],
    permissions: { filesystem_read: ["src/**"], filesystem_write: [], process: [], network: [], domains: [], mcp_servers: [], hooks: ["after-edit"], external_actions: [], data_classes: ["metadata"] },
    hosts: { codex: "native", claude: "native", cursor: "advisory" },
    provenance: { source: "https://example.invalid/review-guard", commit: "abc123", checksum: null, signature: null, key_id: "fixture-signer", public_key_pem: PLUGIN_KEY.publicKey.export({ type: "spki", format: "pem" }), sbom: "spdx:fixture" },
    ...overrides
  };
  if (overrides.provenance) return raw;
  const { manifest_hash, ...normalized } = validatePluginManifest(raw);
  void manifest_hash;
  const payloadHash = crypto.createHash("sha256").update(canonical(normalized)).digest("hex");
  raw.provenance.checksum = `sha256:${payloadHash}`;
  raw.provenance.signature = crypto.sign(null, Buffer.from(payloadHash), PLUGIN_KEY.privateKey).toString("base64");
  return raw;
}

test("Decision Chronicle is append-only, hash chained, and supersession preserves history", () => {
  const root = repository();
  recordDecision({ target: root, decisionId: "DEC-1", eventId: "evt-1", actor: "owner", question: "Which cache?", choice: "bounded local", alternatives: ["hosted"], rationale: "offline-first", artifacts: ["app.mjs"], approvalRef: "APR-1", timestamp: "2026-08-14T00:00:00.000Z" });
  recordDecision({ target: root, decisionId: "DEC-1", eventId: "evt-2", action: "approve", actor: "owner", rationale: "reviewed", timestamp: "2026-08-14T00:01:00.000Z" });
  recordDecision({ target: root, decisionId: "DEC-2", eventId: "evt-3", actor: "owner", question: "New cache policy?", choice: "bounded shared", alternatives: ["local only"], rationale: "team reuse", artifacts: ["app.mjs"], timestamp: "2026-08-14T00:02:00.000Z" });
  recordDecision({ target: root, decisionId: "DEC-1", eventId: "evt-4", action: "supersede", actor: "owner", supersededBy: "DEC-2", rationale: "new constraints", timestamp: "2026-08-14T00:03:00.000Z" });
  assert.equal(resolveDecision({ target: root, decisionId: "DEC-1" }).status, "SUPERSEDED");
  assert.equal(inspectDecisionChronicle({ target: root }).integrity.record_count, 4);
  const ledger = path.join(root, ".ai-agent-kit/trace/decisions.jsonl");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  const tampered = JSON.parse(lines[0]); tampered.data.choice = "tampered"; lines[0] = JSON.stringify(tampered);
  fs.writeFileSync(ledger, `${lines.join("\n")}\n`);
  assert.throws(() => inspectDecisionChronicle({ target: root }), /integrity/);
});

test("ledger writers fail explicitly instead of racing on the same offset", () => {
  const root = repository();
  const directory = path.join(root, ".ai-agent-kit/trace");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "decisions.jsonl.lock"), "writer");
  assert.throws(() => recordDecision({ target: root, decisionId: "DEC-LOCK", actor: "owner", question: "q", choice: "c", rationale: "r" }), /locked/);
});

test("Run Envelope reports drift, builds non-destructive recovery, and exports verifiable bundles", () => {
  const root = repository();
  recordDecision({ target: root, decisionId: "DEC-1", eventId: "d1", actor: "owner", question: "Ship?", choice: "guarded", alternatives: ["direct"], rationale: "risk", artifacts: ["app.mjs"], timestamp: "2026-08-14T00:00:00.000Z" });
  recordRunEvent({ target: root, runId: "RUN-1", eventId: "r1", phase: "start", actor: "codex", goal: "change app", decisionIds: ["DEC-1"], nextAction: "review", timestamp: "2026-08-14T00:01:00.000Z" });
  assert.equal(inspectRun({ target: root, runId: "RUN-1" }).status, "CURRENT");
  assert.equal(explainWhy({ target: root, query: "app.mjs:1" }).status, "EXPLAINED");
  const exported = exportRunBundle({ target: root, runId: "RUN-1", output: ".ai-agent-kit/exports/run.aakrun", timestamp: "2026-08-14T00:02:00.000Z" });
  assert.equal(inspectRunBundle({ target: root, file: ".ai-agent-kit/exports/run.aakrun" }).status, "VERIFIED");
  const bundle = JSON.parse(fs.readFileSync(exported.file, "utf8")); bundle.run.phase = "tampered"; fs.writeFileSync(exported.file, JSON.stringify(bundle));
  assert.equal(bundle.run.events[0].data.actor, undefined);
  assert.equal(bundle.run.events[0].data.actor_hash.length, 64);
  assert.equal(inspectRunBundle({ target: root, file: ".ai-agent-kit/exports/run.aakrun" }).status, "REJECTED");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const answer = 43;\n");
  const recovery = buildRecoveryPlan({ target: root, runId: "RUN-1" });
  assert.equal(recovery.status, "BLOCKED");
  assert.equal(recovery.destructive, false);
  assert.equal(buildOtelTrace({ target: root, runId: "RUN-1" }).privacy.external_export, false);
});

test("run resume is preview-first, approval-bound, and blocked by repository drift", () => {
  const root = repository();
  recordRunEvent({ target: root, runId: "RUN-RESUME", eventId: "resume-1", phase: "pause", actor: "codex", nextAction: "continue" });
  assert.equal(resumeRun({ target: root, runId: "RUN-RESUME" }).status, "PREVIEW");
  assert.throws(() => resumeRun({ target: root, runId: "RUN-RESUME", apply: true }), /approval/);
  assert.equal(resumeRun({ target: root, runId: "RUN-RESUME", apply: true, approvalRef: "APR-RESUME", actor: "codex" }).status, "RESUMED");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const answer = 99;\n");
  assert.equal(resumeRun({ target: root, runId: "RUN-RESUME", apply: true, approvalRef: "APR-RESUME" }).status, "BLOCKED");
});

test("run resume detects untracked context created after the checkpoint", () => {
  const root = repository();
  recordRunEvent({ target: root, runId: "RUN-UNTRACKED", eventId: "untracked-1", phase: "pause", actor: "codex" });
  fs.writeFileSync(path.join(root, "new-context.txt"), "changes the task context\n");
  const inspected = inspectRun({ target: root, runId: "RUN-UNTRACKED" });
  assert.equal(inspected.status, "STALE");
  assert.equal(inspected.drift.worktree_changed, true);
  assert.equal(resumeRun({ target: root, runId: "RUN-UNTRACKED", apply: true, approvalRef: "APR" }).status, "BLOCKED");
});

test("trace records reject sensitive content and symbolic-link storage", () => {
  const root = repository();
  assert.throws(() => recordRunEvent({ target: root, runId: "RUN-1", eventId: "evt", phase: "start", prompt: "secret" }), /prompt/);
  assert.throws(() => recordDecision({ target: root, decisionId: "DEC-SECRET", actor: "owner", question: "q", choice: "c", rationale: "api_key=do-not-store" }), /secret-like/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-outside-"));
  fs.mkdirSync(path.join(root, ".ai-agent-kit"));
  fs.symlinkSync(outside, path.join(root, ".ai-agent-kit/trace"), "dir");
  assert.throws(() => recordDecision({ target: root, decisionId: "DEC-1", actor: "owner", question: "q", choice: "c", rationale: "r" }), /symbolic link/);
});

test("plugin lifecycle is previewable, provenance-bound, and least privilege per invocation", () => {
  const root = repository();
  writeTrustStores(root);
  const file = path.join(root, "plugin.json");
  fs.writeFileSync(file, JSON.stringify(manifest()));
  assert.equal(inspectPluginManifest({ target: root, file: "plugin.json" }).status, "VERIFIED");
  assert.equal(planPluginLifecycle({ target: root, file: "plugin.json", state: "active", adapter: "codex" }).status, "PREVIEW");
  assert.throws(() => applyPluginLifecycle({ target: root, file: "plugin.json", state: "active", adapter: "codex", apply: true }), /approval/);
  const applied = applyPluginLifecycle({ target: root, file: "plugin.json", state: "active", adapter: "codex", apply: true, approvalRef: "APR-1", timestamp: "2026-08-14T00:00:00.000Z" });
  assert.equal(applied.status, "APPLIED");
  const token = capabilityToken();
  const allowed = authorizePluginInvocation({ target: root, pluginId: "review-guard", taskId: "TASK-1", runId: "RUN-1", approvalRef: "APR-1", capabilityToken: token, requested: { filesystem_read: ["src/**"] } });
  assert.equal(allowed.status, "ALLOWED");
  const denied = authorizePluginInvocation({ target: root, pluginId: "review-guard", taskId: "TASK-1", runId: "RUN-1", approvalRef: "APR-1", requested: { process: ["shell"] } });
  assert.equal(denied.status, "DENIED");
  assert.equal(authorizePluginInvocation({ target: root, pluginId: "review-guard", taskId: "TASK-1", runId: "RUN-1", approvalRef: "APR-1", capabilityToken: token, requested: { filesystem_read: ["src/**"] } }).status, "DENIED");
  assert.equal(authorizePluginInvocation({ target: root, pluginId: "review-guard", taskId: "TASK-1", runId: "RUN-1", approvalRef: "APR-1", capabilityToken: capabilityToken({ expires_at: "2020-01-01T00:00:00.000Z" }), requested: { filesystem_read: ["src/**"] } }).status, "DENIED");
  assert.throws(() => authorizePluginInvocation({ target: root, pluginId: "review-guard", requested: {}, ceiling: { filesystem_read: ["src/**"] } }), /not authoritative/);
  assert.equal(pluginTrustCenter({ target: root }).counts.active, 1);
  assert.throws(() => inspectPluginManifest({ target: root, file: "../outside.json" }), /remain/);
});

test("unverified or drifted plugins are blocked and quarantined", () => {
  const root = repository();
  writeTrustStores(root);
  const file = path.join(root, "plugin.json");
  fs.writeFileSync(file, JSON.stringify(manifest({ provenance: {} })));
  assert.equal(planPluginLifecycle({ target: root, file: "plugin.json", state: "active" }).status, "BLOCKED");
  fs.writeFileSync(file, JSON.stringify(manifest()));
  applyPluginLifecycle({ target: root, file: "plugin.json", state: "active", apply: true, approvalRef: "APR" });
  const installed = path.join(root, ".ai-agent-kit/plugins/manifests/review-guard.json");
  const changed = JSON.parse(fs.readFileSync(installed)); changed.description = "tampered"; fs.writeFileSync(installed, JSON.stringify(changed));
  assert.equal(authorizePluginInvocation({ target: root, pluginId: "review-guard", requested: {}, ceiling: {} }).status, "QUARANTINED");
  assert.equal(pluginTrustCenter({ target: root }).status, "ATTENTION");
});

test("plugin state cannot be forged independently of the lifecycle receipt", () => {
  const root = repository();
  writeTrustStores(root);
  const file = path.join(root, "plugin.json");
  fs.writeFileSync(file, JSON.stringify(manifest()));
  applyPluginLifecycle({ target: root, file: "plugin.json", state: "active", apply: true, approvalRef: "APR" });
  const stateFile = path.join(root, ".ai-agent-kit/plugins/state/review-guard.json");
  const state = JSON.parse(fs.readFileSync(stateFile)); state.approval_ref = "FORGED"; fs.writeFileSync(stateFile, JSON.stringify(state));
  assert.equal(authorizePluginInvocation({ target: root, pluginId: "review-guard", requested: {}, ceiling: {} }).status, "QUARANTINED");
});

test("plugin activation fails before mutation when dependencies or conflicts are unresolved", () => {
  const root = repository();
  writeTrustStores(root);
  const file = path.join(root, "plugin.json");
  fs.writeFileSync(file, JSON.stringify(manifest({ dependencies: ["required-plugin"], conflicts: ["unsafe-plugin"] })));
  const plan = planPluginLifecycle({ target: root, file: "plugin.json", state: "active" });
  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.blockers.includes("dependency required-plugin is not active"));
  assert.equal(fs.existsSync(path.join(root, ".ai-agent-kit/plugins/state/review-guard.json")), false);
});

test("self-signed plugins remain untrusted until the signer is explicitly enrolled", () => {
  const root = repository();
  const file = path.join(root, "plugin.json");
  fs.writeFileSync(file, JSON.stringify(manifest()));
  assert.equal(inspectPluginManifest({ target: root, file: "plugin.json" }).status, "UNTRUSTED_SIGNER");
  assert.equal(planPluginLifecycle({ target: root, file: "plugin.json", state: "active" }).status, "BLOCKED");
  const normalized = validatePluginManifest(manifest());
  fs.mkdirSync(path.join(root, ".ai-agent-kit/plugins/manifests"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ai-agent-kit/plugins/manifests/review-guard.json"), JSON.stringify(normalized));
  assert.equal(pluginTrustCenter({ target: root }).status, "ATTENTION");
});

test("TraceLab demonstrates real failure states without claiming production proof", () => {
  assert.ok(listTraceLabScenarios().length >= 6);
  assert.equal(runTraceLab({ scenario: "production-bug" }).fixture_type, "SYNTHETIC_OFFLINE_DEMO");
  assert.equal(runTraceLab({ scenario: "parent-drift" }).recovered, false);
  const root = repository();
  const written = writeTraceLab({ target: root, scenario: "security-escape" });
  assert.equal(written.status, "RECOVERED");
  assert.match(fs.readFileSync(written.files.html, "utf8"), /SYNTHETIC OFFLINE PROOF/);
});

test("reliability benchmark preserves failures, denominators, cost unknowns, and claim boundaries", () => {
  const result = evaluateReliabilityBenchmark({ schema_version: 1, fixture_id: "bug-1", measured_at: "2026-08-14", environment: { host: "offline" }, runs: [
    { configuration: "baseline", status: "COMPLETED", requirements_met: 1, requirements_total: 2, regressions: 1, escaped_findings: 1, trace_items_present: 1, trace_items_required: 5, recovery_required: true, recovery_succeeded: false, elapsed_seconds: 10, tokens: 100, estimated_cost_usd: null },
    { configuration: "governed", status: "COMPLETED", requirements_met: 2, requirements_total: 2, regressions: 0, escaped_findings: 0, trace_items_present: 5, trace_items_required: 5, recovery_required: true, recovery_succeeded: true, elapsed_seconds: 12, tokens: 120, estimated_cost_usd: 0.01 },
    { configuration: "governed", status: "TIMED_OUT", requirements_met: 0, requirements_total: 2, regressions: 0, escaped_findings: 0, trace_items_present: 1, trace_items_required: 5, elapsed_seconds: 30, tokens: 80, estimated_cost_usd: null, limitations: ["host unavailable"] }
  ] });
  assert.equal(result.status, "MEASURED");
  assert.equal(result.configurations.find((item) => item.configuration === "governed").failed_or_timed_out, 1);
  assert.equal(result.configurations.find((item) => item.configuration === "baseline").estimated_cost_usd, null);
  assert.match(result.claims_boundary, /do not prove universal superiority/);
  assert.throws(() => evaluateReliabilityBenchmark({ schema_version: 1, fixture_id: "bad", runs: [{ configuration: "x", status: "COMPLETED", requirements_met: 2, requirements_total: 1, regressions: 0, escaped_findings: 0, trace_items_present: 0, trace_items_required: 0, elapsed_seconds: 1, tokens: 1 }] }), /numerator/);
});

test("trace, run, and plugin CLI parsers reject ambiguous or unknown input", () => {
  assert.equal(parseDecisionArgs(["inspect", "--decision-id", "DEC-1"]).options.decision_id[0], "DEC-1");
  assert.equal(parseRunArgs(["inspect", "--run-id", "RUN-1"]).options.run_id, "RUN-1");
  assert.equal(parsePluginArgs(["trust", "--target", "."]).action, "trust");
  assert.throws(() => parsePluginArgs(["authorize", "--ceiling", "{}"]), /Unknown/);
  assert.throws(() => parseRunArgs(["inspect", "--secret", "x"]), /Unknown/);
  assert.throws(() => parsePluginArgs(["apply", "--file"]), /requires a value/);
});

test("plugin init previews by default and applies a bounded keyless scaffold", () => {
  const root = repository();
  const preview = initializePlugin({ target: root, pluginId: "safe-review" });
  assert.equal(preview.status, "PREVIEW");
  assert.equal(fs.existsSync(path.join(root, "plugins/safe-review")), false);
  const created = initializePlugin({ target: root, pluginId: "safe-review", apply: true });
  assert.equal(created.status, "CREATED");
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugins/safe-review/plugin.json"), "utf8"));
  assert.deepEqual(plugin.permissions.filesystem_write, []);
  assert.equal(created.private_key_generated, false);
  assert.throws(() => initializePlugin({ target: root, pluginId: "safe-review", output: "../escape", apply: true }), /remain/);
});

test("CLI exposes explainable traceability and preserves nonzero unknown states", async () => {
  const root = repository();
  const messages = [];
  const io = { log: (value) => messages.push(String(value)) };
  assert.equal(await main(["why", "app.mjs", "--target", root], io), 1);
  await main(["decision", "record", "--target", root, "--decision-id", "DEC-CLI", "--event-id", "event-cli", "--actor", "owner", "--question", "Why?", "--choice", "safe", "--rationale", "reviewed", "--artifact", "app.mjs"], io);
  assert.equal(await main(["why", "app.mjs:1", "--target", root], io), 0);
  assert.match(messages.at(-1), /EXPLAINED/);
});

test("verified repeated runs create review-only improvement proposals", () => {
  const root = repository();
  for (const id of ["RUN-1", "RUN-2", "RUN-3"]) recordRunEvent({ target: root, runId: id, eventId: `${id}.close`, phase: "close", actor: "fixture", timestamp: `2026-08-14T00:0${id.at(-1)}:00.000Z` });
  const proposal = proposeCapabilityImprovement({ target: root, candidateId: "safer-review", kind: "skill", runIds: ["RUN-1", "RUN-2", "RUN-3"], reason: "repeated verified recovery", timestamp: "2026-08-14T01:00:00.000Z" });
  assert.equal(proposal.status, "REVIEW_REQUIRED");
  assert.equal(proposal.promotion.automatic, false);
  assert.equal(proposeCapabilityImprovement({ target: root, candidateId: "too-early", runIds: ["RUN-1"] }).status, "INSUFFICIENT_EVIDENCE");
});

test("operator view is derived, redacted, rebuildable, and local", () => {
  const root = repository();
  recordDecision({ target: root, decisionId: "DEC-VIEW", eventId: "dv1", actor: "owner", question: "Show?", choice: "redacted", rationale: "privacy" });
  recordRunEvent({ target: root, runId: "RUN-VIEW", eventId: "rv1", phase: "start", actor: "fixture" });
  const snapshot = buildOperatorSnapshot({ target: root });
  assert.equal(snapshot.privacy.contains_run_ids, false);
  assert.equal(snapshot.runs[0].run_id_hash.length, 64);
  const written = writeOperatorView({ target: root });
  assert.equal(written.status, "HEALTHY");
  assert.match(fs.readFileSync(written.files.html, "utf8"), /Derived view, never the source of truth/);
});
