import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  analyzeArchitecturePulse,
  checkArchitecturePulse,
  createArchitecturePulseBaseline,
  diffArchitecturePulse,
  migrateArchitecturePulseBaseline,
  readPulseResult,
  recordPulseTrend,
  readPulseTrend,
  verifyPulseFreshness,
  writeArchitecturePulseSarif,
  writePulseResult
} from "../src/pulse.mjs";
import { createPulseBaseline, verifyPulseBaseline, writePulseBaseline } from "../src/pulse-baseline.mjs";
import { pulseDigest } from "../src/pulse-contract.mjs";
import { evaluatePulsePolicy } from "../src/pulse-policy.mjs";
import { scanRepository } from "../src/pulse-scanner.mjs";

function repository(prefix = "aak-pulse-v141-") {
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
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const CI_VARIABLES = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "JENKINS_URL", "TF_BUILD"];

function asLocalDeveloper(action) {
  const previous = Object.fromEntries(CI_VARIABLES.map((name) => [name, process.env[name]]));
  try {
    for (const name of CI_VARIABLES) process.env[name] = "false";
    return action();
  } finally {
    for (const name of CI_VARIABLES) {
      if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
}

test("finding identity detects a replacement cycle even when aggregate count is unchanged", () => {
  const root = repository();
  const rules = [{ id: "no-new-cycles", type: "new-cycles", threshold: 0, severity: "block" }];
  try {
    write(root, "src/a.js", "import './b.js';\n");
    write(root, "src/b.js", "import './a.js';\n");
    commit(root);
    const baselineResult = analyzeArchitecturePulse({ target: root, configObject: { rules } });
    const baseline = asLocalDeveloper(() => createPulseBaseline(baselineResult, { createdAt: "2026-08-20T00:00:00.000Z" }));
    write(root, "src/a.js", "export const a = true;\n");
    write(root, "src/b.js", "export const b = true;\n");
    write(root, "src/c.js", "import './d.js';\n");
    write(root, "src/d.js", "import './c.js';\n");
    const current = analyzeArchitecturePulse({ target: root, configObject: { rules } });
    assert.equal(baselineResult.metrics.cycle_count, 1);
    assert.equal(current.metrics.cycle_count, 1);
    const comparison = evaluatePulsePolicy({ baseline, current, verification: verifyPulseBaseline(baseline, current), rules });
    assert.equal(comparison.status, "REGRESSED");
    assert.equal(comparison.blocking, true);
    assert.equal(comparison.finding_changes.new.filter((finding) => finding.type === "cycle").length, 1);
    assert.equal(comparison.finding_changes.fixed.filter((finding) => finding.type === "cycle").length, 1);
  } finally { cleanup(root); }
});

test("unsupported files inside declared source scope degrade honest coverage", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n");
    write(root, "src/native.c", "int main(void) { return 0; }\n");
    commit(root);
    const scan = scanRepository({ target: root, config: {} });
    assert.equal(scan.inventory.counts.supported_in_scope, 1);
    assert.equal(scan.inventory.counts.unsupported_in_scope, 1);
    assert.equal(scan.inventory.file_coverage, 0.5);
    const result = analyzeArchitecturePulse({ target: root });
    assert.equal(result.analysis_status, "DEGRADED");
    assert.equal(result.coverage.supported_scope, 0.5);
    assert.ok(result.reason_codes.includes("UNSUPPORTED_LANGUAGE"));
  } finally { cleanup(root); }
});

test("policy drift stays comparable while analysis drift requires a new baseline", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n");
    commit(root);
    const original = analyzeArchitecturePulse({ target: root, configObject: { rules: [{ id: "cycles", type: "new-cycles" }] } });
    const baseline = asLocalDeveloper(() => createPulseBaseline(original, { createdAt: "2026-08-20T00:00:00.000Z" }));
    const policyChanged = analyzeArchitecturePulse({ target: root, configObject: { rules: [{ id: "cycles", type: "new-cycles", severity: "block" }] } });
    assert.equal(verifyPulseBaseline(baseline, policyChanged).status, "VERIFIED");
    assert.equal(verifyPulseBaseline(baseline, policyChanged).policy_drift, true);
    const analysisChanged = analyzeArchitecturePulse({ target: root, configObject: { exclude: ["src"] } });
    assert.equal(verifyPulseBaseline(baseline, analysisChanged).reason_code, "BASELINE_ANALYSIS_CONFIG_DRIFT");
    const packageOnlyUpgrade = structuredClone(original);
    packageOnlyUpgrade.tool_version = "99.0.0";
    assert.equal(verifyPulseBaseline(baseline, packageOnlyUpgrade).status, "VERIFIED");
  } finally { cleanup(root); }
});

