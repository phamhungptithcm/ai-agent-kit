import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

import { normalizePromptName, PROMPT_NAMES, renderNamedPrompt } from "../src/prompt-catalog.mjs";
import { compileContext } from "../src/context-compiler.mjs";
import { createTask } from "../src/governed-runtime.mjs";
import {
  applyPricingSnapshot,
  buildArchitectureArtifact,
  buildBenchmarkPlan,
  buildQuickArchitectureRequest,
  calculateSystemDesignModel,
  evaluateSystemDesignFixture,
  importBenchmarkResult,
  inspectArchitectureWorkspace,
  lookupArchitecturePricing,
  validateSystemDesignRequest,
  verifyArchitectureArtifact,
  writeArchitecturePack
} from "../src/system-design.mjs";
import { main, parseArchitectureArgs } from "../src/cli.mjs";

const script = path.resolve("assets/enterprise-ai-agent-os/.ai/skills-src/design-scalable-systems/scripts/capacity_cost_model.py");

function runModel(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-system-design-"));
  const input = path.join(root, "input.json");
  fs.writeFileSync(input, JSON.stringify(source));
  const result = spawnSync("python3", [script, input], { cwd: root, encoding: "utf8" });
  return { result, output: result.status === 0 ? JSON.parse(result.stdout) : null };
}

test("capacity model separates concurrency math from benchmark-backed replicas", () => {
  const { result, output } = runModel({
    schema_version: 1,
    workload: { average_rps: 100000, peak_rps: 1000000, average_service_time_ms: 100 },
    capacity: { tested_safe_rps_per_replica: null, headroom_factor: 1.25, minimum_replicas: 3 },
    cost_items: []
  });
  assert.equal(result.status, 0);
  assert.equal(output.capacity.peak_inflight_requests, 100000);
  assert.equal(output.capacity.monthly_requests, 259200000000);
  assert.equal(output.capacity.required_replicas, null);
  assert.equal(output.capacity.replica_status, "UNAVAILABLE");
  assert.equal(output.cost.status, "UNAVAILABLE");
  assert.match(output.model_hash, /^[a-f0-9]{64}$/);
});

test("capacity model calculates evidenced headroom and partial cost without false zero", () => {
  const { output } = runModel({
    schema_version: 1,
    workload: { peak_rps: 1000000, request_bytes: 500, response_bytes: 1500 },
    capacity: { tested_safe_rps_per_replica: 10000, headroom_factor: 1.25, minimum_replicas: 3 },
    cost_items: [
      { name: "compute", monthly_quantity: 10, unit_price: 100, currency: "USD" },
      { name: "egress", monthly_quantity: null, unit_price: null, currency: "USD" }
    ]
  });
  assert.equal(output.capacity.required_replicas, 125);
  assert.equal(output.capacity.peak_ingress_bytes_per_second, 500000000);
  assert.equal(output.capacity.peak_egress_bytes_per_second, 1500000000);
  assert.equal(output.cost.status, "PARTIAL");
  assert.equal(output.cost.monthly_totals.USD, 1000);
});

test("capacity model rejects contradictory or unsafe numeric input", () => {
  const contradiction = runModel({ schema_version: 1, workload: { average_rps: 20, peak_rps: 10 }, capacity: {}, cost_items: [] });
  assert.notEqual(contradiction.result.status, 0);
  assert.match(contradiction.result.stderr, /average_rps cannot exceed peak_rps/);
  const negative = runModel({ schema_version: 1, workload: { peak_rps: -1 }, capacity: {}, cost_items: [] });
  assert.notEqual(negative.result.status, 0);
  assert.match(negative.result.stderr, /finite non-negative/);
});

test("system design prompt is discoverable with natural aliases and guarded output", () => {
  assert.ok(PROMPT_NAMES.includes("design-system"));
  assert.equal(normalizePromptName("system-design"), "design-system");
  assert.equal(normalizePromptName("capacity-plan"), "design-system");
  const prompt = renderNamedPrompt("design-system");
  assert.match(prompt, /design-scalable-systems/);
  assert.match(prompt, /Never invent per-instance throughput/);
  assert.match(prompt, /READY_FOR_REVIEW/);
});

