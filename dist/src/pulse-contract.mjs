import crypto from "node:crypto";

export const PULSE_SCHEMA_VERSION = 2;
export const PULSE_GRAPH_VERSION = "2.0.0";
export const PULSE_METRIC_VERSION = "2.0.0";
export const PULSE_EXTRACTOR_VERSION = "2.0.0";
export const PULSE_RESOLVER_VERSION = "2.0.0";
export const PULSE_STATUSES = new Set(["IMPROVED", "STABLE", "REGRESSED", "STALE", "UNTRUSTED", "DEGRADED"]);
export const PULSE_EVIDENCE_TIERS = new Set(["SOURCE_FALLBACK", "AST_VERIFIED", "RESOLVER_VERIFIED", "INDEX_VERIFIED", "EXPLICIT_MANIFEST"]);
export const PULSE_FINDING_STATES = new Set(["new", "unchanged", "updated", "fixed"]);
export const PULSE_REASON_CODES = new Set([
  "COMPLETE",
  "PARTIAL_COVERAGE",
  "RESOURCE_LIMIT",
  "UNSUPPORTED_LANGUAGE",
  "PARSE_FAILURE",
  "RESOLUTION_GAP",
  "AMBIGUOUS_IMPORT",
  "OPTIONAL_RESOLVER_UNAVAILABLE",
  "LOW_CONFIDENCE",
  "BASELINE_MISSING",
  "BASELINE_TAMPERED",
  "BASELINE_FOREIGN_REPOSITORY",
  "BASELINE_INCOMPATIBLE",
  "BASELINE_MIGRATION_REQUIRED",
  "BASELINE_ANALYSIS_CONFIG_DRIFT",
  "BASELINE_POLICY_DRIFT",
  "CURRENT_SOURCE_CHANGED",
  "RULE_REGRESSION",
  "NO_RULE_REGRESSION",
  "NO_COMPARABLE_CHANGE",
  "WAIVER_INVALID",
  "WAIVER_EXPIRED",
  "ARTIFACT_BUDGET",
  "CACHE_NON_AUTHORITATIVE",
  "DEADLINE_EXCEEDED"
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

export function pulseFingerprint(kind, identity) {
  return `${kind}:${pulseDigest({ kind, identity })}`;
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

function digest(value) {
  return /^[a-f0-9]{64}$/.test(value ?? "");
}

function validateLegacyPulseResult(result) {
  if (result.schema_version !== 1 || result.protocol !== "aak-architecture-pulse-v1") throw new Error("pulse result contract is incompatible");
  if (!result.repository || !digest(result.repository.identity_hash) || !digest(result.repository.worktree_digest)) throw new Error("pulse repository identity is invalid");
  if (!result.inventory || !digest(result.inventory.source_digest) || !digest(result.inventory.config_digest)) throw new Error("pulse inventory contract is invalid");
  if (!result.graph || !Array.isArray(result.graph.nodes) || !Array.isArray(result.graph.edges)) throw new Error("pulse graph contract is invalid");
  const { result_digest: claimed, ...body } = result;
  if (!digest(claimed) || pulseDigest(body) !== claimed) throw new Error("pulse result digest mismatch");
  return result;
}

function validateCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") throw new Error("pulse coverage is required");
  for (const key of ["files", "imports", "parse", "supported_scope"]) {
    if (!Number.isFinite(coverage[key]) || coverage[key] < 0 || coverage[key] > 1) throw new Error(`pulse ${key} coverage is invalid`);
  }
  for (const key of ["analyzed_files", "discovered_files", "supported_in_scope", "unsupported_in_scope", "excluded_by_policy", "external_declared", "unresolved_internal", "ambiguous", "parse_failed"]) {
    if (!Number.isInteger(coverage[key]) || coverage[key] < 0) throw new Error(`pulse coverage count ${key} is invalid`);
  }
}

export function validatePulseResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("pulse result must be an object");
  if (result.protocol === "aak-architecture-pulse-v1") return validateLegacyPulseResult(result);
  if (result.schema_version !== PULSE_SCHEMA_VERSION || result.protocol !== "aak-architecture-pulse-v2") throw new Error("pulse result contract is incompatible");
  if (result.graph_version !== PULSE_GRAPH_VERSION || result.metric_version !== PULSE_METRIC_VERSION || result.extractor_version !== PULSE_EXTRACTOR_VERSION || result.resolver_version !== PULSE_RESOLVER_VERSION) throw new Error("pulse result semantic version is incompatible");
  if (typeof result.tool_version !== "string" || !result.tool_version.trim() || !new Set(["COMPLETE", "DEGRADED"]).has(result.analysis_status)) throw new Error("pulse result analyzer identity is invalid");
  if (!Array.isArray(result.reason_codes) || !result.reason_codes.length || result.reason_codes.some((code) => !PULSE_REASON_CODES.has(code))) throw new Error("pulse result reason codes are invalid");
  if (!result.repository || typeof result.repository.available !== "boolean" || !digest(result.repository.identity_hash) || !digest(result.repository.worktree_digest)) throw new Error("pulse repository identity is invalid");
  if (!result.inventory || !digest(result.inventory.source_digest) || !digest(result.inventory.analysis_config_digest) || !digest(result.inventory.policy_digest) || !new Set(["COMPLETE", "DEGRADED"]).has(result.inventory.status)) throw new Error("pulse inventory contract is invalid");
  if (!result.graph || !new Set(["inline", "external"]).has(result.graph.storage) || !digest(result.graph.graph_digest)) throw new Error("pulse graph contract is invalid");
  if (result.graph.storage === "inline" && (!Array.isArray(result.graph.nodes) || !Array.isArray(result.graph.edges))) throw new Error("inline pulse graph evidence is invalid");
  if (result.graph.storage === "external" && !Array.isArray(result.graph.artifacts)) throw new Error("external pulse graph manifest is invalid");
  if (!result.metrics || typeof result.metrics !== "object" || !result.confidence) throw new Error("pulse metrics require coverage and confidence");
  const integerMetrics = ["node_count", "edge_count", "cycle_count", "cyclic_node_count", "condensation_depth", "condensation_root_count", "boundary_violation_count", "maximum_blast_radius", "blast_radius_sample_size"];
  const decimalMetrics = ["average_module_cohesion", "hotspot_concentration", "average_blast_radius", "pulse_index"];
  if (integerMetrics.some((key) => !Number.isInteger(result.metrics[key]) || result.metrics[key] < 0) || decimalMetrics.some((key) => !Number.isFinite(result.metrics[key]) || result.metrics[key] < 0) || typeof result.metrics.blast_radius_complete !== "boolean") throw new Error("pulse metric values are invalid");
  if (result.metrics.average_module_cohesion > 1 || result.metrics.hotspot_concentration > 1 || result.metrics.pulse_index > 100) throw new Error("pulse metric values are outside their ranges");
  if (result.graph.storage === "inline" && (result.metrics.node_count !== result.graph.nodes.length || result.metrics.edge_count !== result.graph.edges.length)) throw new Error("pulse metric values are inconsistent with graph evidence");
  validateCoverage(result.coverage);
  if (result.coverage.analyzed_files !== result.metrics.node_count || result.metrics.blast_radius_sample_size > result.metrics.node_count) throw new Error("pulse coverage counts are inconsistent with graph evidence");
  if (confidenceBand(result.confidence.score) !== result.confidence.band || !PULSE_EVIDENCE_TIERS.has(result.confidence.minimum_evidence_tier)) throw new Error("pulse confidence contract is invalid");
  if (!Array.isArray(result.finding_catalog) || result.finding_catalog.some((finding) => !digest(String(finding.fingerprint ?? "").split(":").at(-1)))) throw new Error("pulse finding catalog is invalid");
  if (result.cache?.authoritative !== false || typeof result.cache?.used !== "boolean" || (result.cache.used && (result.analysis_status !== "DEGRADED" || !result.reason_codes.includes("CACHE_NON_AUTHORITATIVE")))) throw new Error("pulse cache authority contract is invalid");
  if (!result.governance || typeof result.governance !== "object" || Array.isArray(result.governance)) throw new Error("pulse governance binding is invalid");
  for (const key of ["task_id", "plan_id", "approval_reference"]) if (result.governance[key] != null && typeof result.governance[key] !== "string") throw new Error(`pulse governance ${key} is invalid`);
  const { result_digest: claimed, ...body } = result;
  if (!digest(claimed) || pulseDigest(body) !== claimed) throw new Error("pulse result digest mismatch");
  return result;
}

export function finalizePulseResult(body) {
  const normalized = stableValue(body);
  return { ...normalized, result_digest: pulseDigest(normalized) };
}
