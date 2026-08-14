import fs from "node:fs";
import path from "node:path";
import { PULSE_EXTRACTOR_VERSION, PULSE_METRIC_VERSION, PULSE_SCHEMA_VERSION, finalizePulseResult, pulseDigest, validatePulseResult } from "./pulse-contract.mjs";
import { currentPulseRepositoryState, scanRepository, validatePulseConfig } from "./pulse-scanner.mjs";
import { extractDependencies } from "./pulse-extractors.mjs";
import { buildPulseGraph } from "./pulse-graph.mjs";
import { createPulseBaseline, readPulseBaseline, verifyPulseBaseline, writePulseBaseline } from "./pulse-baseline.mjs";
import { evaluatePulsePolicy } from "./pulse-policy.mjs";
import { getPackageVersion } from "./version.mjs";

function inside(root, requested, label, { mustExist = false } = {}) {
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
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 16 * 1024 * 1024) throw new Error(`${label} must be a bounded non-linked regular file`);
  }
  return absolute;
}

export function readPulseConfig(options = {}) {
  if (!options.config) return {};
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.config, "pulse configuration", { mustExist: true });
  let config;
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse configuration contains invalid JSON"); }
  return validatePulseConfig(config);
}

export function analyzeArchitecturePulse(options = {}) {
  const config = options.configObject ?? readPulseConfig(options);
  const scan = scanRepository({ ...options, config });
  const extraction = extractDependencies(scan);
  const analysis = buildPulseGraph(scan, extraction);
  const degraded = scan.inventory.status === "DEGRADED" || extraction.failures.length > 0 || analysis.confidence.band === "LOW" || !analysis.metrics.blast_radius_complete;
  const reasonCodes = [];
  if (scan.inventory.status === "DEGRADED") reasonCodes.push("RESOURCE_LIMIT");
  if (scan.inventory.counts.exclusion_reasons.unsupported_language) reasonCodes.push("UNSUPPORTED_LANGUAGE");
  if (extraction.failures.length) reasonCodes.push("PARSE_FAILURE");
  if (!analysis.metrics.blast_radius_complete) reasonCodes.push("PARTIAL_COVERAGE");
  if (analysis.confidence.band === "LOW") reasonCodes.push("LOW_CONFIDENCE");
  if (!reasonCodes.length) reasonCodes.push("COMPLETE");
  return finalizePulseResult({
    schema_version: PULSE_SCHEMA_VERSION,
    protocol: "aak-architecture-pulse-v1",
    tool_version: getPackageVersion(),
    metric_version: PULSE_METRIC_VERSION,
    extractor_version: PULSE_EXTRACTOR_VERSION,
    analysis_status: degraded ? "DEGRADED" : "COMPLETE",
    reason_codes: reasonCodes,
    repository: scan.repository,
    governance: { task_id: options.taskId ?? null, plan_id: options.planId ?? null, approval_reference: options.approvalReference ?? null },
    inventory: scan.inventory,
    graph: analysis.graph,
    findings: analysis.findings,
    metrics: analysis.metrics,
    coverage: analysis.coverage,
    confidence: analysis.confidence,
    diagnostic_notice: "pulse_index is diagnostic only; only explicit configured rules may block governed work"
  });
}

export function writePulseResult(result, options = {}) {
  validatePulseResult(result);
  return writePulseDocument(result, options, ".ai-agent-kit/pulse/results/latest.json");
}

export function writePulseDocument(document, options = {}, defaultOutput = ".ai-agent-kit/pulse/results/latest.json") {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const requested = options.output ?? defaultOutput;
  const file = inside(root, requested, "pulse output");
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error("pulse output must be a non-linked regular file");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return path.relative(root, file).split(path.sep).join("/");
}

export function readPulseResult(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.file, "pulse result", { mustExist: true });
  let result;
  try { result = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse result contains invalid JSON"); }
  return validatePulseResult(result);
}

