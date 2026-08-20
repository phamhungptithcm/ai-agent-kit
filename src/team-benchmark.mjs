import crypto from "node:crypto";

import { stableTeamValue, teamControlDigest, teamTimestamp } from "./team-control-contract.mjs";

const LEGACY_MODES = ["SINGLE_AGENT", "UNGOVERNED_MULTI_AGENT", "AGENT_DEPARTMENT"];
const CONTROL_PLANE_MODES = ["SINGLE_AGENT", "UNGOVERNED_MULTI_AGENT", "TASK_LOCAL_GOVERNED", "REPOSITORY_CONTROL_PLANE"];
const METRICS = ["escaped_defects", "scope_violations", "duplicate_scans", "tokens", "duration_seconds", "review_cycles"];
const RUN_STATUSES = new Set(["COMPLETED", "FAILED", "BLOCKED"]);

function finite(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function stableJson(value) { return JSON.stringify(stableTeamValue(value)); }

function receiptPayload(options) {
  const run = options.run;
  return {
    schema_version: 1,
    run_id: safe(options.runId, "benchmark run id"),
    case_id: safe(options.caseId, "benchmark case id"),
    mode: safe(run.mode, "benchmark mode"),
    repository_commit: String(options.repositoryCommit ?? ""),
    host: safe(options.host, "benchmark host"),
    model: safe(options.model, "benchmark model"),
    environment: options.environment === "RUNTIME" ? "RUNTIME" : "SYNTHETIC",
    run_hash: teamControlDigest(run),
    key_id: safe(options.keyId, "benchmark key id"),
    recorded_at: teamTimestamp(options.recordedAt ?? new Date().toISOString())
  };
}

export function createBenchmarkRunReceipt(options = {}) {
  if (typeof options.privateKeyPem !== "string" || !options.privateKeyPem.includes("PRIVATE KEY")) throw new Error("benchmark receipt requires a PEM private key");
  const payload = receiptPayload(options);
  if (!/^[a-f0-9]{40,64}$/.test(payload.repository_commit)) throw new Error("benchmark receipt repository commit is invalid");
  return { ...payload, signature: crypto.sign(null, Buffer.from(stableJson(payload)), options.privateKeyPem).toString("base64") };
}

export function verifyBenchmarkRunReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("benchmark receipt is invalid");
  const payload = structuredClone(receipt); const signature = payload.signature; delete payload.signature;
  const key = options.resolveKey?.(payload.key_id) ?? options.trustedKeys?.[payload.key_id];
  if (!key || typeof key !== "object" || Array.isArray(key) || key.status !== "ACTIVE") throw new Error("benchmark receipt signing key is not trusted");
  if (payload.schema_version !== 1 || !/^[a-f0-9]{40,64}$/.test(payload.repository_commit ?? "") || !/^[a-f0-9]{64}$/.test(payload.run_hash ?? "") || !["RUNTIME", "SYNTHETIC"].includes(payload.environment)) throw new Error("benchmark receipt contract is invalid");
  for (const [value, label] of [[payload.run_id, "benchmark run id"], [payload.case_id, "benchmark case id"], [payload.mode, "benchmark mode"], [payload.host, "benchmark host"], [payload.model, "benchmark model"], [payload.key_id, "benchmark key id"]]) safe(value, label);
  const recordedAt = teamTimestamp(payload.recorded_at, "benchmark receipt time");
  if (key.principal_id !== payload.host || !key.capabilities?.includes("metrics.read")) throw new Error("benchmark receipt key is not authorized for this host");
  if ((key.valid_from && Date.parse(recordedAt) < Date.parse(key.valid_from)) || (key.valid_until && Date.parse(recordedAt) > Date.parse(key.valid_until))) throw new Error("benchmark receipt is outside the signing key validity window");
  let publicKey;
  try { publicKey = crypto.createPublicKey(key.public_key_pem); } catch { throw new Error("benchmark receipt signing key is invalid"); }
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("benchmark receipt signing key must use Ed25519");
  if (!crypto.verify(null, Buffer.from(stableJson(payload)), publicKey, Buffer.from(signature ?? "", "base64"))) throw new Error("benchmark receipt signature is invalid");
  return payload;
}

export function buildTeamBenchmarkTemplate() {
  return {
    schema_version: 3,
    profile: "V1_5_RELEASE",
    methodology: { repetitions_per_mode: 3, minimum_task_cases: 30 },
    cases: [{ id: "replace-me", repository_commit: null, host: null, model: null, runs: [] }],
    notes: "Each run needs a unique signed runtime receipt. Unverified or synthetic receipts cannot produce MEASURED."
  };
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.length > 1 ? sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (sorted.length - 1) : 0;
  const standardDeviation = Math.sqrt(variance);
  const margin = 1.96 * standardDeviation / Math.sqrt(sorted.length);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { mean, median: percentile(0.5), p95: percentile(0.95), standard_deviation: standardDeviation, confidence_95: { low: Math.max(0, mean - margin), high: mean + margin } };
}

