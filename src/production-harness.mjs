import { deliveryText, deliveryId, readDeliveryFile, readDeliveryJson, deliveryInput, deliveryDigest, verifyExecutionEvidence } from "./delivery-evidence.mjs";

// Internal acceptance policy. External references inform selected controls;
// this catalog is not an exhaustive ASVS/SSDF conformance certification.
export const PRODUCTION_POLICY = "AAK-PRODUCTION-1";
export const PRODUCTION_RULES = Object.freeze([
  ["DOC-PROVENANCE", "documents", "plan", ["sources", "assumptions", "owner", "revision", "review_due"], false],
  ["BR-INVARIANTS", "business_rules", "business_rules", ["actors", "invariants", "permissions", "exceptions", "negative_cases"], false],
  ["BUDGET-CONTROL", "budget", "budget", ["currency", "ceiling", "forecast", "unit_cost", "approval", "stop_condition"], true],
  ["DESIGN-STACK", "system_design", "design", ["languages", "versions", "frameworks", "selection_rationale", "support_policy"], false],
  ["DESIGN-BOUNDARIES", "system_design", "design", ["components", "dependency_direction", "data_ownership", "failure_recovery", "alternatives"], true],
  ["SPEC-CONTRACT", "specs", "specification", ["inputs", "outputs", "validation", "errors", "compatibility", "positive_negative_acceptance"], true],
  ["PLAN-DEPENDENCIES", "project_plan", "plan", ["scope", "owners", "dependencies", "risks", "rollback", "definition_of_done"], false],
  ["TIMELINE-CAPACITY", "project_timeline", "timeline", ["estimates", "capacity", "critical_path", "buffers", "replan_triggers"], false],
  ["STORY-VALUE", "project_stories", "stories", ["actor", "outcome", "acceptance", "priority", "non_goals"], false],
  ["TASK-READY", "project_tasks", "tasks", ["owner", "story", "paths", "dependencies", "estimate", "checks", "handoff"], false],
  ["CODE-CONVENTIONS", "implementation", "design", ["formatting", "lint", "types", "naming", "error_handling"], true],
  ["CODE-MAINTAINABILITY", "implementation", "design", ["responsibilities", "complexity_limits", "duplication", "test_boundaries"], true],
  ["API-DESIGN", "api", "design", ["schema", "authorization", "pagination", "idempotency", "timeouts", "error_contract", "versioning"], true],
  ["PERF-BUDGET", "performance", "design", ["workload", "latency_percentile", "throughput", "resource_limits", "regression_threshold"], true],
  ["MEMORY-LIFECYCLE", "memory", "design", ["ownership", "cleanup", "bounded_caches", "cancellation", "soak_duration", "growth_limit"], true],
  ["SEC-THREAT", "security", "design", ["assets", "trust_boundaries", "abuse_cases", "mitigations", "residual_risks"], true],
  ["SEC-ACCESS", "security", "design", ["authentication", "object_authorization", "least_privilege", "negative_checks"], true],
  ["SEC-DATA", "security", "design", ["classification", "secrets", "redaction", "retention", "injection_ssrf", "dependency_policy"], true],
  ["DATA-INTEGRITY", "data", "design", ["transactions", "migration", "backup_restore", "concurrency", "retry"], true],
  ["REVIEW-LOOP", "review", "plan", ["independence", "findings", "fix_verification", "stale_invalidation"], true],
  ["OPS-RELEASE", "operations", "plan", ["artifact", "observability", "alerts", "rollback", "target_sanity", "observation"], true]
].map(([id, area, document_kind, fields, executable]) => Object.freeze({ id, area, document_kind, fields, executable })));

