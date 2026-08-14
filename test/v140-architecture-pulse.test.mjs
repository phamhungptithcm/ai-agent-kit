import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { analyzeArchitecturePulse, checkArchitecturePulse, createArchitecturePulseBaseline, readPulseConfig, readPulseDocument, writePulseResult } from "../src/pulse.mjs";
import { scanRepository } from "../src/pulse-scanner.mjs";
import { extractDependencies } from "../src/pulse-extractors.mjs";
import { buildPulseGraph } from "../src/pulse-graph.mjs";
import { createPulseBaseline, verifyPulseBaseline } from "../src/pulse-baseline.mjs";
import { evaluatePulsePolicy, pulseExitCode } from "../src/pulse-policy.mjs";
import { buildFinalTaskReport } from "../src/task-report.mjs";
import { createTask } from "../src/governed-runtime.mjs";
import { demoProof } from "../src/proof-replay.mjs";
import { generatePassportKey, issueChangePassport, verifyChangePassport } from "../src/change-passport.mjs";
import { pulseDigest, validatePulseResult } from "../src/pulse-contract.mjs";

const cli = path.resolve("bin/ai-agent-kit.mjs");

function repository(prefix = "aak-pulse-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "pulse@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Architecture Pulse"], { cwd: root });
  return root;
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function commit(root, message = "fixture") {
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", message], { cwd: root });
}

test("pulse scan is deterministic and resolves only same-language evidence by default", () => {
  const root = repository();
  try {
    write(root, "src/a.ts", "import { b } from './b.js';\nexport const a = b;\n");
    write(root, "src/b.js", "export const b = 1;\n");
    write(root, "python/a.py", "from python import b\n");
    write(root, "python/b.py", "value = 1\n");
    write(root, "rust/lib.rs", "mod worker;\n");
    write(root, "rust/worker.rs", "pub fn run() {}\n");
    commit(root);
    const first = analyzeArchitecturePulse({ target: root });
    const second = analyzeArchitecturePulse({ target: root });
    assert.equal(first.result_digest, second.result_digest);
    assert.ok(first.graph.edges.some((edge) => edge.from === "src/a.ts" && edge.to === "src/b.js"));
    assert.ok(first.graph.edges.some((edge) => edge.from === "python/a.py" && edge.to === "python/b.py"));
    assert.ok(!first.graph.edges.some((edge) => edge.from === "src/a.ts" && edge.to === "python/b.py"));
    const bridged = analyzeArchitecturePulse({ target: root, configObject: { bridges: [{ id: "explicit-api", from: "src/a.ts", to: "python/b.py" }] } });
    assert.ok(bridged.graph.edges.some((edge) => edge.resolution === "explicit-cross-language-manifest"));
    assert.ok(bridged.coverage.imports <= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("graph metrics cover cycles, disconnected roots, boundaries, hotspots, and blast radius", () => {
  const root = repository();
  try {
    write(root, "src/domain/a.js", "import '../ui/view.js';\nimport './b.js';\n");
    write(root, "src/domain/b.js", "import './a.js';\n");
    write(root, "src/ui/view.js", "export const view = true;\n");
    write(root, "other/root.js", "import './leaf.js';\n");
    write(root, "other/leaf.js", "export const leaf = true;\n");
    commit(root);
    const scan = scanRepository({ target: root, config: { boundaries: [{ name: "domain-ui", from: "src/domain", deny: ["src/ui"] }] } });
    const graph = buildPulseGraph(scan, extractDependencies(scan));
    assert.equal(graph.metrics.cycle_count, 1);
    assert.equal(graph.metrics.boundary_violation_count, 1);
    assert.ok(graph.metrics.condensation_root_count >= 2);
    assert.ok(graph.metrics.condensation_depth >= 1);
    assert.ok(graph.metrics.maximum_blast_radius >= 1);
    assert.equal(graph.findings.blast_radius[0].node, "src/ui/view.js");
    assert.equal(graph.findings.blast_radius[0].reachable_dependents, 2);
    assert.ok(graph.findings.hotspots.length > 0);
    assert.match(graph.metric_version, /^1\./);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("scanner bounds candidate discovery and rejects unsafe or excessive configuration", () => {
  const root = repository();
  try {
    write(root, "00.txt", "unsupported\n"); write(root, "01.txt", "unsupported\n"); write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const scan = scanRepository({ target: root, config: { max_files: 2 } });
    assert.equal(scan.inventory.status, "DEGRADED");
    assert.equal(scan.inventory.counts.discovered, 3);
    assert.equal(scan.inventory.counts.truncated, 1);
    assert.equal(scan.inventory.counts.exclusion_reasons.resource_limit, 1);
    const degraded = analyzeArchitecturePulse({ target: root, configObject: { max_files: 2 } });
    assert.equal(degraded.analysis_status, "DEGRADED");
    const baseline = createArchitecturePulseBaseline({ target: root, configObject: { max_files: 2 } });
    assert.equal(baseline.artifact, null);
    assert.equal(fs.existsSync(path.join(root, ".ai-agent-kit/pulse/baselines/default.json")), false);
    assert.throws(() => scanRepository({ target: root, config: { max_file_bytes: 16 * 1024 * 1024 + 1 } }), /between 1 and/);
    write(root, "bad-config.json", JSON.stringify({ include: ["../outside"], surprise: true }));
    assert.throws(() => readPulseConfig({ target: root, config: "bad-config.json" }), /unsupported property|escape/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("scanner excludes symlinks, hard links, unsupported files, and bounded resources", () => {
  const root = repository(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pulse-outside-"));
  try {
    write(root, "src/safe.js", "export const safe = true;\n");
    write(root, "src/large.js", "x".repeat(2048));
    write(root, "README.md", "unsupported\n");
    write(outside, "secret.js", "export const secret = true;\n");
    fs.symlinkSync(path.join(outside, "secret.js"), path.join(root, "src/link.js"));
    fs.linkSync(path.join(root, "src/safe.js"), path.join(root, "src/hard.js"));
    commit(root);
    const scan = scanRepository({ target: root, config: { max_file_bytes: 1024 } });
    assert.deepEqual(scan.inventory.entries.map((entry) => entry.path), []);
    const reasons = new Set(scan.inventory.exclusions.map((entry) => entry.reason));
    assert.ok(reasons.has("symlink"));
    assert.ok(reasons.has("hard_link"));
    assert.ok(reasons.has("oversized"));
    assert.ok(reasons.has("unsupported_language"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("trusted baselines reject tampering, foreign repositories, and incompatible config", () => {
  const root = repository(); const foreign = repository("aak-pulse-foreign-");
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    write(foreign, "src/a.js", "export const a = true;\n"); commit(foreign);
    const current = analyzeArchitecturePulse({ target: root });
    const baseline = createPulseBaseline(current, { createdAt: "2026-08-14T00:00:00.000Z" });
    assert.equal(verifyPulseBaseline(baseline, current).status, "VERIFIED");
    const tampered = structuredClone(baseline); tampered.snapshot.metrics.cycle_count += 1;
    assert.equal(verifyPulseBaseline(tampered, current).reason_code, "BASELINE_TAMPERED");
    assert.equal(verifyPulseBaseline(baseline, analyzeArchitecturePulse({ target: foreign })).reason_code, "BASELINE_FOREIGN_REPOSITORY");
    assert.equal(verifyPulseBaseline(baseline, analyzeArchitecturePulse({ target: root, configObject: { exclude: ["src"] } })).reason_code, "BASELINE_CONFIG_DRIFT");
    const upgraded = structuredClone(current); upgraded.tool_version = "99.0.0";
    assert.equal(verifyPulseBaseline(baseline, upgraded).reason_code, "BASELINE_INCOMPATIBLE");
    const malformedBaseline = structuredClone(baseline); malformedBaseline.snapshot.metrics = null;
    const { integrity: _integrity, ...malformedBody } = malformedBaseline; malformedBaseline.integrity.digest = pulseDigest(malformedBody);
    assert.equal(verifyPulseBaseline(malformedBaseline, current).status, "UNTRUSTED");
    const malformedResult = structuredClone(current); malformedResult.metrics.cycle_count = "0";
    const { result_digest: _resultDigest, ...resultBody } = malformedResult; malformedResult.result_digest = pulseDigest(resultBody);
    assert.throws(() => validatePulseResult(malformedResult), /metric values/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(foreign, { recursive: true, force: true }); }
});

test("explicit blocking policy detects new cycles while diagnostic index has no authority", () => {
  const root = repository();
  const config = { rules: [{ id: "no-new-cycles", type: "new-cycles", threshold: 0, severity: "block" }] };
  try {
    write(root, "src/a.js", "import './b.js';\n"); write(root, "src/b.js", "export const b = true;\n"); commit(root);
    const baselineResult = analyzeArchitecturePulse({ target: root, configObject: config });
    const baseline = createPulseBaseline(baselineResult, { createdAt: "2026-08-14T00:00:00.000Z" });
    write(root, "src/b.js", "import './a.js';\n");
    const current = analyzeArchitecturePulse({ target: root, configObject: config });
    const verification = verifyPulseBaseline(baseline, current);
    const result = evaluatePulsePolicy({ baseline, current, verification, rules: config.rules });
    assert.equal(result.status, "REGRESSED");
    assert.equal(result.blocking, true);
    assert.equal(pulseExitCode(result), 2);
    assert.ok(!result.findings.some((finding) => finding.type === "pulse-index"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI creates, verifies, checks, explains, and rejects escaped outputs", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "import './b.js';\n"); write(root, "src/b.js", "export const b = true;\n");
    write(root, "pulse.json", JSON.stringify({ schema_version: 1, rules: [{ id: "cycles", type: "new-cycles", threshold: 0, severity: "block" }] }));
    commit(root);
    const created = spawnSync(process.execPath, [cli, "pulse", "baseline", "create", "--target", root, "--config", "pulse.json"], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const verified = spawnSync(process.execPath, [cli, "pulse", "baseline", "verify", "--target", root, "--config", "pulse.json"], { encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    write(root, "src/b.js", "import './a.js';\n");
    const checked = spawnSync(process.execPath, [cli, "pulse", "check", "--target", root, "--config", "pulse.json", "--output", ".ai-agent-kit/pulse/results/check.json"], { encoding: "utf8" });
    assert.equal(checked.status, 2, checked.stderr);
    const document = readPulseDocument({ target: root, file: ".ai-agent-kit/pulse/results/check.json" });
    assert.equal(document.status, "REGRESSED"); assert.equal(document.blocking, true);
    const malformed = structuredClone(document); malformed.blocking = "false";
    const { evidence_digest: _evidenceDigest, ...comparisonBody } = malformed; malformed.evidence_digest = pulseDigest(comparisonBody);
    fs.writeFileSync(path.join(root, ".ai-agent-kit/pulse/results/check.json"), JSON.stringify(malformed));
    assert.throws(() => readPulseDocument({ target: root, file: ".ai-agent-kit/pulse/results/check.json" }), /contract is invalid/);
    fs.writeFileSync(path.join(root, ".ai-agent-kit/pulse/results/check.json"), JSON.stringify(document));
    const explained = spawnSync(process.execPath, [cli, "pulse", "explain", "--target", root, "--file", ".ai-agent-kit/pulse/results/check.json"], { encoding: "utf8" });
    assert.equal(explained.status, 0, explained.stderr); assert.match(explained.stdout, /REGRESSED/);
    const escaped = spawnSync(process.execPath, [cli, "pulse", "scan", "--target", root, "--output", "../escape.json"], { encoding: "utf8" });
    assert.notEqual(escaped.status, 0); assert.match(escaped.stderr, /inside the repository/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("task reports accept only digest-valid task-bound Pulse evidence", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    createTask({ target: root, id: "PULSE-TASK", goal: "Verify architecture evidence", acceptanceCriteria: ["Pulse evidence is bound"] });
    const result = analyzeArchitecturePulse({ target: root, taskId: "PULSE-TASK", planId: "AAK-ARCH-PULSE-NATIVE-V1" });
    writePulseResult(result, { target: root, output: ".ai-agent-kit/pulse/tasks/PULSE-TASK.json" });
    const report = buildFinalTaskReport({ target: root, id: "PULSE-TASK", productionTarget: false });
    assert.equal(report.architecture_pulse.status, "VERIFIED");
    write(root, "src/a.js", "export const a = false;\n");
    assert.equal(buildFinalTaskReport({ target: root, id: "PULSE-TASK", productionTarget: false }).architecture_pulse.status, "STALE");
    write(root, "src/a.js", "export const a = true;\n");
    const file = path.join(root, ".ai-agent-kit/pulse/tasks/PULSE-TASK.json"); const tampered = JSON.parse(fs.readFileSync(file, "utf8")); tampered.metrics.cycle_count += 1; fs.writeFileSync(file, JSON.stringify(tampered));
    assert.equal(buildFinalTaskReport({ target: root, id: "PULSE-TASK", productionTarget: false }).architecture_pulse.status, "UNTRUSTED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Change Passports bind verified Pulse evidence and reject a foreign task binding", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const key = generatePassportKey({ target: root, keyId: "pulse-maintainer" });
    const pulse = analyzeArchitecturePulse({ target: root, taskId: "DEMO-001" });
    writePulseResult(pulse, { target: root, output: ".ai-agent-kit/pulse/tasks/DEMO-001.json" });
    const issued = issueChangePassport({ target: root, id: "DEMO-001", keyId: "pulse-maintainer", privateKey: key.private_key, pulseResult: ".ai-agent-kit/pulse/tasks/DEMO-001.json", apply: true }, { buildProofReplay: () => demoProof() });
    assert.equal(issued.architecture_pulse, "VERIFIED");
    assert.equal(verifyChangePassport({ target: root, file: issued.file }).architecture_pulse.status, "VERIFIED");
    write(root, "src/a.js", "export const a = false;\n");
    assert.throws(() => issueChangePassport({ target: root, id: "DEMO-001", keyId: "pulse-maintainer", privateKey: key.private_key, pulseResult: ".ai-agent-kit/pulse/tasks/DEMO-001.json", apply: true }, { buildProofReplay: () => demoProof() }), /stale Architecture Pulse evidence/);
    write(root, "src/a.js", "export const a = true;\n");
    const foreign = analyzeArchitecturePulse({ target: root, taskId: "OTHER-TASK" });
    writePulseResult(foreign, { target: root, output: ".ai-agent-kit/pulse/tasks/OTHER-TASK.json" });
    assert.throws(() => issueChangePassport({ target: root, id: "DEMO-001", keyId: "pulse-maintainer", privateKey: key.private_key, pulseResult: ".ai-agent-kit/pulse/tasks/OTHER-TASK.json", apply: true }, { buildProofReplay: () => demoProof() }), /not bound/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("check workflow preserves baseline comparison evidence with a self-verifying digest", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    createArchitecturePulseBaseline({ target: root });
    write(root, "src/a.js", "export const a = false;\n");
    const result = checkArchitecturePulse({ target: root });
    assert.match(result.evidence_digest, /^[a-f0-9]{64}$/);
    const file = ".ai-agent-kit/pulse/results/check.json";
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), JSON.stringify(result));
    assert.equal(readPulseDocument({ target: root, file }).evidence_digest, result.evidence_digest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("iterative SCC and sampled blast radius remain bounded on a long graph", () => {
  const count = 6000;
  const entries = Array.from({ length: count }, (_, index) => ({ path: `src/n${String(index).padStart(4, "0")}.js`, language: "javascript", bytes: 1, content_hash: "a".repeat(64) }));
  const edges = entries.slice(0, -1).map((entry, index) => ({ from: entry.path, to: entries[index + 1].path, language: "javascript", kind: "import", specifier: `./n${index + 1}.js`, line: 1, resolution: "same-language" }));
  const scan = { config: {}, inventory: { entries, file_coverage: 1, counts: { discovered: count, exclusion_reasons: {} } } };
  const extraction = { edges, unresolved: [], failures: [], counts: { imports_total: edges.length, resolved_internal: edges.length, unresolved: 0, failures: 0 } };
  const graph = buildPulseGraph(scan, extraction);
  assert.equal(graph.metrics.cycle_count, 0);
  assert.equal(graph.metrics.condensation_depth, count - 1);
  assert.equal(graph.metrics.blast_radius_complete, false);
  assert.equal(graph.metrics.blast_radius_sample_size, 200);
  assert.equal(graph.findings.blast_radius[0].node, entries.at(-1).path);
});
