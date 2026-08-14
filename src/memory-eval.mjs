import fs from "node:fs";
import path from "node:path";

function finite(value, label, { min = 0 } = {}) {
  const number = Number(value); if (!Number.isFinite(number) || number < min) throw new Error(`${label} is invalid`); return number;
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function variance(values) { const average = mean(values); return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length; }
function ratio(numerator, denominator) { return denominator ? numerator / denominator : 0; }

export function evaluateMemoryFixture(options = {}) {
  const file = path.resolve(options.fixture ?? options.file ?? "");
  if (!fs.existsSync(file)) throw new Error("memory eval fixture is missing");
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("memory eval fixture must be a bounded regular file");
  let fixture; try { fixture = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("memory eval fixture contains invalid JSON"); }
  if (fixture.schema_version !== 1 || !Array.isArray(fixture.runs) || !fixture.runs.length || fixture.runs.length > 10_000) throw new Error("memory eval fixture contract is invalid");
  const runs = fixture.runs.map((run) => ({
    id: String(run.id),
    task_success: Boolean(run.task_success),
    selected: finite(run.selected, "selected count"),
    false_retrievals: finite(run.false_retrievals, "false retrieval count"),
    stale_candidates: finite(run.stale_candidates, "stale candidate count"),
    stale_rejected: finite(run.stale_rejected, "stale rejected count"),
    estimated_tokens: finite(run.estimated_tokens, "estimated token count"),
    latency_ms: finite(run.latency_ms, "latency"),
    concurrent_operations: finite(run.concurrent_operations, "concurrent operation count"),
    lost_updates: finite(run.lost_updates, "lost update count"),
    failures: finite(run.failures, "failure count")
  }));
  if (runs.some((run) => run.false_retrievals > run.selected || run.stale_rejected > run.stale_candidates || run.lost_updates > run.concurrent_operations)) throw new Error("memory eval fixture contains impossible counters");
  const totals = runs.reduce((sum, run) => ({
    selected: sum.selected + run.selected,
    false_retrievals: sum.false_retrievals + run.false_retrievals,
    stale_candidates: sum.stale_candidates + run.stale_candidates,
    stale_rejected: sum.stale_rejected + run.stale_rejected,
    concurrent_operations: sum.concurrent_operations + run.concurrent_operations,
    lost_updates: sum.lost_updates + run.lost_updates,
    failures: sum.failures + run.failures
  }), { selected: 0, false_retrievals: 0, stale_candidates: 0, stale_rejected: 0, concurrent_operations: 0, lost_updates: 0, failures: 0 });
  const metrics = {
    sample_size: runs.length,
    task_success_rate: ratio(runs.filter((run) => run.task_success).length, runs.length),
    false_retrieval_rate: ratio(totals.false_retrievals, totals.selected),
    stale_rejection_rate: ratio(totals.stale_rejected, totals.stale_candidates),
    mean_estimated_tokens: mean(runs.map((run) => run.estimated_tokens)),
    mean_latency_ms: mean(runs.map((run) => run.latency_ms)),
    latency_variance: variance(runs.map((run) => run.latency_ms)),
    concurrent_operations: totals.concurrent_operations,
    lost_updates: totals.lost_updates,
    failures: totals.failures
  };
  const thresholds = fixture.thresholds ?? {};
  const failures = [];
  if (metrics.task_success_rate < finite(thresholds.min_task_success_rate ?? 1, "minimum task success rate")) failures.push("TASK_SUCCESS_REGRESSION");
  if (metrics.false_retrieval_rate > finite(thresholds.max_false_retrieval_rate ?? 0, "maximum false retrieval rate")) failures.push("FALSE_RETRIEVAL_REGRESSION");
  if (metrics.stale_rejection_rate < finite(thresholds.min_stale_rejection_rate ?? 1, "minimum stale rejection rate")) failures.push("STALE_REJECTION_REGRESSION");
  if (metrics.mean_estimated_tokens > finite(thresholds.max_mean_estimated_tokens ?? 4000, "maximum mean token count")) failures.push("TOKEN_BUDGET_REGRESSION");
  if (metrics.mean_latency_ms > finite(thresholds.max_mean_latency_ms ?? 1000, "maximum mean latency")) failures.push("LATENCY_REGRESSION");
  if (metrics.lost_updates > finite(thresholds.max_lost_updates ?? 0, "maximum lost updates")) failures.push("LOST_UPDATE_REGRESSION");
  if (metrics.failures > finite(thresholds.max_failures ?? 0, "maximum failures")) failures.push("RELIABILITY_REGRESSION");
  return { schema_version: 1, status: failures.length ? "FAILED" : "PASSED", fixture_id: fixture.id, metrics, thresholds, failure_taxonomy: failures };
}