const bounded = (v, name, max = 100) => { if (!Array.isArray(v) || !v.length || v.length > max) throw new Error(`${name} must be a nonempty bounded array.`); return v; };
function concrete(v, name) { deliveryText(v, name); if (/\b(TODO|TBD|FIXME|placeholder)\b|^\s*(unknown|n\/a|none)\s*$/i.test(v)) throw new Error(`${name} must be concrete; unresolved decisions belong in open_decisions.`); }
export function validateProductionHarness(root, contract) {
  if (contract.schema_version !== 2) return;
  const quality = contract.quality;
  if (!quality || quality.policy !== PRODUCTION_POLICY) throw new Error(`Contract v2 requires quality.policy ${PRODUCTION_POLICY}.`);
  const inspectData = (value, depth = 0) => {
    if (depth > 16) throw new Error("Quality data exceeds the nesting budget.");
    if (typeof value === "string") deliveryText(value, "Quality declaration");
    if (Array.isArray(value)) for (const item of value) inspectData(item, depth + 1);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      if (/^(private_key(?:_pem)?|password|api_key|access_token|refresh_token)$/i.test(key)) throw new Error("Quality data must not contain credentials.");
      inspectData(child, depth + 1);
    }
  };
  inspectData(quality);
  const docs = new Map(contract.documents.map((doc) => [doc.id, doc]));
  for (const kind of ["budget", "timeline", "stories", "tasks"]) if (!contract.documents.some((doc) => doc.kind === kind)) throw new Error(`Production harness requires ${kind} document.`);
  const controls = bounded(quality.controls, "Quality controls", 100);
  if (new Set(controls.map((c) => c.id)).size !== controls.length || controls.some((c) => !PRODUCTION_RULES.some((r) => r.id === c.id))) throw new Error("Duplicate or unknown quality control.");
  const checks = new Set(contract.acceptance.flatMap((ac) => ac.checks));
  for (const rule of PRODUCTION_RULES) {
    const c = controls.find((item) => item.id === rule.id);
    if (!c) throw new Error(`Missing production rule ${rule.id}.`);
    if (docs.get(c.document_id)?.kind !== rule.document_kind) throw new Error(`${rule.id} needs a ${rule.document_kind} document reference.`);
    if (!["REQUIRED", "NOT_APPLICABLE"].includes(c.applicability)) throw new Error(`${rule.id} applicability is required.`);
    // Planning and security fundamentals cannot be skipped through an N/A label.
    if (c.applicability === "NOT_APPLICABLE") {
      if (!["API-DESIGN", "DATA-INTEGRITY"].includes(rule.id)) throw new Error(`${rule.id} cannot be excluded.`);
      concrete(c.rationale, `${rule.id} exclusion rationale`);
    } else {
      for (const field of rule.fields) concrete(c.fields?.[field], `${rule.id}.${field}`);
      if (rule.executable) for (const check of bounded(c.check_ids, `${rule.id} checks`, 50)) if (!checks.has(deliveryId(check))) throw new Error(`${rule.id} check must link to an acceptance criterion.`);
    }
    for (const source of bounded(c.sources, `${rule.id} sources`, 30)) if (!/^[a-f0-9]{64}$/.test(source.sha256 ?? "") || readDeliveryFile(root, source.path).sha256 !== source.sha256) throw new Error(`${rule.id} source is missing or stale.`);
  }
  const stack = quality.stack;
  for (const name of ["languages", "runtimes", "frameworks"]) for (const entry of bounded(stack?.[name], `Stack ${name}`, 20)) {
    concrete(entry.name, `Stack ${name} name`); concrete(entry.version, `Stack ${name} version`); concrete(entry.rationale, `Stack ${name} rationale`);
    if (readDeliveryFile(root, entry.evidence?.path).sha256 !== entry.evidence?.sha256) throw new Error("Stack evidence is missing or stale.");
  }
  const measurements = bounded(quality.measurements, "Performance and memory budgets", 50);
  const measureIds = new Set();
  for (const measure of measurements) {
    deliveryId(measure.id); if (measureIds.has(measure.id)) throw new Error("Measurement IDs must be unique."); measureIds.add(measure.id);
    if (!["PERF-BUDGET", "MEMORY-LIFECYCLE"].includes(measure.control_id) || !Number.isFinite(measure.limit) || measure.limit < 0 || !["LTE", "GTE"].includes(measure.comparison)) throw new Error("Measurement requires a numeric bound, comparison and performance/memory control.");
    for (const name of ["metric", "unit", "workload", "environment"]) concrete(measure[name], `Measurement ${name}`);
    if (!controls.find((c) => c.id === measure.control_id).check_ids.includes(measure.check_id)) throw new Error("Measurement check is not linked to its control.");
  }
  for (const control of ["PERF-BUDGET", "MEMORY-LIFECYCLE"]) if (!measurements.some((m) => m.control_id === control)) throw new Error(`${control} requires a measurable budget.`);
  const budget = quality.budget;
  if (!/^[A-Z]{3}$/.test(budget?.currency ?? "") || !Number.isFinite(budget.limit) || budget.limit < 0 || !Number.isFinite(budget.forecast) || budget.forecast < 0 || budget.forecast > budget.limit) throw new Error("Budget requires currency and nonnegative forecast within limit.");
  concrete(budget.owner, "Budget owner"); concrete(budget.stop_condition, "Budget stop condition");
  const stories = bounded(quality.stories, "Stories"); const storyIds = new Set(stories.map((s) => deliveryId(s.id)));
  if (storyIds.size !== stories.length) throw new Error("Story IDs must be unique.");
  const acIds = new Set(contract.acceptance.map((ac) => ac.id));
  for (const story of stories) { concrete(story.actor, "Story actor"); concrete(story.outcome, "Story outcome"); for (const ac of bounded(story.acceptance_ids, "Story acceptance")) if (!acIds.has(ac)) throw new Error("Story acceptance is unknown."); }
  for (const ac of contract.acceptance) if (!stories.some((story) => story.acceptance_ids.includes(ac.id))) throw new Error("Every acceptance criterion requires a story.");
  for (const task of contract.tasks) if (!storyIds.has(task.story_id) || !contract.acceptance.filter((ac) => ac.task_id === task.id).every((ac) => stories.find((story) => story.id === task.story_id).acceptance_ids.includes(ac.id)) || !Number.isFinite(task.estimate_hours) || task.estimate_hours <= 0) throw new Error("Every task requires a known story and positive estimate_hours.");
  const milestones = bounded(quality.milestones, "Milestones"); const milestoneIds = new Set(); const coveredTasks = new Set();
  const taskMap = new Map(contract.tasks.map((task) => [task.id, task])); const dates = new Map();
  for (const milestone of milestones) {
    deliveryId(milestone.id); if (milestoneIds.has(milestone.id)) throw new Error("Milestone IDs must be unique."); milestoneIds.add(milestone.id);
    const parseUTC = (value) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
      const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return NaN;
      return new Date(parsed).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value) ? parsed : NaN;
    };
    const start = parseUTC(milestone.start); const end = parseUTC(milestone.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(milestone.capacity_hours) || milestone.capacity_hours <= 0) throw new Error("Milestone dates/capacity are invalid.");
    let estimate = 0;
    for (const id of bounded(milestone.task_ids, "Milestone tasks")) { if (!taskMap.has(id) || coveredTasks.has(id)) throw new Error("Milestone task is unknown or scheduled twice."); coveredTasks.add(id); estimate += taskMap.get(id).estimate_hours; dates.set(id, { start, end }); }
    if (estimate > milestone.capacity_hours) throw new Error("Milestone exceeds declared capacity.");
  }
  if (coveredTasks.size !== contract.tasks.length) throw new Error("Timeline must schedule every task.");
  for (const task of contract.tasks) for (const dep of task.depends_on) if (dates.get(dep).end > dates.get(task.id).start) throw new Error("Timeline overlaps a task's prerequisite.");
}
export function productionHarnessReport(contract, verifiedChecks = [], executions = []) {
  const verified = new Set(verifiedChecks);
  const measurements = (contract?.schema_version === 2 ? contract.quality.measurements : []).map((measure) => {
    const receipt = executions.find((item) => item.check_id === measure.check_id);
    const observed = receipt?.measurements?.filter((item) => item.id === measure.id) ?? [];
    const value = observed.length === 1 ? observed[0] : null;
    const bound = value && value.unit === measure.unit && value.workload === measure.workload && value.environment === measure.environment && Number.isFinite(value.value) && value.value >= 0;
    const passed = bound && (measure.comparison === "LTE" ? value.value <= measure.limit : value.value >= measure.limit);
    return { ...measure, status: !value ? "NOT_TESTED" : passed ? "LOCAL_MEASURED" : "FAILED", observed: value?.value ?? null, receipt_hash: receipt?.receipt_hash ?? null };
  });
  const controls = PRODUCTION_RULES.map((rule) => {
    const c = contract?.schema_version === 2 ? contract.quality?.controls.find((item) => item.id === rule.id) : null;
    return { ...rule, document_id: c?.document_id ?? null, sources: c?.sources ?? [], standard: `${PRODUCTION_POLICY}/${rule.id}`, status: measurements.some((m) => m.control_id === rule.id && m.status === "FAILED") ? "FAILED" : measurements.some((m) => m.control_id === rule.id && m.status === "NOT_TESTED") ? "NOT_TESTED" : !c ? "MISSING" : c.applicability === "NOT_APPLICABLE" ? "EXCLUDED_WITH_RATIONALE" : rule.executable ? c.check_ids.every((check) => verified.has(check)) ? "LOCAL_EXECUTED" : "NOT_TESTED" : "DOCUMENT_BOUND", missing_checks: c?.check_ids?.filter((check) => !verified.has(check)) ?? [], rationale: c?.rationale ?? null };
  });
  return { policy: PRODUCTION_POLICY, reference_standards: [{ id: "NIST-SSDF", version: "1.1", url: "https://csrc.nist.gov/pubs/sp/800/218/final" }, { id: "OWASP-ASVS", version: "5.0.0", url: "https://github.com/OWASP/ASVS/tree/v5.0.0" }, { id: "OpenAPI", version: "3.1.1", url: "https://spec.openapis.org/oas/v3.1.1.html" }], contract_version: contract?.schema_version ?? null, stack: contract?.schema_version === 2 ? contract.quality.stack : null, budget: contract?.schema_version === 2 ? contract.quality.budget : null, measurements, controls, evidence_complete: controls.every((c) => !["MISSING", "NOT_TESTED", "FAILED"].includes(c.status)), limitation: "DOCUMENT_BOUND verifies required declarations and source hashes, not semantic correctness. LOCAL_EXECUTED resolves current passing check receipts, not independent analysis of their adequacy. Numeric performance/memory evidence requires matching observations captured from command JSON stdout and satisfying the bound; adequacy of the measuring command still requires review. Exclusions require independent review. This internal policy is not SSDF/ASVS certification or live production evidence." };
}