test("v1 baselines require an explicit reviewed v2 rebaseline", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n");
    commit(root);
    const v1 = {
      schema_version: 1,
      protocol: "aak-architecture-pulse-baseline-v1",
      name: "legacy",
      source_digest: "a".repeat(64),
      snapshot: { findings: { cycles: [["src/a.js"]], boundaries: [] } }
    };
    const file = ".ai-agent-kit/pulse/baselines/legacy.json";
    write(root, file, JSON.stringify(v1));
    assert.equal(verifyPulseBaseline(v1).reason_code, "BASELINE_MIGRATION_REQUIRED");
    const preview = migrateArchitecturePulseBaseline({ target: root, baseline: file, dryRun: true });
    assert.equal(preview.status, "REBASELINE_REQUIRED");
    assert.equal(preview.preview.recoverable_findings, 1);
  } finally { cleanup(root); }
});

test("precision adapters ignore commented JS imports and resolve TS path aliases", () => {
  const root = repository();
  try {
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@core/*": ["src/core/*"] } } }));
    write(root, "src/app.ts", "// import './ghost.js';\nimport { value } from '@core/value';\nexport { value };\n");
    write(root, "src/core/value.ts", "export const value = 1;\n");
    commit(root);
    const result = analyzeArchitecturePulse({ target: root, configObject: { schema_version: 2, resolvers: { typescript: true } } });
    assert.ok(!result.graph.edges.some((edge) => edge.specifier === "./ghost.js"));
    const alias = result.graph.edges.find((edge) => edge.from === "src/app.ts" && edge.to === "src/core/value.ts");
    assert.ok(alias);
    assert.equal(alias.evidence_tier, "RESOLVER_VERIFIED");
  } finally { cleanup(root); }
});

test("Python imports use AST evidence when python3 is available", () => {
  const root = repository();
  try {
    write(root, "pkg/a.py", "# import ghost\nfrom pkg import b\n");
    write(root, "pkg/b.py", "value = 1\n");
    commit(root);
    const result = analyzeArchitecturePulse({ target: root });
    const edge = result.graph.edges.find((candidate) => candidate.from === "pkg/a.py" && candidate.to === "pkg/b.py");
    assert.ok(edge);
    assert.equal(edge.evidence_tier, "AST_VERIFIED");
    assert.ok(!result.graph.unresolved.some((item) => item.specifier === "ghost"));
  } finally { cleanup(root); }
});

test("declared external packages and global public APIs keep their configured meaning", () => {
  const root = repository();
  try {
    write(root, "app/main.js", "import '../lib/internal.js';\n");
    write(root, "lib/internal.js", "export const hidden = true;\n");
    write(root, "lib/index.js", "export { hidden } from './internal.js';\n");
    write(root, "jvm/App.java", "package local;\nimport com.vendor.Client;\nclass App {}\n");
    commit(root);
    const result = analyzeArchitecturePulse({ target: root, configObject: { external_packages: ["com.vendor"], public_apis: ["lib/index.js"] } });
    assert.ok(result.graph.unresolved.some((item) => item.specifier === "com.vendor.Client" && item.classification === "external_declared"));
    assert.ok(result.finding_catalog.some((finding) => finding.type === "public-api" && finding.identity.from === "app/main.js" && finding.identity.to === "lib/internal.js"));
  } finally { cleanup(root); }
});

test("base/head diff reports new findings, edge changes, affected components, and witnesses", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "import './b.js';\n");
    write(root, "src/b.js", "export const b = true;\n");
    const base = commit(root, "base");
    write(root, "src/b.js", "import './a.js';\n");
    const result = diffArchitecturePulse({ target: root, base, head: "working-tree" });
    assert.equal(result.finding_changes.new.filter((finding) => finding.type === "cycle").length, 1);
    assert.ok(result.graph_changes.added_edges.some((edge) => edge.from === "src/b.js" && edge.to === "src/a.js"));
    assert.ok(result.affected_components.length > 0);
    assert.ok(result.finding_changes.new[0].witness.length > 0);
  } finally { cleanup(root); }
});

test("waivers are exact, integrity-bound, expiring, and fail closed", () => {
  const root = repository();
  const rules = [{ id: "cycles", type: "new-cycles", threshold: 0, severity: "block" }];
  try {
    write(root, "src/a.js", "export const a = true;\n");
    write(root, "src/b.js", "export const b = true;\n");
    commit(root);
    const baselineResult = analyzeArchitecturePulse({ target: root, configObject: { rules } });
    const baseline = asLocalDeveloper(() => createPulseBaseline(baselineResult, { createdAt: "2026-08-20T00:00:00.000Z" }));
    write(root, "src/a.js", "import './b.js';\n");
    write(root, "src/b.js", "import './a.js';\n");
    const current = analyzeArchitecturePulse({ target: root, configObject: { rules } });
    const fingerprint = current.finding_catalog.find((finding) => finding.type === "cycle").fingerprint;
    const waiverBody = { fingerprint, owner: "architecture", reason: "tracked migration", issue: "#123", approved_by: "maintainer", created_at: "2026-08-20T00:00:00.000Z", expires_at: "2026-09-20T00:00:00.000Z" };
    const waiver = { ...waiverBody, integrity: { algorithm: "SHA-256", digest: pulseDigest(waiverBody) } };
    const verification = verifyPulseBaseline(baseline, current);
    const waived = evaluatePulsePolicy({ baseline, current, verification, rules, waivers: [waiver], now: "2026-08-21T00:00:00.000Z" });
    assert.equal(waived.blocking, false);
    assert.equal(waived.waivers.applied.length, 1);
    const expired = evaluatePulsePolicy({ baseline, current, verification, rules, waivers: [waiver], now: "2026-10-01T00:00:00.000Z" });
    assert.equal(expired.blocking, true);
    assert.equal(expired.reason_code, "WAIVER_EXPIRED");
    const tampered = structuredClone(waiver); tampered.reason = "changed";
    assert.equal(evaluatePulsePolicy({ baseline, current, verification, rules, waivers: [tampered], now: "2026-08-21T00:00:00.000Z" }).reason_code, "WAIVER_INVALID");
  } finally { cleanup(root); }
});

test("blocking rules below their approved evidence tier degrade instead of silently passing", () => {
  const root = repository();
  const config = { schema_version: 2, blocking_minimum_tier: "RESOLVER_VERIFIED", rules: [{ id: "cycles", type: "new-cycles", severity: "block" }] };
  try {
    write(root, "src/a.js", "export const a = true;\n"); write(root, "src/b.js", "export const b = true;\n"); commit(root);
    const baselineResult = analyzeArchitecturePulse({ target: root, configObject: config });
    const baseline = asLocalDeveloper(() => createPulseBaseline(baselineResult, { createdAt: "2026-08-20T00:00:00.000Z" }));
    write(root, "src/a.js", "import './b.js';\n"); write(root, "src/b.js", "import './a.js';\n");
    const current = analyzeArchitecturePulse({ target: root, configObject: config });
    const result = evaluatePulsePolicy({ baseline, current, verification: verifyPulseBaseline(baseline, current), rules: config.rules, blockingMinimumTier: config.blocking_minimum_tier });
    assert.equal(result.status, "DEGRADED");
    assert.equal(result.blocking, false);
    assert.equal(result.findings[0].evidence_sufficient, false);
  } finally { cleanup(root); }
});

test("large result artifacts are sharded and remain readable", () => {
  const root = repository();
  try {
    for (let index = 0; index < 180; index += 1) write(root, `src/n${index}.js`, index ? `import './n${index - 1}.js';\n` : "export const root = true;\n");
    commit(root);
    const result = analyzeArchitecturePulse({ target: root, configObject: { max_artifact_bytes: 24000, graph_shard_bytes: 8000 } });
    const output = ".ai-agent-kit/pulse/results/sharded.json";
    writePulseResult(result, { target: root, output });
    const stored = readPulseResult({ target: root, file: output });
    assert.equal(stored.graph.storage, "external");
    assert.ok(stored.graph.artifacts.length > 1);
    for (const artifact of stored.graph.artifacts) assert.ok(fs.statSync(path.join(root, artifact.path)).size <= 8000);
  } finally { cleanup(root); }
});

test("SARIF and append-only trends preserve stable evidence identities", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "import './b.js';\n"); write(root, "src/b.js", "import './a.js';\n"); commit(root);
    const result = analyzeArchitecturePulse({ target: root });
    const pulseFile = ".ai-agent-kit/pulse/results/latest.json";
    writePulseResult(result, { target: root, output: pulseFile });
    const sarif = writeArchitecturePulseSarif(result, { target: root, output: ".ai-agent-kit/pulse/results/pulse.sarif" });
    assert.equal(sarif.results, 1);
    const sarifBody = JSON.parse(fs.readFileSync(path.join(root, sarif.output), "utf8"));
    assert.equal(sarifBody.version, "2.1.0");
    assert.equal(sarifBody.runs[0].results[0].fingerprints["architecturePulse/v2"], result.finding_catalog[0].fingerprint);
    recordPulseTrend(result, { target: root, recordedAt: "2026-08-20T00:00:00.000Z" });
    recordPulseTrend(result, { target: root, recordedAt: "2026-08-21T00:00:00.000Z" });
    const history = readPulseTrend({ target: root });
    assert.equal(history.status, "VERIFIED");
    assert.equal(history.records.length, 2);
    assert.equal(history.records[1].previous_digest, history.records[0].record_digest);
  } finally { cleanup(root); }
});

test("cache is deterministic and tampered cache never becomes authoritative", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const options = { target: root, configObject: { cache: { enabled: true } } };
    const first = analyzeArchitecturePulse(options);
    const second = analyzeArchitecturePulse(options);
    assert.equal(first.analysis_status, "COMPLETE");
    assert.equal(second.analysis_status, "DEGRADED");
    assert.equal(second.cache.used, true);
    assert.ok(second.reason_codes.includes("CACHE_NON_AUTHORITATIVE"));
    const cache = fs.readdirSync(path.join(root, ".ai-agent-kit/pulse/cache")).map((name) => path.join(root, ".ai-agent-kit/pulse/cache", name))[0];
    const body = JSON.parse(fs.readFileSync(cache, "utf8"));
    body.analysis.metrics.cycle_count = 999;
    const { integrity: _integrity, ...cacheBody } = body;
    body.integrity.digest = pulseDigest(cacheBody);
    fs.writeFileSync(cache, JSON.stringify(body));
    const third = analyzeArchitecturePulse(options);
    assert.equal(third.metrics.cycle_count, 999);
    assert.equal(third.analysis_status, "DEGRADED");
    assert.equal(third.cache.used, true);
    assert.equal(third.cache.authoritative, false);
    const governed = asLocalDeveloper(() => createArchitecturePulseBaseline({ ...options, output: ".ai-agent-kit/pulse/baselines/governed.json" }));
    assert.equal(governed.result.analysis_status, "COMPLETE");
    assert.equal(governed.result.metrics.cycle_count, 0);
    assert.ok(governed.baseline);
  } finally { cleanup(root); }
});

test("cache and trend outputs reject repository-internal symlink escapes", () => {
  const cacheRoot = repository();
  const trendRoot = repository();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pulse-outside-"));
  try {
    write(cacheRoot, "src/a.js", "export const a = true;\n"); commit(cacheRoot);
    fs.symlinkSync(outside, path.join(cacheRoot, ".ai-agent-kit"), "dir");
    assert.throws(() => analyzeArchitecturePulse({ target: cacheRoot, configObject: { cache: { enabled: true } } }), /cannot traverse a symbolic link/);

    write(trendRoot, "src/a.js", "export const a = true;\n"); commit(trendRoot);
    const result = analyzeArchitecturePulse({ target: trendRoot, configObject: { cache: { enabled: false } } });
    fs.symlinkSync(outside, path.join(trendRoot, ".ai-agent-kit"), "dir");
    assert.throws(() => recordPulseTrend(result, { target: trendRoot }), /cannot traverse a symbolic link/);
  } finally {
    cleanup(cacheRoot);
    cleanup(trendRoot);
    cleanup(outside);
  }
});

test("trend recording rejects forged result evidence", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const result = analyzeArchitecturePulse({ target: root });
    const forged = structuredClone(result);
    forged.metrics.cycle_count = 42;
    assert.throws(() => recordPulseTrend(forged, { target: root }), /digest mismatch/);
  } finally { cleanup(root); }
});

test("native resolver probes are forced offline", {
  skip: process.platform === "win32" ? "the exact environment probe uses a POSIX fake executable" : false
}, () => {
  const root = repository();
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pulse-tools-"));
  const previousPath = process.env.PATH;
  try {
    write(root, "go.mod", "module example.test/app\n\ngo 1.22\n");
    write(root, "main.go", "package main\n\nfunc main() {}\n");
    commit(root);
    const fakeGo = path.join(tools, "go");
    fs.writeFileSync(fakeGo, "#!/bin/sh\nprintf '%s' \"$GOPROXY,$GOSUMDB,$*\" > \"$PWD/offline-evidence.txt\"\nexit 1\n");
    fs.chmodSync(fakeGo, 0o700);
    process.env.PATH = `${tools}${path.delimiter}${previousPath}`;
    const result = analyzeArchitecturePulse({ target: root, configObject: { schema_version: 2 } });
    assert.equal(result.analysis_status, "DEGRADED");
    assert.equal(fs.readFileSync(path.join(root, "offline-evidence.txt"), "utf8"), "off,off,list -deps -f {{.ImportPath}}\t{{.Dir}} ./...");
  } finally {
    process.env.PATH = previousPath;
    cleanup(root);
    cleanup(tools);
  }
});

test("configuration paths reject parent traversal segments", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    assert.throws(() => scanRepository({ target: root, config: { include: ["src/.."] } }), /cannot escape the repository/);
  } finally { cleanup(root); }
});

test("freshness detects content changes even when Git status remains modified", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const value = 1;\n"); commit(root);
    write(root, "src/a.js", "export const value = 2;\n");
    const result = analyzeArchitecturePulse({ target: root });
    assert.equal(verifyPulseFreshness(result, { target: root }).status, "VERIFIED");
    write(root, "src/a.js", "export const value = 3;\n");
    assert.equal(verifyPulseFreshness(result, { target: root }).status, "STALE");
  } finally { cleanup(root); }
});

test("baseline writes are refused in CI", () => {
  const root = repository();
  const previous = process.env.CI;
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const result = analyzeArchitecturePulse({ target: root });
    const baseline = createPulseBaseline(result);
    process.env.CI = "true";
    assert.throws(() => writePulseBaseline(baseline, { target: root }), /cannot be created in CI/);
    assert.equal(fs.existsSync(path.join(root, ".ai-agent-kit/pulse/baselines/default.json")), false);
  } finally {
    if (previous == null) delete process.env.CI; else process.env.CI = previous;
    cleanup(root);
  }
});

test("trusted baseline history cannot be overwritten silently", () => {
  const root = repository();
  try {
    write(root, "src/a.js", "export const a = true;\n"); commit(root);
    const result = analyzeArchitecturePulse({ target: root });
    const baseline = asLocalDeveloper(() => createPulseBaseline(result, { name: "reviewed", createdAt: "2026-08-20T00:00:00.000Z" }));
    const first = asLocalDeveloper(() => writePulseBaseline(baseline, { target: root }));
    const original = fs.readFileSync(path.join(root, first.baseline), "utf8");
    assert.throws(() => asLocalDeveloper(() => writePulseBaseline(baseline, { target: root })), /already exists/);
    assert.equal(fs.readFileSync(path.join(root, first.baseline), "utf8"), original);
  } finally { cleanup(root); }
});
