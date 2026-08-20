import fs from "node:fs";
import path from "node:path";
import {
  PULSE_EXTRACTOR_VERSION,
  PULSE_GRAPH_VERSION,
  PULSE_METRIC_VERSION,
  PULSE_RESOLVER_VERSION,
  PULSE_SCHEMA_VERSION,
  canonicalJson,
  pulseDigest,
  safePulseId,
  validatePulseResult
} from "./pulse-contract.mjs";
import { getPackageVersion } from "./version.mjs";

const MAX_BASELINE_BYTES = 8 * 1024 * 1024;

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
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > MAX_BASELINE_BYTES) throw new Error(`${label} must be a bounded non-linked regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} contains invalid JSON`); }
}

function ciEnvironment() {
  return ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "JENKINS_URL", "TF_BUILD"].some((name) => {
    const value = process.env[name];
    return value && value !== "0" && value.toLowerCase() !== "false";
  });
}

export function createPulseBaseline(result, options = {}) {
  validatePulseResult(result);
  if (result.protocol !== "aak-architecture-pulse-v2") throw new Error("v1 Pulse evidence requires an explicit migration or a fresh v2 scan");
  const name = safePulseId(options.name ?? "default", "baseline name");
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) throw new Error("baseline created_at must be an ISO-compatible timestamp");
  const body = {
    schema_version: PULSE_SCHEMA_VERSION,
    protocol: "aak-architecture-pulse-baseline-v2",
    name,
    created_at: createdAt,
    repository: result.repository,
    source_digest: result.inventory.source_digest,
    analysis_config_digest: result.inventory.analysis_config_digest,
    policy_digest: result.inventory.policy_digest,
    compatibility: {
      graph_version: result.graph_version,
      metric_version: result.metric_version,
      extractor_version: result.extractor_version,
      resolver_version: result.resolver_version
    },
    provenance: {
      tool_version: result.tool_version,
      result_digest: result.result_digest,
      task_id: options.taskId ?? null,
      plan_id: options.planId ?? null,
      approval_reference: options.approvalReference ?? null
    },
    snapshot: {
      metrics: result.metrics,
      coverage: result.coverage,
      confidence: result.confidence,
      finding_catalog: result.finding_catalog.map((finding) => ({
        fingerprint: finding.fingerprint,
        type: finding.type,
        identity: finding.identity,
        title: finding.title,
        evidence_tier: finding.evidence_tier
      }))
    }
  };
  return { ...body, integrity: { algorithm: "SHA-256", digest: pulseDigest(body) } };
}