export function inspectProductionHarness(root, id) {
  const task = readDeliveryJson(root, `.ai-agent-kit/runtime/tasks/${deliveryId(id)}.json`);
  const contract = readDeliveryJson(root, task.product_contract.path);
  const inputHash = deliveryInput(root, id);
  validateProductionHarness(root, contract);
  const flow = readDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`);
  const copy = { ...flow }; delete copy.flow_hash;
  if (deliveryDigest(copy) !== flow.flow_hash || !Array.isArray(flow.executions) || flow.executions.length > 1000) throw new Error("Product flow integrity failed.");
  const latest = new Map();
  for (const hash of flow.executions) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Execution history hash is invalid.");
    const receipt = readDeliveryJson(root, `.ai-agent-kit/runtime/executions/${id}/${hash}.json`);
    const unsigned = { ...receipt }; delete unsigned.receipt_hash;
    if (deliveryDigest(unsigned) !== hash) throw new Error("Execution history integrity failed.");
    latest.set(receipt.check_id, hash);
  }
  const executions = [];
  for (const hash of latest.values()) { try { executions.push(verifyExecutionEvidence(root, id, hash, inputHash)); } catch { /* Failed/stale latest evidence never falls back to an older pass. */ } }
  return productionHarnessReport(contract, executions.map((execution) => execution.check_id), executions);
}