test("natural scale and cost intent automatically selects system design context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-system-context-"));
  fs.cpSync(path.resolve("assets/enterprise-ai-agent-os/.ai"), path.join(root, ".ai"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "system-design@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "System Design"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", ".ai", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "system design fixture"], { cwd: root });
  createTask({ target: root, id: "ARCH-1", goal: "Design API architecture for one million RPS, p99 latency, highest security, and low cloud cost" });
  const { pack } = compileContext({ target: root, id: "ARCH-1", budget: 30000 });
  const paths = new Set(pack.items.map((item) => item.path));
  assert.ok(paths.has(".ai/skills-src/design-scalable-systems/SKILL.md"));
  assert.ok(paths.has(".ai/quality-profiles/system-design.yaml"));
  assert.ok(paths.has(".ai/rules/system-design-integrity.md"));
});

function request(overrides = {}) {
  const { workload = {}, service_levels = {}, cost = {}, ...rest } = overrides;
  return { schema_version: 1, id: "ARCH-TEST", goal: "Design a measured API", stage: "target", ...rest, workload: { average_rps: 100, peak_rps: 500, burst_rps: 800, burst_duration_seconds: 10, average_service_time_ms: 200, response_bytes: 1000, retry_rate: 0.02, ...workload }, service_levels: { latency_scope: "end_to_end", latency_percentile: "p99", latency_target_ms: 900, availability_percent: 99.9, ...service_levels }, cost: { provider: "azure", regions: ["eastus"], currency: "USD", ...cost } };
}

test("runtime validator and model preserve provenance and uncertainty", () => {
  const normalized = validateSystemDesignRequest(request());
  assert.equal(normalized.status, "READY_FOR_REVIEW");
  assert.equal(normalized.workload.peak_rps.source, "USER_PROVIDED");
  const model = calculateSystemDesignModel(normalized, { tested_safe_rps_per_replica: 100, headroom_factor: 1.25, zone_failure_reserve_factor: 1.5 });
  assert.equal(model.capacity.required_replicas, 10);
  assert.equal(model.traffic.burst_queue_items, 3000);
  assert.match(model.model_hash, /^[a-f0-9]{64}$/);
  const unknown = calculateSystemDesignModel(validateSystemDesignRequest(request({ workload: { average_service_time_ms: undefined } })));
  assert.equal(unknown.capacity.status, "UNAVAILABLE");
  const costed = calculateSystemDesignModel(validateSystemDesignRequest(request({ cost: { items: [{ name: "compute", monthly_quantity: 10, unit_price: 20, currency: "USD", source: "ASSUMED" }, { name: "egress", monthly_quantity: null, unit_price: null, currency: "USD" }] } })));
  assert.equal(costed.cost.status, "PARTIAL");
  assert.equal(costed.cost.monthly_totals.USD, 200);
});

test("pricing adapters normalize live data, redact keys, and verify cached hashes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-pricing-"));
  let calls = 0;
  const fetch = async (url) => { calls += 1; assert.doesNotMatch(url, /secret-key/); return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ Items: [{ armSkuName: "D2", productName: "VM", unitOfMeasure: "1 Hour", retailPrice: 0.2, effectiveStartDate: "2026-01-01", type: "Consumption" }] }) }; };
  const options = { target: root, provider: "azure", region: "eastus", service: "Virtual Machines", currency: "USD" };
  const live = await lookupArchitecturePricing(options, { fetch, now: new Date("2026-01-02T00:00:00Z") });
  assert.equal(live.status, "LIVE_ESTIMATE");
  assert.equal(live.items[0].unit_price, 0.2);
  const pricedRequest = applyPricingSnapshot(request(), live, { monthlyQuantity: 100 });
  assert.equal(calculateSystemDesignModel(pricedRequest).cost.monthly_totals.USD, 20);
  const normalizedPricedRequest = applyPricingSnapshot(validateSystemDesignRequest(request()), live, { monthlyQuantity: 100 });
  assert.equal(calculateSystemDesignModel(normalizedPricedRequest).cost.monthly_totals.USD, 20);
  assert.throws(() => applyPricingSnapshot(request(), { ...live, snapshot_hash: "a".repeat(64) }, { monthlyQuantity: 100 }), /hash mismatch/);
  const cached = await lookupArchitecturePricing(options, { fetch, now: new Date("2026-01-02T01:00:00Z") });
  assert.equal(cached.status, "REVIEWED_SNAPSHOT");
  assert.equal(calls, 1);
  assert.match(fs.readFileSync(path.join(root, ".ai-agent-kit/.gitignore"), "utf8"), /architecture\//);
  const unavailable = await lookupArchitecturePricing({ target: root, provider: "gcp", region: "us-central1", service: "service-id" });
  assert.equal(unavailable.status, "UNAVAILABLE");
});

