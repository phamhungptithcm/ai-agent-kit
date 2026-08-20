import fs from "node:fs";
import path from "node:path";
import {
  PULSE_EXTRACTOR_VERSION,
  PULSE_GRAPH_VERSION,
  PULSE_METRIC_VERSION,
  PULSE_RESOLVER_VERSION,
  PULSE_SCHEMA_VERSION,
  finalizePulseResult,
  pulseDigest,
  validatePulseResult
} from "./pulse-contract.mjs";
import { createPulseDeadline, currentPulseRepositoryState, scanRepository, validatePulseConfig } from "./pulse-scanner.mjs";
import { extractDependencies } from "./pulse-extractors.mjs";
import { buildPulseGraph } from "./pulse-graph.mjs";
import {
  createPulseBaseline,
  inspectPulseBaseline,
  migratePulseBaseline,
  readPulseBaseline,
  verifyPulseBaseline,
  writePulseBaseline
} from "./pulse-baseline.mjs";
import { evaluatePulsePolicy } from "./pulse-policy.mjs";
import { readPulseAnalysisCache, writePulseAnalysisCache } from "./pulse-cache.mjs";
import { buildPulseDiff, changedPulseFiles } from "./pulse-diff.mjs";
import { pulseDoctor, pulseSarif, validatePulsePolicyDocument } from "./pulse-reporters.mjs";
import { readPulseTrend, recordPulseTrend } from "./pulse-trend.mjs";
import { getPackageVersion } from "./version.mjs";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

function inside(root, requested, label, { mustExist = false, maximum = MAX_DOCUMENT_BYTES } = {}) {
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the repository`);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link`);
  }
  if (mustExist) {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) throw new Error(`${label} must be a bounded non-linked regular file`);
  }
  return absolute;
}

export function readPulseConfig(options = {}) {
  if (options.configObject) return validatePulseConfig(options.configObject);
  if (!options.config) return {};
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.config, "pulse configuration", { mustExist: true });
  let config;
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse configuration contains invalid JSON"); }
  return validatePulseConfig(config);
}

function versions() {
  return {
    graph_version: PULSE_GRAPH_VERSION,
    metric_version: PULSE_METRIC_VERSION,
    extractor_version: PULSE_EXTRACTOR_VERSION,
    resolver_version: PULSE_RESOLVER_VERSION
  };
}

function reasonCodes(scan, extraction, analysis, config, cache) {
  const reasons = [];
  if (scan.inventory.counts.truncated || scan.inventory.counts.exclusion_reasons.resource_limit) reasons.push("RESOURCE_LIMIT");
  if (scan.inventory.counts.unsupported_in_scope) reasons.push("UNSUPPORTED_LANGUAGE");
  if (extraction?.failures?.length || analysis.coverage.parse_failed) reasons.push("PARSE_FAILURE");
  if (analysis.coverage.unresolved_internal) reasons.push("RESOLUTION_GAP");
  if (analysis.coverage.ambiguous) reasons.push("AMBIGUOUS_IMPORT");
  if (analysis.confidence.unavailable_resolvers?.length && config.schema_version === 2) reasons.push("OPTIONAL_RESOLVER_UNAVAILABLE");
  if (!analysis.metrics.blast_radius_complete) reasons.push("PARTIAL_COVERAGE");
  if (analysis.confidence.band === "LOW") reasons.push("LOW_CONFIDENCE");
  if (cache.status === "HIT") reasons.push("CACHE_NON_AUTHORITATIVE");
  if (!reasons.length) reasons.push("COMPLETE");
  return [...new Set(reasons)];
}

