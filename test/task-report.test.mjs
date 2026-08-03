import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { main } from "../src/cli.mjs";
import {
  addContext,
  createTask,
  revisePlan,
  transitionTask
} from "../src/governed-runtime.mjs";
import {
  buildFinalTaskReport,
  recordCriterionStatus,
  recordQualityCheck,
  renderFinalTaskReport
} from "../src/task-report.mjs";
import { recordUsage, summarizeUsage } from "../src/usage-ledger.mjs";
import { recordFinalReview } from "../src/final-review.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function makeRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ai-agent-kit-report-${name}-`));
  run("git", ["init"], root);
  run("git", ["config", "user.email", "test@example.com"], root);
  run("git", ["config", "user.name", "Test User"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".ai-agent-kit/\n");
  run("git", ["add", "README.md", ".gitignore"], root);
  run("git", ["commit", "-m", "initial"], root);
  return root;
}

function createReportTask(root, id = "TASK-REPORT") {
  return createTask({
    target: root,
    id,
    goal: "Produce a verified final task report",
    acceptanceCriteria: ["Feature behavior is verified", "Documentation is verified"],
    approvalHash: "approved-scope",
    tools: ["read", "edit"],
    paths: ["src/**"],
    adapter: "codex"
  });
}

function advanceToReviewReady(root, id = "TASK-REPORT") {
  const task = JSON.parse(fs.readFileSync(
    path.join(root, ".ai-agent-kit", "runtime", "tasks", `${id}.json`),
    "utf8"
  ));
  transitionTask({ target: root, id, to: "ANALYZE" });
  addContext({
    target: root,
    id,
    kind: "fact",
    statement: "Runtime flow inspected",
    source: "codegraph://runtime-flow"
  });
  revisePlan({
    target: root,
    id,
    trigger: "Repository evidence collected",
    steps: ["Implement approved scope", "Verify final report"]
  });
  transitionTask({ target: root, id, to: "PLAN_READY", evidence: { repository_intelligence: "READY" } });
  transitionTask({
    target: root,
    id,
    to: "APPROVED",
    evidence: { approval_hash: "approved-scope", approver: "repository-owner" }
  });
  transitionTask({
    target: root,
    id,
    to: "IMPLEMENTING",
    evidence: { capability_hash: task.capability_hash }
  });
  transitionTask({ target: root, id, to: "VERIFYING", evidence: { diff_scope: "approved-paths" } });
  const reviewFile = path.join(root, ".ai-agent-kit", "final-review-input.json");
  fs.mkdirSync(path.dirname(reviewFile), { recursive: true });
  const dimensions = Object.fromEntries([
    "requirement_match", "security", "code_quality", "failure_paths",
    "error_handling", "production_readiness", "trade_offs"
  ].map((name) => [name, { status: "PASSED", summary: `${name} reviewed`, evidence_refs: [`fixture://${name}`] }]));
  fs.writeFileSync(reviewFile, `${JSON.stringify({
    schema_version: 1,
    task_id: id,
    status: "PASSED",
    dimensions,
    findings: [],
    residual_risks: [],
    limitations: []
  })}\n`);
  recordFinalReview({ target: root, id, file: reviewFile });
  transitionTask({
    target: root,
    id,
    to: "REVIEW_READY",
    evidence: { tests: "passed", independent_verifier: "passed", final_review: "passed" }
  });
}

function passDefaultChecks(root, id = "TASK-REPORT") {
  for (const gate of ["lint", "typecheck", "tests", "build", "security"]) {
    recordQualityCheck({
      target: root,
      id,
      gate,
      status: "passed",
      source: `fixture://${gate}`,
      summary: `${gate} passed`,
      exitCode: 0
    });
  }
}

test("OpenAI usage normalizes cached input, deduplicates events, and estimates cost", () => {
  const root = makeRepo("openai");
  createReportTask(root);
  const options = {
    target: root,
    id: "TASK-REPORT",
    adapter: "codex",
    provider: "openai",
    model: "gpt-5.6-terra",
    usageSource: "provider_response",
    eventId: "response-123",
    inputTokens: 153_200,
    cachedInputTokens: 110_000,
    outputTokens: 31_120,
    reasoningTokens: 12_400,
    observedAt: "2026-07-30T12:00:00Z"
  };

  assert.equal(recordUsage(options).status, "RECORDED");
  assert.equal(recordUsage(options).status, "DUPLICATE_IGNORED");
  const summary = summarizeUsage({ target: root, id: "TASK-REPORT" });

  assert.equal(summary.event_count, 1);
  assert.equal(summary.usage.uncached_input_tokens, 43_200);
  assert.equal(summary.usage.cached_input_tokens, 110_000);
  assert.equal(summary.usage.output_tokens, 31_120);
  assert.equal(summary.usage.reasoning_tokens, 12_400);
  assert.equal(summary.usage.total_tokens, 184_320);
  assert.equal(summary.cost.status, "ESTIMATED");
  assert.equal(summary.cost.estimated_cost_usd_micros, 481_840);

  const ledger = fs.readFileSync(path.join(root, ".ai-agent-kit", "runtime", "usage", "events.jsonl"), "utf8");
  assert.doesNotMatch(ledger, /response-123/);
});