test("benchmark evidence must bind to the normalized request", () => {
  const normalized = validateSystemDesignRequest(request());
  const plan = buildBenchmarkPlan(normalized);
  const result = importBenchmarkResult({ schema_version: 1, request_hash: normalized.request_hash, plan_hash: plan.plan_hash, environment: "staging", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:10:00Z", metrics: { throughput_rps: 400, p99_ms: 700, success_rate: 0.999 }, evidence: [{ hash: "a".repeat(64) }] }, normalized);
  assert.equal(result.status, "ACCEPTED");
  assert.throws(() => importBenchmarkResult({ ...result, request_hash: "b".repeat(64) }, normalized), /does not match/);
});

test("architecture artifacts detect tampering, staleness, and escape visual content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-architecture-"));
  const artifact = buildArchitectureArtifact({ id: "ARCH-TEST", request: request(), recommendation: { title: "Measured API", summary: "Start simple <script>alert(1)</script>" }, components: [{ name: "API", responsibility: "Serve" }], decisions: [{ id: "D1" }], traceability: [{ constraint: "p99", decision: "D1", validation: "load test", sli: "latency" }], validation_plan: ["benchmark"] }, { repositoryCommit: "abc", generatedAt: "2026-01-01T00:00:00Z" });
  assert.equal(verifyArchitectureArtifact(artifact, { repositoryCommit: "abc" }).status, "VERIFIED");
  assert.equal(verifyArchitectureArtifact(artifact, { repositoryCommit: "def" }).status, "STALE");
  const tampered = structuredClone(artifact); tampered.components[0].name = "Changed";
  assert.equal(verifyArchitectureArtifact(tampered).status, "REJECTED");
  const pack = writeArchitecturePack({ artifact, target: root });
  const html = fs.readFileSync(pack.files.html, "utf8");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("executable system-design eval rejects unsupported production claims", () => {
  const pass = JSON.parse(fs.readFileSync("assets/enterprise-ai-agent-os/.ai/evals/e2e/system-design-pass.json", "utf8"));
  const fail = JSON.parse(fs.readFileSync("assets/enterprise-ai-agent-os/.ai/evals/e2e/system-design-fail.json", "utf8"));
  assert.equal(evaluateSystemDesignFixture(pass).status, "PASSED");
  assert.equal(evaluateSystemDesignFixture(fail).status, "FAILED");
});

test("architecture CLI validates flags and returns nonzero for failed eval", async () => {
  assert.throws(() => parseArchitectureArgs(["pricing", "--provider", "aws"]), /requires --region/);
  const logs = [];
  const code = await main(["architecture", "eval", "--fixture", "assets/enterprise-ai-agent-os/.ai/evals/e2e/system-design-fail.json"], { log: (value) => logs.push(value) });
  assert.equal(code, 1);
  assert.match(logs[0], /PRODUCTION_READY|FAILED/);
  const processResult = spawnSync(process.execPath, ["bin/ai-agent-kit.mjs", "architecture", "eval", "--fixture", "assets/enterprise-ai-agent-os/.ai/evals/e2e/system-design-fail.json"], { encoding: "utf8" });
  assert.equal(processResult.status, 1);
  assert.match(processResult.stdout, /"status": "FAILED"/);
});

test("quick start turns natural constraints into a saved guided contract", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-quick-architecture-"));
  const quick = buildQuickArchitectureRequest({ goal: "Scale a secure API", peakRps: 10000, latencyMs: 800, provider: "aws", region: "us-east-1", budget: 5000 });
  assert.equal(quick.request.workload.peak_rps.value, 10000);
  assert.equal(quick.questions.length, 0);
  const logs = [];
  const code = await main(["architecture", "start", "--target", root, "--goal", "Scale a secure API", "--peak-rps", "10000", "--latency-ms", "800", "--provider", "aws", "--region", "us-east-1", "--budget", "5000"], { log: (value) => logs.push(value) });
  assert.equal(code, 0);
  const result = JSON.parse(logs[0]);
  assert.ok(fs.existsSync(result.request_file));
  assert.match(fs.readFileSync(path.join(root, ".ai-agent-kit/.gitignore"), "utf8"), /architecture\//);
  assert.equal(inspectArchitectureWorkspace({ target: root }).status, "EMPTY");
});