export function analyzeArchitecturePulse(options = {}) {
  const config = readPulseConfig(options);
  const deadline = options.deadline ?? createPulseDeadline(config.timeout_ms ?? options.timeoutMs ?? 30000);
  const scan = scanRepository({ ...options, config, deadline });
  const cache = readPulseAnalysisCache(scan, versions());
  let extraction = null;
  let analysis = cache.analysis;
  if (!analysis) {
    extraction = extractDependencies(scan);
    deadline.check("graph analysis");
    analysis = buildPulseGraph(scan, extraction);
    writePulseAnalysisCache(scan, versions(), analysis);
  }
  const reasons = reasonCodes(scan, extraction, analysis, config, cache);
  const degraded = scan.inventory.status === "DEGRADED"
    || analysis.coverage.parse_failed > 0
    || analysis.coverage.unresolved_internal > 0
    || analysis.coverage.ambiguous > 0
    || analysis.confidence.band === "LOW"
    || cache.status === "HIT"
    || !analysis.metrics.blast_radius_complete
    || (config.schema_version === 2 && analysis.confidence.unavailable_resolvers?.length > 0);
  deadline.check("result finalization");
  return finalizePulseResult({
    schema_version: PULSE_SCHEMA_VERSION,
    protocol: "aak-architecture-pulse-v2",
    tool_version: getPackageVersion(),
    ...versions(),
    analysis_status: degraded ? "DEGRADED" : "COMPLETE",
    reason_codes: reasons,
    repository: scan.repository,
    governance: { task_id: options.taskId ?? null, plan_id: options.planId ?? null, approval_reference: options.approvalReference ?? null },
    inventory: scan.inventory,
    graph: analysis.graph,
    findings: analysis.findings,
    finding_catalog: analysis.finding_catalog,
    metrics: analysis.metrics,
    coverage: analysis.coverage,
    confidence: analysis.confidence,
    cache: { authoritative: false, used: cache.status === "HIT" },
    diagnostic_notice: "pulse_index is diagnostic only; only explicit named rules with an approved evidence tier may block governed work"
  });
}

