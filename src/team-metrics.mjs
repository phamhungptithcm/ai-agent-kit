import { safeTeamId, teamControlDigest, teamTimestamp } from "./team-control-contract.mjs";

const METRIC_NAMES = new Set(["claim_latency_ms", "conflict_detection_ms", "stale_writer_rejections", "integration_wait_ms", "recovery_ms", "evidence_completeness"]);

export function buildTeamMetrics(events = [], options = {}) {
  if (!Array.isArray(events) || events.length > 100_000) throw new Error("team metric events must be a bounded array");
  const normalized = events.map((item) => {
    const name = String(item.name ?? ""); if (!METRIC_NAMES.has(name)) throw new Error("team metric name is invalid");
    const value = Number(item.value); if (!Number.isFinite(value) || value < 0) throw new Error("team metric value must be finite and non-negative");
    return { name, value, timestamp: teamTimestamp(item.timestamp), repository_id: safeTeamId(item.repository_id, "metric repository id"), task_class: safeTeamId(item.task_class ?? "default", "metric task class") };
  });
  const groups = Object.fromEntries([...METRIC_NAMES].sort().map((name) => {
    const values = normalized.filter((item) => item.name === name).map((item) => item.value).sort((a, b) => a - b);
    const percentile = (p) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
    return [name, { count: values.length, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, p50: percentile(0.5), p95: percentile(0.95), max: values.at(-1) ?? null }];
  }));
  return { schema_version: 1, privacy: "BOUNDED_DIMENSIONS_NO_CONTENT", window_start: options.windowStart ? teamTimestamp(options.windowStart) : normalized[0]?.timestamp ?? null, window_end: options.windowEnd ? teamTimestamp(options.windowEnd) : normalized.at(-1)?.timestamp ?? null, sample_size: normalized.length, metrics: groups, metrics_hash: teamControlDigest(groups) };
}

export function evaluateTeamSlos(report, targets = {}) {
  const checks = [];
  for (const [name, target] of Object.entries(targets)) {
    if (!METRIC_NAMES.has(name) || !Number.isFinite(target) || target < 0) throw new Error("team SLO target is invalid");
    const metric = report.metrics?.[name];
    checks.push({ name, target, observed_p95: metric?.p95 ?? null, status: !metric?.count ? "INSUFFICIENT_EVIDENCE" : metric.p95 <= target ? "MET" : "MISSED" });
  }
  return { schema_version: 1, status: checks.some((item) => item.status === "MISSED") ? "MISSED" : checks.some((item) => item.status === "INSUFFICIENT_EVIDENCE") ? "INSUFFICIENT_EVIDENCE" : "MET", checks, report_hash: report.metrics_hash ?? teamControlDigest(report) };
}
