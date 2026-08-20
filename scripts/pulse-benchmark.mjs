import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeArchitecturePulse } from "../src/pulse.mjs";
import { createPulseBaseline, verifyPulseBaseline } from "../src/pulse-baseline.mjs";
import { evaluatePulsePolicy } from "../src/pulse-policy.mjs";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixtureRepository(fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pulse-benchmark-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "pulse@example.invalid"]);
  git(root, ["config", "user.name", "Architecture Pulse Benchmark"]);
  for (const [relative, content] of Object.entries(fixture.files)) write(root, relative, content);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "golden graph"]);
  return root;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : 1;
}

const fixtureFile = process.argv[2] ?? "test/fixtures/v141/golden-dependency-graph.json";
const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
const root = fixtureRepository(fixture);
const started = performance.now();
try {
  const first = analyzeArchitecturePulse({ target: root });
  const second = analyzeArchitecturePulse({ target: root });
  const expected = new Set(fixture.expected_edges.map(([from, to]) => `${from}\0${to}`));
  const actual = new Set(first.graph.edges.map((edge) => `${edge.from}\0${edge.to}`));
  const truePositive = [...actual].filter((edge) => expected.has(edge)).length;
  const falsePositive = [...actual].filter((edge) => !expected.has(edge)).length;
  const falseNegative = [...expected].filter((edge) => !actual.has(edge)).length;

  const rules = [{ id: "no-new-cycles", type: "new-cycles", threshold: 0, severity: "block" }];
  const baseline = createPulseBaseline(analyzeArchitecturePulse({ target: root, configObject: { rules } }), { createdAt: "2026-08-20T00:00:00.000Z" });
  write(root, "old/a.js", "import './b.js';\n");
  write(root, "old/b.js", "import './a.js';\n");
  const seeded = analyzeArchitecturePulse({ target: root, configObject: { rules } });
  const seededComparison = evaluatePulsePolicy({ baseline, current: seeded, verification: verifyPulseBaseline(baseline, seeded), rules });

  const coverageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pulse-coverage-"));
  git(coverageRoot, ["init", "-q"]); git(coverageRoot, ["config", "user.email", "pulse@example.invalid"]); git(coverageRoot, ["config", "user.name", "Pulse"]);
  write(coverageRoot, "src/a.js", "export const a = true;\n"); write(coverageRoot, "src/native.c", "int main(void){return 0;}\n"); git(coverageRoot, ["add", "."]); git(coverageRoot, ["commit", "-qm", "coverage"]);
  const coverage = analyzeArchitecturePulse({ target: coverageRoot });
  fs.rmSync(coverageRoot, { recursive: true, force: true });

  const report = {
    schema_version: 1,
    status: falseNegative === 0 && falsePositive === 0 && first.result_digest === second.result_digest && seededComparison.status === "REGRESSED" && coverage.analysis_status === "DEGRADED" ? "PASSED" : "FAILED",
    corpus: { expected_edges: expected.size, actual_edges: actual.size, languages: 7 },
    accuracy: {
      precision: ratio(truePositive, truePositive + falsePositive),
      recall: ratio(truePositive, truePositive + falseNegative),
      true_positive: truePositive,
      false_positive: falsePositive,
      false_negative: falseNegative
    },
    gates: {
      deterministic_digest: first.result_digest === second.result_digest,
      seeded_blocking_violation_detected: seededComparison.status === "REGRESSED" && seededComparison.blocking,
      unsupported_scope_never_complete: coverage.analysis_status === "DEGRADED" && coverage.coverage.supported_scope < 1,
      composite_index_used_as_gate: false
    },
    performance: {
      elapsed_ms: Number((performance.now() - started).toFixed(3)),
      heap_used_bytes: process.memoryUsage().heapUsed,
      note: "Observed values are recorded for calibration; release thresholds require a representative multi-repository corpus."
    }
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "PASSED" ? 0 : 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
