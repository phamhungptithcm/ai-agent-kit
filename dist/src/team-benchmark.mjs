const MODES = ["SINGLE_AGENT", "UNGOVERNED_MULTI_AGENT", "AGENT_DEPARTMENT"];
const METRICS = ["escaped_defects", "scope_violations", "duplicate_scans", "tokens", "duration_seconds", "review_cycles"];

function finite(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }

export function buildTeamBenchmarkTemplate() {
  return { schema_version: 1, synthetic: false, methodology: { same_task: true, same_repository_commit: true, same_host: true, same_model: true, repetitions_per_mode: 3 }, cases: [{ id: "replace-me", repository_commit: null, host: null, model: null, runs: [] }], notes: "Record all three modes under the same conditions. Empty templates are INSUFFICIENT_EVIDENCE." };
}

export function evaluateTeamBenchmark(fixture) {
  if (!fixture || fixture.schema_version !== 1 || !Array.isArray(fixture.cases) || !fixture.cases.length) throw new Error("team benchmark fixture is invalid");
  const problems = []; const normalized = []; const repetitions = fixture.methodology?.repetitions_per_mode;
  if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 100) problems.push("methodology requires 3-100 repetitions_per_mode");
  for (const item of fixture.cases) {
    const id = safe(item.id, "benchmark case id"); const runs = Array.isArray(item.runs) ? item.runs : [];
    for (const mode of MODES) {
      const count = runs.filter((run) => run.mode === mode).length;
      if (!count) problems.push(`${id}: missing ${mode}`);
      else if (Number.isInteger(repetitions) && count !== repetitions) problems.push(`${id}/${mode}: expected ${repetitions} repetitions, received ${count}`);
    }
    for (const run of runs) {
      if (!MODES.includes(run.mode)) { problems.push(`${id}: invalid mode`); continue; }
      if (!new Set(["COMPLETED", "FAILED", "BLOCKED"]).has(run.status)) problems.push(`${id}/${run.mode}: invalid status`);
      for (const metric of METRICS) if (!finite(run[metric])) problems.push(`${id}/${run.mode}: missing ${metric}`);
      if (!finite(run.evidence_items) || !finite(run.required_evidence_items) || run.evidence_items > run.required_evidence_items) problems.push(`${id}/${run.mode}: invalid evidence counts`);
    }
    if (!item.repository_commit || !item.host || !item.model) problems.push(`${id}: comparison binding is incomplete`);
    normalized.push({ id, runs });
  }
  if (problems.length) return { schema_version: 1, status: "INSUFFICIENT_EVIDENCE", synthetic: Boolean(fixture.synthetic), modes: MODES, sample_size: normalized.reduce((sum, item) => sum + item.runs.length, 0), problems, results: [] };
  const results = MODES.map((mode) => {
    const runs = normalized.flatMap((item) => item.runs.filter((run) => run.mode === mode));
    const sum = (field) => runs.reduce((total, run) => total + run[field], 0);
    return { mode, sample_size: runs.length, completion_rate: { numerator: runs.filter((run) => run.status === "COMPLETED").length, denominator: runs.length }, evidence_completeness: { numerator: sum("evidence_items"), denominator: sum("required_evidence_items") }, averages: Object.fromEntries(METRICS.map((metric) => [metric, sum(metric) / runs.length])) };
  });
  const methodology = fixture.methodology ?? {}; const comparable = methodology.same_task === true && methodology.same_repository_commit === true && methodology.same_host === true && methodology.same_model === true;
  if (!comparable) problems.push("methodology does not hold task, commit, host, and model constant");
  const status = fixture.synthetic ? "SYNTHETIC_ONLY" : comparable ? "MEASURED" : "PARTIAL";
  return { schema_version: 1, status, synthetic: Boolean(fixture.synthetic), modes: MODES, case_count: normalized.length, sample_size: normalized.reduce((sum, item) => sum + item.runs.length, 0), problems, results, conclusion_allowed: status === "MEASURED" };
}