function writeFile(file, payload, label, maximum) {
  if (Buffer.byteLength(payload) > maximum) throw new Error(`${label} exceeds the bounded artifact budget`);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`${label} must be a non-linked regular file`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function shardValues(values, maximum) {
  const shards = [];
  let current = [];
  let currentBytes = 2;
  for (const value of values) {
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (bytes > maximum) throw new Error("one Architecture Pulse graph item exceeds the shard budget");
    if (current.length && currentBytes + bytes > maximum) { shards.push(current); current = []; currentBytes = 2; }
    current.push(value);
    currentBytes += bytes;
  }
  if (current.length) shards.push(current);
  return shards;
}

function writeShardedPulseResult(result, root, file, maximum, shardMaximum) {
  const baseName = path.basename(file, path.extname(file));
  const shardRoot = inside(root, path.join(path.dirname(path.relative(root, file)), `${baseName}.graph`), "pulse graph shard directory");
  const manifests = [];
  const collections = {
    nodes: result.graph.nodes,
    edges: result.graph.edges,
    unresolved: result.graph.unresolved,
    extraction_failures: result.graph.extraction_failures,
    inventory_entries: result.inventory.entries,
    inventory_exclusions: result.inventory.exclusions,
    findings_hotspots: result.findings.hotspots ?? [],
    findings_blast_radius: result.findings.blast_radius ?? [],
    findings_cohesion_by_module: result.findings.cohesion_by_module ?? []
  };
  for (const [kind, values] of Object.entries(collections)) {
    const shards = shardValues(values, Math.max(1024, shardMaximum - 1024));
    for (const [index, items] of shards.entries()) {
      const body = { schema_version: 1, kind, index, items };
      const document = { ...body, integrity: { algorithm: "SHA-256", digest: pulseDigest(body) } };
      const shard = path.join(shardRoot, `${kind}-${String(index).padStart(4, "0")}.json`);
      const payload = `${JSON.stringify(document)}\n`;
      writeFile(shard, payload, "pulse graph shard", shardMaximum);
      manifests.push({ kind, path: path.relative(root, shard).split(path.sep).join("/"), items: items.length, bytes: Buffer.byteLength(payload), digest: document.integrity.digest });
    }
  }
  const { result_digest: _digest, ...body } = result;
  const compact = finalizePulseResult({
    ...body,
    inventory: {
      ...body.inventory,
      entries: [],
      exclusions: [],
      evidence_artifacts: manifests.filter((item) => item.kind.startsWith("inventory_"))
    },
    graph: { storage: "external", graph_digest: result.graph.graph_digest, artifacts: manifests },
    findings: {
      cycles: [],
      boundaries: [],
      layers: [],
      public_apis: [],
      hotspots: [],
      blast_radius: [],
      cohesion_by_module: [],
      storage: "external"
    }
  });
  validatePulseResult(compact);
  writeFile(file, `${JSON.stringify(compact, null, 2)}\n`, "pulse result", maximum);
  return compact;
}

export function writePulseResult(result, options = {}) {
  validatePulseResult(result);
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.output ?? ".ai-agent-kit/pulse/results/latest.json";
  const file = inside(root, requested, "pulse output");
  const maximum = Number(options.maxArtifactBytes ?? result.inventory?.limits?.max_artifact_bytes ?? 8 * 1024 * 1024);
  const shardMaximum = Number(options.graphShardBytes ?? result.inventory?.limits?.graph_shard_bytes ?? 4 * 1024 * 1024);
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (Buffer.byteLength(payload) <= maximum) writeFile(file, payload, "pulse result", maximum);
  else writeShardedPulseResult(result, root, file, maximum, shardMaximum);
  return path.relative(root, file).split(path.sep).join("/");
}

export function writePulseDocument(document, options = {}, defaultOutput = ".ai-agent-kit/pulse/results/latest.json") {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.output ?? defaultOutput;
  const file = inside(root, requested, "pulse output");
  writeFile(file, `${JSON.stringify(document, null, 2)}\n`, "pulse document", Number(options.maxArtifactBytes ?? MAX_DOCUMENT_BYTES));
  return path.relative(root, file).split(path.sep).join("/");
}

export function readPulseResult(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.file, "pulse result", { mustExist: true });
  let result;
  try { result = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse result contains invalid JSON"); }
  return validatePulseResult(result);
}

function validateComparison(result) {
  if (!result || typeof result !== "object" || !new Set([1, 2]).has(result.schema_version) || !["IMPROVED", "STABLE", "REGRESSED", "STALE", "UNTRUSTED", "DEGRADED"].includes(result.status) || typeof result.reason_code !== "string" || typeof result.reason !== "string" || typeof result.blocking !== "boolean" || !Array.isArray(result.findings)) throw new Error("pulse comparison document contract is invalid");
  const { evidence_digest: claimed, ...body } = result;
  if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || pulseDigest(body) !== claimed) throw new Error("pulse comparison evidence digest mismatch");
  return result;
}

function validateDiff(result) {
  if (result?.protocol !== "aak-architecture-pulse-diff-v2" || result.schema_version !== 2 || !Array.isArray(result.changes) || !result.finding_changes || !result.graph_changes) throw new Error("pulse diff document contract is invalid");
  const { evidence_digest: claimed, ...body } = result;
  if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || pulseDigest(body) !== claimed) throw new Error("pulse diff evidence digest mismatch");
  return result;
}

export function readPulseDocument(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.file, "pulse document", { mustExist: true });
  let result;
  try { result = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse document contains invalid JSON"); }
  if (["aak-architecture-pulse-v1", "aak-architecture-pulse-v2"].includes(result?.protocol)) return validatePulseResult(result);
  if (result?.protocol === "aak-architecture-pulse-diff-v2") return validateDiff(result);
  return validateComparison(result);
}

export function verifyPulseFreshness(document, options = {}) {
  const expected = ["aak-architecture-pulse-v1", "aak-architecture-pulse-v2"].includes(document.protocol) ? document.repository : document.current?.repository ?? document.repository;
  if (!expected) return { status: "UNTRUSTED", reason: "Architecture Pulse artifact has no repository-state binding" };
  const current = currentPulseRepositoryState({ target: options.target, timeoutMs: options.timeoutMs });
  if (!current.available) return { status: "DEGRADED", reason: "current Git repository state is unavailable" };
  if (expected.identity_hash !== current.identity_hash) return { status: "UNTRUSTED", reason: "Architecture Pulse artifact belongs to another repository" };
  if (expected.commit !== current.commit || expected.worktree_digest !== current.worktree_digest) return { status: "STALE", reason: "Architecture Pulse artifact does not match the current repository state" };
  return { status: "VERIFIED", reason: "Architecture Pulse artifact matches the current repository state" };
}

