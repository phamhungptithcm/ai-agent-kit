import crypto from "node:crypto";

export const PULSE_SCHEMA_VERSION = 1;
export const PULSE_METRIC_VERSION = "1.0.0";
export const PULSE_EXTRACTOR_VERSION = "1.0.0";
export const PULSE_STATUSES = new Set(["IMPROVED", "STABLE", "REGRESSED", "STALE", "UNTRUSTED", "DEGRADED"]);
export const PULSE_REASON_CODES = new Set([
  "COMPLETE",
  "PARTIAL_COVERAGE",
  "RESOURCE_LIMIT",
  "UNSUPPORTED_LANGUAGE",
  "PARSE_FAILURE",
  "LOW_CONFIDENCE",
  "BASELINE_MISSING",
  "BASELINE_TAMPERED",
  "BASELINE_FOREIGN_REPOSITORY",
  "BASELINE_INCOMPATIBLE",
  "BASELINE_CONFIG_DRIFT",
  "CURRENT_SOURCE_CHANGED",
  "RULE_REGRESSION",
  "NO_RULE_REGRESSION",
  "NO_COMPARABLE_CHANGE"
]);

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function pulseDigest(value) {
  const payload = Buffer.isBuffer(value) || typeof value === "string" ? value : canonicalJson(value);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function boundedText(value, label, maximum = 512) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximum) {
    throw new Error(`${label} must be a non-empty string no larger than ${maximum} bytes`);
  }
  return value.trim();
}

export function safePulseId(value, label = "pulse identifier") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value ?? "")) throw new Error(`${label} is invalid`);
  return value;
}

export function finiteMetric(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return Number(value.toFixed(6));
}

export function confidenceBand(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("confidence must be between 0 and 1");
  if (value >= 0.85) return "HIGH";
  if (value >= 0.6) return "MEDIUM";
  return "LOW";
}

export function assertPulseStatus(status) {
  if (!PULSE_STATUSES.has(status)) throw new Error(`unsupported Architecture Pulse status: ${status}`);
  return status;
}

export function validatePulseResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("pulse result must be an object");
  if (result.schema_version !== PULSE_SCHEMA_VERSION || result.protocol !== "aak-architecture-pulse-v1") throw new Error("pulse result contract is incompatible");
  if (result.metric_version !== PULSE_METRIC_VERSION || result.extractor_version !== PULSE_EXTRACTOR_VERSION) throw new Error("pulse result semantic version is incompatible");
  if (typeof result.tool_version !== "string" || !result.tool_version.trim() || !new Set(["COMPLETE", "DEGRADED"]).has(result.analysis_status)) throw new Error("pulse result analyzer identity is invalid");
  if (!Array.isArray(result.reason_codes) || !result.reason_codes.length || result.reason_codes.some((code) => !PULSE_REASON_CODES.has(code))) throw new Error("pulse result reason codes are invalid");
  if (!result.repository || typeof result.repository.available !== "boolean" || !/^[a-f0-9]{64}$/.test(result.repository.identity_hash ?? "") || !/^[a-f0-9]{64}$/.test(result.repository.worktree_digest ?? "")) throw new Error("pulse repository identity is invalid");
  if (!result.inventory || !/^[a-f0-9]{64}$/.test(result.inventory.source_digest ?? "") || !/^[a-f0-9]{64}$/.test(result.inventory.config_digest ?? "") || !new Set(["COMPLETE", "DEGRADED"]).has(result.inventory.status)) throw new Error("pulse inventory contract is invalid");
  if (!result.graph || !Array.isArray(result.graph.nodes) || !Array.isArray(result.graph.edges)) throw new Error("pulse graph contract is invalid");
  if (!result.metrics || typeof result.metrics !== "object" || !result.coverage || !result.confidence) throw new Error("pulse metrics require coverage and confidence");
  const integerMetrics = ["node_count", "edge_count", "cycle_count", "cyclic_node_count", "condensation_depth", "condensation_root_count", "boundary_violation_count", "maximum_blast_radius", "blast_radius_sample_size"];
  const decimalMetrics = ["average_module_cohesion", "hotspot_concentration", "average_blast_radius", "pulse_index"];
  if (integerMetrics.some((key) => !Number.isInteger(result.metrics[key]) || result.metrics[key] < 0) || decimalMetrics.some((key) => !Number.isFinite(result.metrics[key]) || result.metrics[key] < 0) || typeof result.metrics.blast_radius_complete !== "boolean") throw new Error("pulse metric values are invalid");
  if (result.metrics.average_module_cohesion > 1 || result.metrics.hotspot_concentration > 1 || result.metrics.pulse_index > 100 || result.metrics.node_count !== result.graph.nodes.length || result.metrics.edge_count !== result.graph.edges.length) throw new Error("pulse metric values are inconsistent with graph evidence");
  for (const key of ["files", "imports", "parse"]) if (!Number.isFinite(result.coverage[key]) || result.coverage[key] < 0 || result.coverage[key] > 1) throw new Error(`pulse ${key} coverage is invalid`);
  for (const key of ["analyzed_files", "discovered_files", "unresolved_imports", "unsupported_files"]) if (!Number.isInteger(result.coverage[key]) || result.coverage[key] < 0) throw new Error(`pulse coverage count ${key} is invalid`);
  if (result.coverage.analyzed_files !== result.metrics.node_count || result.metrics.blast_radius_sample_size > result.metrics.node_count) throw new Error("pulse coverage counts are inconsistent with graph evidence");
  if (confidenceBand(result.confidence.score) !== result.confidence.band) throw new Error("pulse confidence band does not match its score");
  if (!result.governance || typeof result.governance !== "object" || Array.isArray(result.governance)) throw new Error("pulse governance binding is invalid");
  for (const key of ["task_id", "plan_id", "approval_reference"]) if (result.governance[key] != null && typeof result.governance[key] !== "string") throw new Error(`pulse governance ${key} is invalid`);
  const { result_digest: claimed, ...body } = result;
  if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || pulseDigest(body) !== claimed) throw new Error("pulse result digest mismatch");
  return result;
}

export function finalizePulseResult(body) {
  const normalized = stableValue(body);
  return { ...normalized, result_digest: pulseDigest(normalized) };
}