test("cumulative session usage selects the latest event instead of double counting", () => {
  const root = makeRepo("cumulative");
  createReportTask(root);
  const base = {
    target: root,
    id: "TASK-REPORT",
    adapter: "claude",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    usageSource: "adapter_telemetry",
    aggregationMode: "cumulative",
    sessionId: "private-session-id",
    cacheReadInputTokens: 200_000
  };
  recordUsage({
    ...base,
    inputTokens: 50,
    outputTokens: 100,
    observedAt: "2026-07-30T12:00:00Z"
  });
  recordUsage({
    ...base,
    inputTokens: 75,
    outputTokens: 175,
    observedAt: "2026-07-30T12:05:00Z"
  });

  const summary = summarizeUsage({ target: root, id: "TASK-REPORT" });
  assert.equal(summary.event_count, 1);
  assert.equal(summary.usage.uncached_input_tokens, 75);
  assert.equal(summary.usage.cached_input_tokens, 200_000);
  assert.equal(summary.usage.output_tokens, 175);
  assert.equal(summary.usage.total_tokens, 200_250);
  assert.equal(summary.cost.status, "ESTIMATED");
  assert.equal(summary.cost.estimated_cost_usd_micros, 62_850);
  const ledger = fs.readFileSync(path.join(root, ".ai-agent-kit", "runtime", "usage", "events.jsonl"), "utf8");
  assert.doesNotMatch(ledger, /private-session-id/);
});

test("unknown exact model keeps token totals but marks cost unavailable", () => {
  const root = makeRepo("unknown-price");
  createReportTask(root);
  recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "openai",
    model: "unknown-model",
    usageSource: "manual",
    inputTokens: 10,
    outputTokens: 5
  });
  const summary = summarizeUsage({ target: root, id: "TASK-REPORT" });
  assert.equal(summary.status, "AVAILABLE");
  assert.equal(summary.usage.total_tokens, 15);
  assert.equal(summary.cost.status, "UNAVAILABLE");
  assert.deepEqual(summary.cost.unavailable_reasons, ["no_exact_pricing_entry"]);
});

test("reviewed local pricing can estimate an otherwise unknown exact model", () => {
  const root = makeRepo("custom-price");
  createReportTask(root);
  recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "example",
    model: "exact-model",
    usageSource: "provider_response",
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    observedAt: "2026-07-30T12:00:00Z"
  });
  const registry = path.join(root, "pricing.local.json");
  fs.writeFileSync(registry, JSON.stringify({
    revision: "reviewed-local-v1",
    entries: [{
      provider: "example",
      model: "exact-model",
      effective_from: "2026-01-01",
      effective_to: null,
      rates_usd_per_million_tokens: { input: 1, output: 5 },
      source: "internal-reviewed-reference"
    }]
  }));

  const summary = summarizeUsage({
    target: root,
    id: "TASK-REPORT",
    registry: "pricing.local.json"
  });
  assert.equal(summary.cost.status, "ESTIMATED");
  assert.equal(summary.cost.estimated_cost_usd_micros, 1_500_000);
  assert.equal(summary.cost.pricing_revision, "reviewed-local-v1");
});

test("verified criteria and current required gates can produce a production-ready report", () => {
  const root = makeRepo("ready");
  createReportTask(root);
  advanceToReviewReady(root);
  recordCriterionStatus({
    target: root,
    id: "TASK-REPORT",
    criterion: 1,
    status: "verified",
    source: "test://feature"
  });
  recordCriterionStatus({
    target: root,
    id: "TASK-REPORT",
    criterion: 2,
    status: "verified",
    source: "test://docs"
  });
  passDefaultChecks(root);
  recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "openai",
    model: "gpt-5.6-luna",
    usageSource: "provider_response",
    inputTokens: 1_000,
    cachedInputTokens: 500,
    outputTokens: 100
  });

  const report = buildFinalTaskReport({ target: root, id: "TASK-REPORT" });
  assert.equal(report.progress.percent, 100);
  assert.equal(report.progress.verified, 2);
  assert.equal(report.evidence.status, "VERIFIED");
  assert.equal(report.code_status.git.status, "CLEAN");
  assert.equal(report.code_status.known_issues, "NONE_FOUND_WITHIN_EXECUTED_CHECKS");
  assert.equal(report.production_readiness.status, "READY");
  assert.equal(report.usage.usage.total_tokens, 1_100);
  assert.match(renderFinalTaskReport(report), /Total tokens used: 1,100/);
  assert.match(renderFinalTaskReport(report), /Production Readiness: READY/);
});

