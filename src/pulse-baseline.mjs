import fs from "node:fs";
import path from "node:path";
import { PULSE_EXTRACTOR_VERSION, PULSE_METRIC_VERSION, PULSE_SCHEMA_VERSION, canonicalJson, pulseDigest, safePulseId, validatePulseResult } from "./pulse-contract.mjs";
import { getPackageVersion } from "./version.mjs";

function inside(root, requested, label) {
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the repository`);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link`);
  }
  return absolute;
}

function boundedJson(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 8 * 1024 * 1024) throw new Error(`${label} must be a bounded non-linked regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} contains invalid JSON`); }
}

export function createPulseBaseline(result, options = {}) {
  validatePulseResult(result);
  const name = safePulseId(options.name ?? "default", "baseline name");
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) throw new Error("baseline created_at must be an ISO-compatible timestamp");
  const body = {
    schema_version: PULSE_SCHEMA_VERSION,
    protocol: "aak-architecture-pulse-baseline-v1",
    name,
    created_at: createdAt,
    repository: result.repository,
    source_digest: result.inventory.source_digest,
    config_digest: result.inventory.config_digest,
    metric_version: result.metric_version,
    extractor_version: result.extractor_version,
    tool_version: result.tool_version,
    result_digest: result.result_digest,
    snapshot: {
      metrics: result.metrics,
      coverage: result.coverage,
      confidence: result.confidence,
      findings: {
        cycles: result.findings.cycles,
        boundaries: result.findings.boundaries
      }
    },
    provenance: {
      task_id: options.taskId ?? null,
      plan_id: options.planId ?? null,
      approval_reference: options.approvalReference ?? null
    }
  };
  return { ...body, integrity: { algorithm: "SHA-256", digest: pulseDigest(body) } };
}

export function writePulseBaseline(baseline, options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.output ?? `.ai-agent-kit/pulse/baselines/${baseline.name}.json`;
  const file = inside(root, requested, "baseline output");
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error("baseline output must be a non-linked regular file");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
  return { status: "CREATED", baseline: path.relative(root, file).split(path.sep).join("/"), integrity: baseline.integrity, name: baseline.name };
}

export function readPulseBaseline(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.baseline ?? options.file ?? ".ai-agent-kit/pulse/baselines/default.json";
  const file = inside(root, requested, "baseline input");
  if (!fs.existsSync(file)) throw new Error("Architecture Pulse baseline is missing");
  return { baseline: boundedJson(file, "Architecture Pulse baseline"), file: path.relative(root, file).split(path.sep).join("/") };
}

export function verifyPulseBaseline(baseline, current = null) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) || baseline.protocol !== "aak-architecture-pulse-baseline-v1" || baseline.schema_version !== PULSE_SCHEMA_VERSION) {
    return { status: "UNTRUSTED", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline contract is incompatible" };
  }
  const { integrity, ...body } = baseline;
  if (integrity?.algorithm !== "SHA-256" || !/^[a-f0-9]{64}$/.test(integrity?.digest ?? "") || pulseDigest(body) !== integrity.digest) {
    return { status: "UNTRUSTED", reason_code: "BASELINE_TAMPERED", reason: "baseline integrity verification failed" };
  }
  const compatibleShape = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(baseline.name ?? "")
    && Number.isFinite(Date.parse(baseline.created_at ?? ""))
    && /^[a-f0-9]{64}$/.test(baseline.repository?.identity_hash ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.source_digest ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.config_digest ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.result_digest ?? "")
    && baseline.snapshot && typeof baseline.snapshot === "object" && !Array.isArray(baseline.snapshot)
    && baseline.snapshot.metrics && typeof baseline.snapshot.metrics === "object"
    && baseline.snapshot.coverage && typeof baseline.snapshot.coverage === "object"
    && baseline.snapshot.confidence && typeof baseline.snapshot.confidence === "object";
  if (!compatibleShape) return { status: "UNTRUSTED", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline contract fields are invalid" };
  if (baseline.metric_version !== PULSE_METRIC_VERSION || baseline.extractor_version !== PULSE_EXTRACTOR_VERSION || baseline.tool_version !== getPackageVersion()) return { status: "STALE", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline analyzer semantics are incompatible" };
  if (current) {
    if (baseline.repository?.identity_hash !== current.repository?.identity_hash) return { status: "UNTRUSTED", reason_code: "BASELINE_FOREIGN_REPOSITORY", reason: "baseline belongs to another repository" };
    if (baseline.metric_version !== current.metric_version || baseline.extractor_version !== current.extractor_version || baseline.tool_version !== current.tool_version) return { status: "STALE", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline analyzer versions are incompatible" };
    if (baseline.config_digest !== current.inventory?.config_digest) return { status: "STALE", reason_code: "BASELINE_CONFIG_DRIFT", reason: "baseline configuration differs from the current scan" };
    if (current.analysis_status === "DEGRADED") return { status: "DEGRADED", reason_code: current.reason_codes?.[0] ?? "PARTIAL_COVERAGE", reason: "current Architecture Pulse evidence is degraded and cannot be compared safely" };
  }
  return { status: "VERIFIED", reason_code: current && baseline.source_digest !== current.inventory.source_digest ? "CURRENT_SOURCE_CHANGED" : "NO_COMPARABLE_CHANGE", reason: "baseline integrity and compatibility are verified", baseline_digest: integrity.digest };
}

export function baselineCanonicalJson(baseline) {
  return canonicalJson(baseline);
}