export function evaluateTeamBenchmark(fixture, options = {}) {
  if (!fixture || ![1, 2, 3].includes(fixture.schema_version) || !Array.isArray(fixture.cases) || !fixture.cases.length) throw new Error("team benchmark fixture is invalid");
  const releaseGrade = fixture.schema_version === 3;
  const modes = fixture.schema_version >= 2 ? CONTROL_PLANE_MODES : LEGACY_MODES;
  const problems = [];
  const normalized = [];
  const repetitions = fixture.methodology?.repetitions_per_mode;
  const seenRunIds = new Set();
  const seenCaseIds = new Set();
  let syntheticReceipts = 0;
  let verifiedReceipts = 0;
  if (releaseGrade && fixture.profile !== "V1_5_RELEASE") problems.push("schema v3 requires the V1_5_RELEASE profile");
  if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 100) problems.push("methodology requires 3-100 repetitions_per_mode");
  if (!Number.isInteger(fixture.methodology?.minimum_task_cases) || fixture.methodology.minimum_task_cases < 30 || fixture.methodology.minimum_task_cases > 1_000) problems.push("methodology requires 30-1000 minimum_task_cases");
  for (const item of fixture.cases) {
    const id = safe(item.id, "benchmark case id"); const runs = Array.isArray(item.runs) ? item.runs : [];
    if (seenCaseIds.has(id)) problems.push(`${id}: duplicate case id`);
    seenCaseIds.add(id);
    for (const mode of modes) {
      const count = runs.filter((run) => run.mode === mode).length;
      if (!count) problems.push(`${id}: missing ${mode}`);
      else if (Number.isInteger(repetitions) && count !== repetitions) problems.push(`${id}/${mode}: expected ${repetitions} repetitions, received ${count}`);
    }
    for (const run of runs) {
      if (!modes.includes(run.mode)) { problems.push(`${id}: invalid mode`); continue; }
      if (!RUN_STATUSES.has(run.status)) problems.push(`${id}/${run.mode}: invalid status`);
      for (const metric of METRICS) if (!finite(run[metric])) problems.push(`${id}/${run.mode}: missing ${metric}`);
      if (!finite(run.evidence_items) || !finite(run.required_evidence_items) || run.evidence_items > run.required_evidence_items) problems.push(`${id}/${run.mode}: invalid evidence counts`);
      if (releaseGrade) {
        try {
          const receipt = verifyBenchmarkRunReceipt(run.receipt, options);
          if (receipt.case_id !== id || receipt.mode !== run.mode || receipt.repository_commit !== item.repository_commit || receipt.host !== item.host || receipt.model !== item.model || receipt.run_hash !== teamControlDigest(Object.fromEntries(Object.entries(run).filter(([key]) => key !== "receipt")))) throw new Error("receipt binding mismatch");
          if (seenRunIds.has(receipt.run_id)) throw new Error("duplicate run id");
          seenRunIds.add(receipt.run_id); verifiedReceipts += 1;
          if (receipt.environment !== "RUNTIME") syntheticReceipts += 1;
        } catch (error) { problems.push(`${id}/${run.mode}: ${error.message}`); }
      }
    }
    if (!/^[a-f0-9]{40,64}$/.test(item.repository_commit ?? "") || !item.host || !item.model) problems.push(`${id}: comparison binding is incomplete`);
    normalized.push({ id, runs });
  }
  const minimumCases = Math.max(30, fixture.methodology?.minimum_task_cases ?? 30);
  if (fixture.schema_version >= 2 && normalized.length < minimumCases) problems.push(`release benchmark requires at least ${minimumCases} task cases`);
  if (!releaseGrade) problems.push("legacy benchmark fixture has no signed runtime provenance");
  if (syntheticReceipts) problems.push(`${syntheticReceipts} signed receipt(s) are synthetic rather than runtime evidence`);
  if (problems.length) return { schema_version: fixture.schema_version, status: releaseGrade ? (syntheticReceipts ? "SYNTHETIC_ONLY" : "INSUFFICIENT_EVIDENCE") : "UNVERIFIED", modes, case_count: normalized.length, sample_size: normalized.reduce((sum, item) => sum + item.runs.length, 0), verified_receipts: verifiedReceipts, problems, results: [], conclusion_allowed: false };
  const results = modes.map((mode) => {
    const runs = normalized.flatMap((item) => item.runs.filter((run) => run.mode === mode));
    const sum = (field) => runs.reduce((total, run) => total + run[field], 0);
    return {
      mode,
      sample_size: runs.length,
      completion_rate: { numerator: runs.filter((run) => run.status === "COMPLETED").length, denominator: runs.length },
      evidence_completeness: { numerator: sum("evidence_items"), denominator: sum("required_evidence_items") },
      distributions: Object.fromEntries(METRICS.map((metric) => [metric, distribution(runs.map((run) => run[metric]))]))
    };
  });
  return { schema_version: fixture.schema_version, status: "MEASURED", modes, case_count: normalized.length, sample_size: normalized.reduce((sum, item) => sum + item.runs.length, 0), verified_receipts: verifiedReceipts, problems, results, conclusion_allowed: true };
}
