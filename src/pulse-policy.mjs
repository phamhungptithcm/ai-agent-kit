import { assertPulseStatus, finiteMetric, safePulseId } from "./pulse-contract.mjs";

const DEFAULT_RULES = [
  { id: "cycles", type: "new-cycles", threshold: 0, severity: "warning" },
  { id: "boundaries", type: "boundary-violations", threshold: 0, severity: "warning" },
  { id: "depth", type: "depth-increase", threshold: 0, severity: "warning" },
  { id: "cohesion", type: "cohesion-loss", threshold: 0, severity: "warning" },
  { id: "hotspots", type: "hotspot-growth", threshold: 0, severity: "warning" },
  { id: "blast-radius", type: "blast-radius-growth", threshold: 0, severity: "warning" },
  { id: "coverage", type: "coverage-drop", threshold: 0.05, severity: "warning" },
  { id: "confidence", type: "confidence-drop", threshold: 0.05, severity: "warning" }
];
const TYPES = new Set(DEFAULT_RULES.map((rule) => rule.type));
const SEVERITIES = new Set(["info", "warning", "block"]);

function ruleDelta(type, baseline, current) {
  if (type === "new-cycles") return current.metrics.cycle_count - baseline.snapshot.metrics.cycle_count;
  if (type === "boundary-violations") return current.metrics.boundary_violation_count - baseline.snapshot.metrics.boundary_violation_count;
  if (type === "depth-increase") return current.metrics.condensation_depth - baseline.snapshot.metrics.condensation_depth;
  if (type === "cohesion-loss") return baseline.snapshot.metrics.average_module_cohesion - current.metrics.average_module_cohesion;
  if (type === "hotspot-growth") return current.metrics.hotspot_concentration - baseline.snapshot.metrics.hotspot_concentration;
  if (type === "blast-radius-growth") return current.metrics.maximum_blast_radius - baseline.snapshot.metrics.maximum_blast_radius;
  if (type === "coverage-drop") return baseline.snapshot.coverage.files - current.coverage.files;
  return baseline.snapshot.confidence.score - current.confidence.score;
}

function normalizedRules(rules) {
  const source = rules?.length ? rules : DEFAULT_RULES;
  return source.map((rule) => {
    const id = safePulseId(rule.id, "pulse rule id");
    if (!TYPES.has(rule.type)) throw new Error(`unsupported pulse rule type: ${rule.type}`);
    const threshold = Number(rule.threshold ?? 0);
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`pulse rule ${id} threshold must be non-negative`);
    const severity = rule.severity ?? "warning";
    if (!SEVERITIES.has(severity)) throw new Error(`pulse rule ${id} severity is invalid`);
    return { id, type: rule.type, threshold, severity };
  });
}

export function evaluatePulsePolicy({ baseline, current, verification, rules }) {
  if (verification.status !== "VERIFIED") return { schema_version: 1, status: assertPulseStatus(verification.status), reason_code: verification.reason_code, reason: verification.reason, blocking: false, findings: [] };
  const findings = normalizedRules(rules).map((rule) => {
    const delta = finiteMetric(ruleDelta(rule.type, baseline, current), `${rule.id} delta`);
    return { ...rule, delta, violated: delta > rule.threshold, blocking: delta > rule.threshold && rule.severity === "block" };
  });
  const violated = findings.filter((finding) => finding.violated);
  const improvements = findings.filter((finding) => finding.delta < -finding.threshold);
  const status = violated.length ? "REGRESSED" : improvements.length ? "IMPROVED" : "STABLE";
  return {
    schema_version: 1,
    status: assertPulseStatus(status),
    reason_code: violated.length ? "RULE_REGRESSION" : improvements.length ? "NO_RULE_REGRESSION" : "NO_COMPARABLE_CHANGE",
    reason: violated.length ? `${violated.length} configured structural rule(s) regressed` : improvements.length ? `${improvements.length} configured structural signal(s) improved` : "no configured structural rule changed materially",
    blocking: findings.some((finding) => finding.blocking),
    baseline_digest: verification.baseline_digest,
    current_result_digest: current.result_digest,
    findings
  };
}

export function pulseExitCode(result) {
  if (["STALE", "UNTRUSTED", "DEGRADED"].includes(result.status)) return 3;
  if (result.blocking) return 2;
  return 0;
}
