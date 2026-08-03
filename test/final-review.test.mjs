import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createTask } from "../src/governed-runtime.mjs";
import { buildFinalTaskReport, renderFinalTaskReport } from "../src/task-report.mjs";
import { assertFinalReviewPassed, inspectFinalReview, recordFinalReview } from "../src/final-review.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-final-review-"));
  run("git", ["init"], root);
  run("git", ["config", "user.email", "test@example.com"], root);
  run("git", ["config", "user.name", "Test User"], root);
  fs.writeFileSync(path.join(root, ".gitignore"), ".ai-agent-kit/\n");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const ok = true;\n");
  run("git", ["add", "."], root);
  run("git", ["commit", "-m", "fixture"], root);
  createTask({ target: root, id: "REVIEW-1", goal: "Ship safely", acceptanceCriteria: ["Behavior works"], approvalHash: "approved", paths: ["app.mjs"] });
  return root;
}

function review(status = "PASSED") {
  const dimensions = Object.fromEntries([
    "requirement_match", "security", "code_quality", "failure_paths",
    "error_handling", "production_readiness", "trade_offs"
  ].map((name) => [name, { status: "PASSED", summary: `${name} reviewed`, evidence_refs: [`test://${name}`] }]));
  return { schema_version: 1, task_id: "REVIEW-1", status, dimensions, findings: [], residual_risks: ["Deployment not performed"], limitations: [] };
}

test("final review records reviewed dimensions and becomes stale after code changes", () => {
  const root = repo();
  const file = path.join(root, "review.json");
  fs.writeFileSync(file, `${JSON.stringify(review())}\n`);
  const recorded = recordFinalReview({ target: root, id: "REVIEW-1", file });
  assert.equal(recorded.status, "PASSED");
  assert.equal(inspectFinalReview({ target: root, id: "REVIEW-1" }).status, "PASSED");
  fs.appendFileSync(path.join(root, "app.mjs"), "export const changed = true;\n");
  assert.equal(inspectFinalReview({ target: root, id: "REVIEW-1" }).status, "STALE");
});

test("final review fails closed and appears in the final report", () => {
  const root = repo();
  assert.throws(() => assertFinalReviewPassed({ target: root, id: "REVIEW-1" }), /NOT_RUN/);
  const report = buildFinalTaskReport({ target: root, id: "REVIEW-1" });
  assert.equal(report.final_review.status, "NOT_RUN");
  assert.match(renderFinalTaskReport(report), /Final Implementation Review\nDecision: NOT_RUN/);
  assert.ok(report.production_readiness.blockers.includes("Final implementation review is NOT_RUN."));
});

test("final review rejects a tampered hash chain", () => {
  const root = repo();
  const file = path.join(root, "review.json");
  fs.writeFileSync(file, `${JSON.stringify(review())}\n`);
  recordFinalReview({ target: root, id: "REVIEW-1", file });
  const ledger = path.join(root, ".ai-agent-kit", "runtime", "reviews", "REVIEW-1.jsonl");
  const record = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
  record.status = "BLOCKED";
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`);
  assert.equal(inspectFinalReview({ target: root, id: "REVIEW-1" }).status, "REJECTED");
});

test("final review preserves fix history across cycles and only passes on the latest clean cycle", () => {
  const root = repo();
  const file = path.join(root, "review.json");
  const blocked = review("BLOCKED");
  blocked.dimensions.error_handling = { status: "FAILED", summary: "Dependency errors escape", evidence_refs: ["test://failure"] };
  blocked.findings = [{
    id: "ERR-1", severity: "HIGH", status: "OPEN", category: "error-handling",
    location: "app.mjs:1", summary: "Dependency failure is not handled", resolution: null,
    evidence_refs: ["test://failure"]
  }];
  fs.writeFileSync(file, `${JSON.stringify(blocked)}\n`);
  recordFinalReview({ target: root, id: "REVIEW-1", file });
  assert.throws(() => assertFinalReviewPassed({ target: root, id: "REVIEW-1" }), /final implementation review is BLOCKED/);

  const passed = review("PASSED");
  fs.writeFileSync(file, `${JSON.stringify(passed)}\n`);
  assert.throws(() => recordFinalReview({ target: root, id: "REVIEW-1", file }), /resolve prior blocking findings: ERR-1/);
  passed.findings = [{
    id: "ERR-1", severity: "HIGH", status: "FIXED", category: "error-handling",
    location: "app.mjs:1", summary: "Dependency failure is now handled",
    resolution: "Added bounded error propagation and verified the failure case.",
    evidence_refs: ["test://failure-fixed"]
  }];
  fs.writeFileSync(file, `${JSON.stringify(passed)}\n`);
  recordFinalReview({ target: root, id: "REVIEW-1", file });
  const result = assertFinalReviewPassed({ target: root, id: "REVIEW-1" });
  assert.equal(result.cycle_count, 2);
  assert.equal(result.finding_history.length, 2);
  assert.equal(result.resolved_findings[0].id, "ERR-1");
  assert.equal(result.unresolved_findings.length, 0);
});

test("PASSED review rejects incomplete dimensions and unresolved high findings", () => {
  const root = repo();
  const file = path.join(root, "invalid-review.json");
  const invalid = review();
  invalid.dimensions.failure_paths = { status: "NOT_RUN", summary: "Not exercised", evidence_refs: [] };
  invalid.findings.push({
    id: "SEC-1", severity: "HIGH", status: "OPEN", category: "security",
    location: "app.mjs:1", summary: "Unsafe input path", resolution: null, evidence_refs: ["test://security"]
  });
  fs.writeFileSync(file, `${JSON.stringify(invalid)}\n`);
  assert.throws(() => recordFinalReview({ target: root, id: "REVIEW-1", file }), /PASSED final review/);
});