export function createArchitecturePulseBaseline(options = {}) {
  const config = readPulseConfig(options);
  const result = analyzeArchitecturePulse({ ...options, configObject: { ...config, cache: { ...(config.cache ?? {}), enabled: false } } });
  if (result.analysis_status === "DEGRADED") return { result, baseline: null, artifact: null };
  const baseline = createPulseBaseline(result, options);
  return { result, baseline, artifact: writePulseBaseline(baseline, options) };
}

export function verifyArchitecturePulseBaseline(options = {}) {
  const { baseline, file } = readPulseBaseline(options);
  const config = readPulseConfig(options);
  const current = options.current === false ? null : analyzeArchitecturePulse({ ...options, configObject: { ...config, cache: { ...(config.cache ?? {}), enabled: false } } });
  return { ...verifyPulseBaseline(baseline, current), baseline: file, current_result_digest: current?.result_digest ?? null };
}

export function inspectArchitecturePulseBaseline(options = {}) {
  const { baseline, file } = readPulseBaseline(options);
  return { ...inspectPulseBaseline(baseline), baseline: file };
}

export function migrateArchitecturePulseBaseline(options = {}) {
  const { baseline, file } = readPulseBaseline(options);
  return { ...migratePulseBaseline(baseline, { dryRun: options.dryRun !== false }), baseline: file };
}

export function checkArchitecturePulse(options = {}) {
  const config = readPulseConfig(options);
  const current = analyzeArchitecturePulse({ ...options, configObject: { ...config, cache: { ...(config.cache ?? {}), enabled: false } } });
  const { baseline, file } = readPulseBaseline(options);
  const verification = verifyPulseBaseline(baseline, current);
  const blockingMinimumTier = config.blocking_minimum_tier ?? (config.schema_version === 2 ? "RESOLVER_VERIFIED" : "SOURCE_FALLBACK");
  const result = evaluatePulsePolicy({ baseline, current, verification, rules: config.rules, waivers: config.waivers, blockingMinimumTier, now: options.now });
  const body = {
    ...result,
    baseline: file,
    governance: current.governance,
    current: {
      result_digest: current.result_digest,
      source_digest: current.inventory.source_digest,
      analysis_config_digest: current.inventory.analysis_config_digest,
      policy_digest: current.inventory.policy_digest,
      config_digest: current.inventory.config_digest,
      repository: current.repository,
      metrics: current.metrics,
      coverage: current.coverage,
      confidence: current.confidence
    }
  };
  return { ...body, evidence_digest: pulseDigest(body) };
}

export function diffArchitecturePulse(options = {}) {
  const config = readPulseConfig(options);
  const freshConfig = { ...config, cache: { ...(config.cache ?? {}), enabled: false } };
  const deadline = createPulseDeadline(config.timeout_ms ?? options.timeoutMs ?? 30000);
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const baseRevision = options.base ?? "HEAD~1";
  const headRevision = options.head ?? "working-tree";
  const base = analyzeArchitecturePulse({ ...options, configObject: freshConfig, revision: baseRevision, deadline });
  const head = headRevision === "working-tree"
    ? analyzeArchitecturePulse({ ...options, configObject: freshConfig, revision: null, deadline })
    : analyzeArchitecturePulse({ ...options, configObject: freshConfig, revision: headRevision, deadline });
  return buildPulseDiff({ base, head, changes: changedPulseFiles(root, base.repository.commit, headRevision === "working-tree" ? "working-tree" : head.repository.commit, deadline) });
}

export function architecturePulseDoctor(options = {}) {
  return pulseDoctor(readPulseConfig(options));
}

export function validateArchitecturePulsePolicy(options = {}) {
  return validatePulsePolicyDocument(readPulseConfig(options));
}