export function writePulseBaseline(baseline, options = {}) {
  if (ciEnvironment()) throw new Error("Architecture Pulse baselines cannot be created in CI");
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.output ?? `.ai-agent-kit/pulse/baselines/${baseline.name}.json`;
  const file = inside(root, requested, "baseline output");
  if (fs.existsSync(file)) throw new Error("Architecture Pulse baseline already exists; create a new reviewed baseline name instead of overwriting trusted history");
  const payload = `${JSON.stringify(baseline, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_BASELINE_BYTES) throw new Error("Architecture Pulse baseline exceeds the bounded artifact budget");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    created = true;
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    if (created && fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
    throw error;
  }
  return { status: "CREATED", baseline: path.relative(root, file).split(path.sep).join("/"), integrity: baseline.integrity, name: baseline.name };
}

export function readPulseBaseline(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.baseline ?? options.file ?? ".ai-agent-kit/pulse/baselines/default.json";
  const file = inside(root, requested, "baseline input");
  if (!fs.existsSync(file)) throw new Error("Architecture Pulse baseline is missing");
  return { baseline: boundedJson(file, "Architecture Pulse baseline"), file: path.relative(root, file).split(path.sep).join("/") };
}

function verifyShape(baseline) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(baseline.name ?? "")
    && Number.isFinite(Date.parse(baseline.created_at ?? ""))
    && /^[a-f0-9]{64}$/.test(baseline.repository?.identity_hash ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.source_digest ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.analysis_config_digest ?? "")
    && /^[a-f0-9]{64}$/.test(baseline.policy_digest ?? "")
    && baseline.snapshot && typeof baseline.snapshot === "object" && !Array.isArray(baseline.snapshot)
    && baseline.snapshot.metrics && baseline.snapshot.coverage && baseline.snapshot.confidence
    && Array.isArray(baseline.snapshot.finding_catalog);
}

export function verifyPulseBaseline(baseline, current = null) {
  if (baseline?.protocol === "aak-architecture-pulse-baseline-v1") {
    return { status: "STALE", reason_code: "BASELINE_MIGRATION_REQUIRED", reason: "v1 baseline cannot be compared silently with Architecture Pulse v2; inspect and create a reviewed v2 baseline" };
  }
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) || baseline.protocol !== "aak-architecture-pulse-baseline-v2" || baseline.schema_version !== PULSE_SCHEMA_VERSION) {
    return { status: "UNTRUSTED", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline contract is incompatible" };
  }
  const { integrity, ...body } = baseline;
  if (integrity?.algorithm !== "SHA-256" || !/^[a-f0-9]{64}$/.test(integrity?.digest ?? "") || pulseDigest(body) !== integrity.digest) {
    return { status: "UNTRUSTED", reason_code: "BASELINE_TAMPERED", reason: "baseline integrity verification failed" };
  }
  if (!verifyShape(baseline)) return { status: "UNTRUSTED", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline contract fields are invalid" };
  const expected = {
    graph_version: PULSE_GRAPH_VERSION,
    metric_version: PULSE_METRIC_VERSION,
    extractor_version: PULSE_EXTRACTOR_VERSION,
    resolver_version: PULSE_RESOLVER_VERSION
  };
  if (Object.entries(expected).some(([key, value]) => baseline.compatibility?.[key] !== value)) {
    return { status: "STALE", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline analyzer semantics are incompatible" };
  }
  if (current) {
    if (current.protocol !== "aak-architecture-pulse-v2") return { status: "STALE", reason_code: "BASELINE_INCOMPATIBLE", reason: "current result contract is incompatible" };
    if (baseline.repository.identity_hash !== current.repository.identity_hash) return { status: "UNTRUSTED", reason_code: "BASELINE_FOREIGN_REPOSITORY", reason: "baseline belongs to another repository" };
    if (Object.entries(baseline.compatibility).some(([key, value]) => value !== current[key])) return { status: "STALE", reason_code: "BASELINE_INCOMPATIBLE", reason: "baseline analyzer versions are incompatible" };
    if (baseline.analysis_config_digest !== current.inventory.analysis_config_digest) return { status: "STALE", reason_code: "BASELINE_ANALYSIS_CONFIG_DRIFT", reason: "baseline analysis configuration differs from the current scan" };
    if (current.analysis_status === "DEGRADED") return { status: "DEGRADED", reason_code: current.reason_codes?.[0] ?? "PARTIAL_COVERAGE", reason: "current Architecture Pulse evidence is degraded and cannot be compared safely" };
  }
  return {
    status: "VERIFIED",
    reason_code: current && baseline.source_digest !== current.inventory.source_digest ? "CURRENT_SOURCE_CHANGED" : "NO_COMPARABLE_CHANGE",
    reason: baseline.policy_digest === current?.inventory.policy_digest ? "baseline integrity and compatibility are verified" : "baseline is comparable; policy changed and is recorded separately",
    policy_drift: Boolean(current && baseline.policy_digest !== current.inventory.policy_digest),
    baseline_digest: integrity.digest
  };
}

export function inspectPulseBaseline(baseline) {
  const verification = verifyPulseBaseline(baseline, null);
  return {
    ...verification,
    protocol: baseline?.protocol ?? null,
    name: baseline?.name ?? null,
    created_at: baseline?.created_at ?? null,
    finding_count: baseline?.snapshot?.finding_catalog?.length ?? null,
    compatibility: baseline?.compatibility ?? null,
    tool_version_provenance: baseline?.provenance?.tool_version ?? baseline?.tool_version ?? null
  };
}

export function migratePulseBaseline(baseline, options = {}) {
  if (baseline?.protocol !== "aak-architecture-pulse-baseline-v1") return { status: "NOT_REQUIRED", reason: "baseline is not a v1 baseline", dry_run: true };
  const findings = [
    ...(baseline.snapshot?.findings?.cycles ?? []).map((nodes) => ({ type: "cycle", identity: { nodes: [...nodes].sort() } })),
    ...(baseline.snapshot?.findings?.boundaries ?? []).map((finding) => ({ type: "boundary", identity: { boundary: finding.boundary, from: finding.from, to: finding.to, reason: finding.reason } }))
  ];
  return {
    status: "REBASELINE_REQUIRED",
    reason: "v1 findings can be previewed but lack v2 resolver, evidence-tier, analysis-config, and stable catalog guarantees",
    dry_run: options.dryRun !== false,
    preview: {
      source_digest: baseline.source_digest ?? null,
      recoverable_findings: findings.length,
      proposed_fingerprints: findings.map((finding) => pulseFingerprintForMigration(finding))
    }
  };
}

function pulseFingerprintForMigration(finding) {
  return `${finding.type}:${pulseDigest({ kind: finding.type, identity: finding.identity })}`;
}

export function baselineCanonicalJson(baseline) {
  return canonicalJson(baseline);
}

export function currentPulseCompatibility() {
  return {
    schema_version: PULSE_SCHEMA_VERSION,
    graph_version: PULSE_GRAPH_VERSION,
    metric_version: PULSE_METRIC_VERSION,
    extractor_version: PULSE_EXTRACTOR_VERSION,
    resolver_version: PULSE_RESOLVER_VERSION,
    tool_version: getPackageVersion()
  };
}