export function readPulseDocument(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const file = inside(root, options.file, "pulse document", { mustExist: true });
  let result;
  try { result = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("pulse document contains invalid JSON"); }
  if (result?.protocol === "aak-architecture-pulse-v1") return validatePulseResult(result);
  if (!result || typeof result !== "object" || result.schema_version !== 1 || !["IMPROVED", "STABLE", "REGRESSED", "STALE", "UNTRUSTED", "DEGRADED"].includes(result.status) || typeof result.reason_code !== "string" || typeof result.reason !== "string" || typeof result.blocking !== "boolean" || !Array.isArray(result.findings)) throw new Error("pulse comparison document contract is invalid");
  if (result.current != null && (!result.current || typeof result.current !== "object" || !/^[a-f0-9]{64}$/.test(result.current.result_digest ?? "") || !/^[a-f0-9]{64}$/.test(result.current.source_digest ?? "") || !/^[a-f0-9]{64}$/.test(result.current.config_digest ?? "") || !/^[a-f0-9]{64}$/.test(result.current.repository?.identity_hash ?? "") || !/^[a-f0-9]{64}$/.test(result.current.repository?.worktree_digest ?? "") || !result.current.metrics || !result.current.coverage || !result.current.confidence)) throw new Error("pulse comparison current evidence is invalid");
  const { evidence_digest: claimed, ...body } = result;
  if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || pulseDigest(body) !== claimed) throw new Error("pulse comparison evidence digest mismatch");
  return result;
}

export function verifyPulseFreshness(document, options = {}) {
  const expected = document.protocol === "aak-architecture-pulse-v1" ? document.repository : document.current?.repository;
  if (!expected) return { status: "UNTRUSTED", reason: "Architecture Pulse artifact has no repository-state binding" };
  const current = currentPulseRepositoryState({ target: options.target, timeoutMs: options.timeoutMs });
  if (!current.available) return { status: "DEGRADED", reason: "current Git repository state is unavailable" };
  if (expected.identity_hash !== current.identity_hash) return { status: "UNTRUSTED", reason: "Architecture Pulse artifact belongs to another repository" };
  if (expected.commit !== current.commit || expected.worktree_digest !== current.worktree_digest) return { status: "STALE", reason: "Architecture Pulse artifact does not match the current repository state" };
  return { status: "VERIFIED", reason: "Architecture Pulse artifact matches the current repository state" };
}

export function createArchitecturePulseBaseline(options = {}) {
  const result = analyzeArchitecturePulse(options);
  if (result.analysis_status === "DEGRADED") return { result, baseline: null, artifact: null };
  const baseline = createPulseBaseline(result, options);
  return { result, baseline, artifact: writePulseBaseline(baseline, options) };
}

export function verifyArchitecturePulseBaseline(options = {}) {
  const { baseline, file } = readPulseBaseline(options);
  const current = options.current === false ? null : analyzeArchitecturePulse(options);
  return { ...verifyPulseBaseline(baseline, current), baseline: file, current_result_digest: current?.result_digest ?? null };
}

export function checkArchitecturePulse(options = {}) {
  const current = analyzeArchitecturePulse(options);
  const { baseline, file } = readPulseBaseline(options);
  const verification = verifyPulseBaseline(baseline, current);
  const result = evaluatePulsePolicy({ baseline, current, verification, rules: options.configObject?.rules ?? readPulseConfig(options).rules });
  const body = { ...result, baseline: file, governance: current.governance, current: { result_digest: current.result_digest, source_digest: current.inventory.source_digest, config_digest: current.inventory.config_digest, repository: current.repository, metrics: current.metrics, coverage: current.coverage, confidence: current.confidence } };
  return { ...body, evidence_digest: pulseDigest(body) };
}

export function renderPulseSummary(result) {
  if (result.protocol === "aak-architecture-pulse-v1") {
    return [
      `Architecture Pulse: ${result.analysis_status}`,
      `Files: ${result.metrics.node_count} | Edges: ${result.metrics.edge_count} | Coverage: ${(result.coverage.files * 100).toFixed(1)}% | Confidence: ${result.confidence.band}`,
      `Cycles: ${result.metrics.cycle_count} | Boundary violations: ${result.metrics.boundary_violation_count} | Depth: ${result.metrics.condensation_depth}`,
      `Cohesion: ${result.metrics.average_module_cohesion.toFixed(3)} | Hotspot concentration: ${result.metrics.hotspot_concentration.toFixed(3)} | Max blast radius: ${result.metrics.maximum_blast_radius}`,
      `Diagnostic index: ${result.metrics.pulse_index.toFixed(1)} (never a standalone gate)`,
      `Evidence: ${result.result_digest}`
    ].join("\n");
  }
  return [
    `Architecture Pulse comparison: ${result.status}${result.blocking ? " (BLOCKING)" : ""}`,
    result.reason,
    ...(result.findings ?? []).filter((finding) => finding.violated).map((finding) => `- ${finding.id}: delta ${finding.delta} > threshold ${finding.threshold} [${finding.severity}]`),
    `Evidence: ${result.evidence_digest ?? result.baseline_digest ?? "unavailable"}`
  ].join("\n");
}