export function writeArchitecturePulseSarif(document, options = {}) {
  const sarif = pulseSarif(document);
  const output = writePulseDocument(sarif, options, ".ai-agent-kit/pulse/results/architecture-pulse.sarif");
  return { status: "CREATED", output, results: sarif.runs[0].results.length };
}

export { readPulseTrend, recordPulseTrend };

function findingLines(result) {
  if (!result.finding_catalog?.length) return [];
  return result.finding_catalog.slice(0, 20).map((finding) => {
    const witness = finding.witness?.length ? ` | Witness: ${finding.witness.map((edge) => edge.from ?? edge).concat(finding.witness.at(-1)?.to ?? []).filter(Boolean).join(" -> ")}` : "";
    return `- [${finding.type}] ${finding.title} | ${finding.fingerprint} | Evidence: ${finding.evidence_tier}${witness}`;
  });
}

export function renderPulseSummary(result) {
  if (["aak-architecture-pulse-v1", "aak-architecture-pulse-v2"].includes(result.protocol)) {
    return [
      `Architecture Pulse: ${result.analysis_status}`,
      `Files: ${result.metrics.node_count} | Edges: ${result.metrics.edge_count} | Supported scope: ${(result.coverage.files * 100).toFixed(1)}% | Confidence: ${result.confidence.band}`,
      `Scope: ${result.coverage.supported_in_scope ?? result.coverage.analyzed_files} supported | ${result.coverage.unsupported_in_scope ?? result.coverage.unsupported_files} unsupported | ${result.coverage.excluded_by_policy ?? 0} policy-excluded`,
      `Resolution: ${result.coverage.unresolved_internal ?? result.coverage.unresolved_imports} unresolved internal | ${result.coverage.ambiguous ?? 0} ambiguous | ${result.coverage.external_declared ?? 0} declared external`,
      `Cycles: ${result.metrics.cycle_count} | Boundary violations: ${result.metrics.boundary_violation_count} | Depth: ${result.metrics.condensation_depth}`,
      `Evidence tier: ${result.confidence.minimum_evidence_tier ?? "LEGACY"} | Diagnostic index: ${result.metrics.pulse_index.toFixed(1)} (never a standalone gate)`,
      ...findingLines(result),
      `Evidence: ${result.result_digest}`
    ].join("\n");
  }
  if (result.protocol === "aak-architecture-pulse-diff-v2") {
    return [
      `Architecture Pulse diff: ${result.base.commit} -> ${result.head.commit ?? "working-tree"}`,
      `Changed files: ${result.changes.length} | Added edges: ${result.graph_changes.added_edges.length} | Removed edges: ${result.graph_changes.removed_edges.length}`,
      `Findings: ${result.finding_changes.new.length} new | ${result.finding_changes.fixed.length} fixed | ${result.finding_changes.updated.length} updated | ${result.finding_changes.unchanged.length} unchanged`,
      `Affected components: ${result.affected_components.map((item) => item.component).join(", ") || "none"}`,
      `Evidence: ${result.evidence_digest}`
    ].join("\n");
  }
  return [
    `Architecture Pulse comparison: ${result.status}${result.blocking ? " (BLOCKING)" : ""}`,
    result.reason,
    `Findings: ${result.finding_changes?.new?.length ?? 0} new | ${result.finding_changes?.fixed?.length ?? 0} fixed | ${result.finding_changes?.updated?.length ?? 0} updated | ${result.finding_changes?.unchanged?.length ?? 0} unchanged`,
    ...(result.findings ?? []).filter((finding) => finding.violated).map((finding) => `- ${finding.id}: delta ${finding.delta} > threshold ${finding.threshold} [${finding.severity}] | Evidence sufficient: ${finding.evidence_sufficient}`),
    ...(result.finding_changes?.new ?? []).slice(0, 20).map((finding) => `  New: ${finding.title} | ${finding.fingerprint}`),
    ...(result.finding_changes?.fixed ?? []).slice(0, 20).map((finding) => `  Fixed: ${finding.title} | ${finding.fingerprint}`),
    `Evidence: ${result.evidence_digest ?? result.baseline_digest ?? "unavailable"}`
  ].join("\n");
}