test("weighted progress is evidence-derived and dirty code blocks production readiness", () => {
  const root = makeRepo("weighted");
  createReportTask(root);
  advanceToReviewReady(root);
  recordCriterionStatus({
    target: root,
    id: "TASK-REPORT",
    criterion: 1,
    status: "verified",
    weight: 3,
    source: "test://feature"
  });
  recordCriterionStatus({
    target: root,
    id: "TASK-REPORT",
    criterion: 2,
    status: "pending",
    weight: 1,
    summary: "Documentation remains"
  });
  passDefaultChecks(root);
  fs.writeFileSync(path.join(root, "untracked.js"), "export {};\n");

  const report = buildFinalTaskReport({ target: root, id: "TASK-REPORT" });
  assert.equal(report.progress.percent, 75);
  assert.equal(report.progress.remaining.length, 1);
  assert.equal(report.code_status.git.status, "DIRTY");
  assert.equal(report.production_readiness.status, "NOT_READY");
  assert.ok(report.production_readiness.blockers.some((blocker) => blocker.includes("Git worktree is DIRTY")));
});

test("passing check evidence becomes stale after the repository commit changes", () => {
  const root = makeRepo("stale");
  createReportTask(root);
  passDefaultChecks(root);
  fs.writeFileSync(path.join(root, "CHANGE.md"), "change\n");
  run("git", ["add", "CHANGE.md"], root);
  run("git", ["commit", "-m", "change"], root);

  const report = buildFinalTaskReport({ target: root, id: "TASK-REPORT" });
  assert.ok(report.quality.gates.filter((gate) => gate.gate !== "final-implementation-review").every((gate) => gate.status === "STALE"));
  assert.equal(report.quality.gates.find((gate) => gate.gate === "final-implementation-review").status, "NOT_RUN");
  assert.equal(report.production_readiness.status, "NOT_READY");
});

test("CLI renders text, compact, and JSON report formats", async () => {
  const root = makeRepo("cli");
  createReportTask(root);
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };

  await main(["runtime", "task", "report", "--id", "TASK-REPORT", "--target", root], io);
  await main([
    "runtime", "task", "report", "--id", "TASK-REPORT", "--target", root, "--format", "compact"
  ], io);
  await main([
    "runtime", "task", "report", "--id", "TASK-REPORT", "--target", root, "--format", "json"
  ], io);

  assert.match(logs[0], /AI Agent Kit — Final Task Report/);
  assert.match(logs[0], /Tokens used: Unavailable/);
  assert.match(logs[1], /Tokens: unavailable/);
  assert.equal(JSON.parse(logs[2]).report_version, 1);
  await assert.rejects(
    () => main([
      "runtime", "task", "report", "--id", "TASK-REPORT", "--target", root, "--format", "yaml"
    ], io),
    /--format must be text, compact, or json/
  );
});

test("quality evidence stores hashes instead of raw evidence sources", () => {
  const root = makeRepo("privacy");
  createReportTask(root);
  recordQualityCheck({
    target: root,
    id: "TASK-REPORT",
    gate: "tests",
    status: "passed",
    source: "sensitive-local-evidence-reference",
    summary: "Tests passed"
  });
  const ledger = fs.readFileSync(
    path.join(root, ".ai-agent-kit", "runtime", "checks", "TASK-REPORT.jsonl"),
    "utf8"
  );
  assert.doesNotMatch(ledger, /sensitive-local-evidence-reference/);
  assert.match(ledger, /evidence_source_hash/);
});

test("invalid token counters are rejected instead of becoming zero or negative usage", () => {
  const root = makeRepo("invalid-usage");
  createReportTask(root);
  assert.throws(() => recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "openai",
    model: "gpt-5.6-terra",
    inputTokens: -1,
    outputTokens: 0
  }), /input tokens must be a non-negative safe integer/);
  assert.throws(() => recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "openai",
    model: "gpt-5.6-terra",
    inputTokens: 10,
    cachedInputTokens: 11,
    outputTokens: 0
  }), /cached input tokens cannot exceed input tokens/);
});

test("runtime ledgers refuse symbolic-link writes", () => {
  const root = makeRepo("symlink-ledger");
  createReportTask(root);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-report-outside-"));
  const usageDir = path.join(root, ".ai-agent-kit", "runtime", "usage");
  fs.symlinkSync(outside, usageDir, "dir");

  assert.throws(() => recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "openai",
    model: "gpt-5.6-terra",
    inputTokens: 10,
    outputTokens: 1
  }), /refusing runtime access through a symbolic link/);
  assert.equal(fs.readdirSync(outside).length, 0);
});

test("pricing registries cannot escape the repository and summaries reject secret-like data", () => {
  const root = makeRepo("privacy-boundaries");
  createReportTask(root);
  recordUsage({
    target: root,
    id: "TASK-REPORT",
    provider: "example",
    model: "model",
    inputTokens: 1,
    outputTokens: 1
  });
  const summary = summarizeUsage({
    target: root,
    id: "TASK-REPORT",
    registry: "../outside-pricing.json"
  });
  assert.equal(summary.cost.status, "UNAVAILABLE");
  assert.match(summary.cost.reason, /pricing_registry_error/);
  assert.throws(() => recordQualityCheck({
    target: root,
    id: "TASK-REPORT",
    gate: "tests",
    status: "failed",
    summary: "api_key=super-secret-value"
  }), /contains secret-like or personal data/);
  assert.throws(() => recordCriterionStatus({
    target: root,
    id: "TASK-REPORT",
    criterion: 1,
    status: "pending",
    summary: "Contact person@example.com"
  }), /contains secret-like or personal data/);
});
