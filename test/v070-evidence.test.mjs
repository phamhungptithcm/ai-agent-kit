import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compareEvalResults, gateEvalResults, replayEvalFixture } from "../src/eval-harness.mjs";
import { compareReviewQuality, scoreReviewQuality } from "../src/review-quality.mjs";
import { assertPrEvidenceScope, buildPrEvidencePackage, renderPrEvidenceMarkdown } from "../src/pr-evidence.mjs";
import { createTask } from "../src/governed-runtime.mjs";

const fixture = (name) => path.resolve("test/fixtures/v070", name);

test("replays the same offline case for Claude and Codex and catches trajectory violations", () => {
  const pass = replayEvalFixture({ fixture: fixture("eval-pass.json") });
  assert.equal(pass.status, "PASSED");
  assert.deepEqual(pass.runs.map((run) => run.adapter), ["claude", "codex"]);
  const failed = replayEvalFixture({ fixture: fixture("eval-regression.json") });
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.failure_taxonomy.includes("APPROVAL_VIOLATION"));
  assert.ok(failed.failure_taxonomy.includes("DENIED_ACTION_EXECUTED"));
});

test("blocks material eval regressions and reports confidence intervals", () => {
  const result = compareEvalResults({ baseline: fixture("eval-pass.json"), candidate: fixture("eval-regression.json") });
  assert.equal(result.status, "REGRESSION");
  assert.equal(result.material_regression, true);
  assert.equal(result.baseline.confidence_interval_95.sample_size, 2);
  assert.throws(() => gateEvalResults({ baseline: fixture("eval-pass.json"), candidate: fixture("eval-regression.json") }), /regression/);
});

test("review metrics penalize noise and preserve explicit denominators", () => {
  const baseline = scoreReviewQuality({ fixture: fixture("review-baseline.json") });
  const noisy = scoreReviewQuality({ fixture: fixture("review-noisy.json") });
  assert.equal(baseline.metrics.finding_accuracy.denominator, 1);
  assert.ok(baseline.quality_score > noisy.quality_score);
  assert.equal(compareReviewQuality({ baseline: fixture("review-baseline.json"), candidate: fixture("review-noisy.json") }).status, "REGRESSION");
});

test("PR evidence is deterministic, source-linked, and fails on scope drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-v070-"));
  try {
    spawnSync("git", ["init"], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/a.mjs"), "export const a = 1;\n");
    spawnSync("git", ["add", "src/a.mjs"], { cwd: root });
    spawnSync("git", ["commit", "-m", "base"], { cwd: root });
    createTask({ target: root, id: "PR-1", goal: "Change source", acceptanceCriteria: ["Source changes"], paths: ["src/**"], tools: ["edit"] });
    fs.writeFileSync(path.join(root, "src/a.mjs"), "export const a = 2;\n");
    const first = buildPrEvidencePackage({ target: root, id: "PR-1" });
    const second = buildPrEvidencePackage({ target: root, id: "PR-1" });
    assert.deepEqual(first, second);
    assert.equal(assertPrEvidenceScope(first).change.approval_to_diff.status, "PASSED");
    assert.match(renderPrEvidenceMarkdown(first), /Receipt ledger/);
    fs.writeFileSync(path.join(root, "outside.txt"), "drift\n");
    assert.throws(() => assertPrEvidenceScope(buildPrEvidencePackage({ target: root, id: "PR-1" })), /scope drift/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
