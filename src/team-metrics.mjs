import { safeTeamId, teamControlDigest, teamTimestamp } from "./team-control-contract.mjs";
import { withTeamControlStore } from "./team-control-store.mjs";

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

export function buildTeamMetricsFromLedger(options = {}) {
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    const taskClass = safeTeamId(options.taskClass ?? "default", "metric task class");
    const metricEvents = [];
    const firstBy = (type, key, value) => snapshot.events.find((event) => event.type === type && event[key] === value);
    for (const claim of snapshot.claims) {
      const registered = firstBy("TASK_REGISTERED", "task_id", claim.task_id);
      const acquired = firstBy("CLAIM_ACQUIRED", "claim_id", claim.claim_id);
      if (registered && acquired) metricEvents.push({ name: "claim_latency_ms", value: Math.max(0, Date.parse(acquired.timestamp) - Date.parse(registered.timestamp)), timestamp: acquired.timestamp, repository_id: snapshot.repository_id, task_class: taskClass });
      if (["REVOKED", "ADMITTED", "REJECTED"].includes(claim.status) && claim.expired_at) metricEvents.push({ name: "stale_writer_rejections", value: 1, timestamp: claim.released_at ?? claim.expired_at, repository_id: snapshot.repository_id, task_class: taskClass });
      if (claim.takeover_of) {
        const prior = snapshot.claims.find((item) => item.claim_id === claim.takeover_of);
        if (prior?.expired_at) metricEvents.push({ name: "recovery_ms", value: Math.max(0, Date.parse(claim.claimed_at) - Date.parse(prior.expired_at)), timestamp: claim.claimed_at, repository_id: snapshot.repository_id, task_class: taskClass });
      }
    }
    for (const packageValue of snapshot.packages) {
      if (packageValue.enqueued_at && packageValue.admitted_at) metricEvents.push({ name: "integration_wait_ms", value: Math.max(0, Date.parse(packageValue.admitted_at) - Date.parse(packageValue.enqueued_at)), timestamp: packageValue.admitted_at, repository_id: snapshot.repository_id, task_class: taskClass });
      const required = Math.max(1, packageValue.evidence_hashes?.length ?? 0);
      const acceptedReview = snapshot.reviews.some((review) => review.package_id === packageValue.package_id && review.status === "ACCEPTED");
      metricEvents.push({ name: "evidence_completeness", value: Math.min(1, ((packageValue.evidence_hashes?.length ?? 0) + (acceptedReview ? 1 : 0)) / (required + 1)), timestamp: packageValue.admitted_at ?? packageValue.enqueued_at, repository_id: snapshot.repository_id, task_class: taskClass });
    }
    const report = buildTeamMetrics(metricEvents, options);
    return { ...report, source: "TRANSACTIONAL_TEAM_CONTROL_LEDGER", repository_revision: snapshot.revision, event_head: snapshot.events.at(-1)?.event_hash ?? null };
  });
}
