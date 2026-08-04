import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";

export const METRIC_DEFINITIONS = Object.freeze({
  verified_task_success_rate: { unit: "ratio", numerator: "verified successful tasks", denominator: "completed tasks with verification evidence", exclusions: ["tasks without completion evidence"] },
  scope_violation_rate: { unit: "ratio", numerator: "tasks with a scope violation", denominator: "tasks with a scope decision", exclusions: ["tasks without scope evidence"] },
  median_review_time_ms: { unit: "milliseconds", calculation: "median review duration", denominator: "tasks with review duration", exclusions: ["missing or negative durations"] },
  rework_rate: { unit: "ratio", numerator: "tasks requiring rework", denominator: "completed tasks reporting rework", exclusions: ["tasks without rework status"] },
  rollback_rate: { unit: "ratio", numerator: "tasks rolled back", denominator: "released tasks reporting rollback status", exclusions: ["unreleased tasks", "missing rollback status"] },
  action_allow_rate: { unit: "ratio", numerator: "allowed action decisions", denominator: "all recorded action decisions", exclusions: [] },
  average_eval_score: { unit: "score", calculation: "arithmetic mean", denominator: "tasks with eval score", exclusions: ["missing eval scores"] },
  average_cost_usd: { unit: "USD", calculation: "arithmetic mean", denominator: "tasks with evidence-backed cost", exclusions: ["unavailable cost"] },
  average_action_count: { unit: "actions", calculation: "arithmetic mean", denominator: "tasks with action count", exclusions: ["missing action counts"] }
});

const ALLOWED = new Set(["task_hash", "completed", "verified", "scope_violation", "review_time_ms", "rework", "released", "rollback", "action_decisions", "eval_score", "cost_usd", "action_count", "recorded_at"]);

function analyticsFile(root) {
  const resolved = path.resolve(root);
  const rel = ".ai-agent-kit/runtime/analytics/outcomes.jsonl";
  if (hasSymlinkComponent(resolved, rel)) throw new Error(`refusing analytics access through a symbolic link: ${rel}`);
  return path.join(resolved, rel);
}

function hashId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function append(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function recordOutcome(options) {
  if (!options.taskId) throw new Error("outcome record requires taskId");
  const input = options.event ?? {};
  const denied = Object.keys(input).filter((key) => !ALLOWED.has(key));
  if (denied.length) throw new Error(`privacy boundary rejects outcome fields: ${denied.join(", ")}`);
  for (const key of ["completed", "verified", "scope_violation", "rework", "released", "rollback"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new Error(`${key} must be boolean`);
  }
  for (const key of ["review_time_ms", "cost_usd", "action_count"]) {
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0)) throw new Error(`${key} must be a non-negative number`);
  }
  if (input.eval_score !== undefined && (!Number.isFinite(input.eval_score) || input.eval_score < 0 || input.eval_score > 1)) throw new Error("eval_score must be between 0 and 1");
  if (input.action_decisions !== undefined && (!Array.isArray(input.action_decisions) || input.action_decisions.some((value) => !["allow", "ask", "deny"].includes(value)))) throw new Error("action_decisions must contain allow, ask, or deny");
  const event = { schema_version: 1, task_hash: hashId(options.taskId), recorded_at: new Date().toISOString() };
  for (const key of ALLOWED) if (key !== "task_hash" && key !== "recorded_at" && input[key] !== undefined) event[key] = input[key];
  if (JSON.stringify(event).match(/(prompt|source|secret|email|name|token|content|path)/i)) throw new Error("outcome event contains a prohibited field");
  append(analyticsFile(options.target ?? process.cwd()), event);
  return event;
}

function events(root) {
  const file = analyticsFile(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`invalid outcome analytics JSON at line ${index + 1}`); }
  });
}

function ratio(items, numerator) {
  return { value: items.length ? items.filter(numerator).length / items.length : null, numerator: items.filter(numerator).length, denominator: items.length, missing: items.length === 0 };
}

function average(values) {
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, denominator: values.length, missing: values.length === 0 };
}

export function summarizeOutcomes(options = {}) {
  const rows = events(options.target ?? process.cwd());
  const completed = rows.filter((row) => row.completed === true && typeof row.verified === "boolean");
  const scope = rows.filter((row) => typeof row.scope_violation === "boolean");
  const review = rows.map((row) => row.review_time_ms).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const rework = rows.filter((row) => row.completed === true && typeof row.rework === "boolean");
  const rollback = rows.filter((row) => row.released === true && typeof row.rollback === "boolean");
  const actions = rows.flatMap((row) => Array.isArray(row.action_decisions) ? row.action_decisions : []);
  const numeric = (key) => rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  return {
    schema_version: 1,
    metric_definition_version: "1.0.0",
    privacy: { mode: "local-only", export: "disabled-by-default", prohibited: ["source", "prompts", "secrets", "direct-personal-identifiers"] },
    sample_size: rows.length,
    definitions: METRIC_DEFINITIONS,
    metrics: {
      verified_task_success_rate: ratio(completed, (row) => row.verified),
      scope_violation_rate: ratio(scope, (row) => row.scope_violation),
      median_review_time_ms: { value: review.length ? (review[Math.floor((review.length - 1) / 2)] + review[Math.floor(review.length / 2)]) / 2 : null, denominator: review.length, missing: review.length === 0 },
      rework_rate: ratio(rework, (row) => row.rework),
      rollback_rate: ratio(rollback, (row) => row.rollback),
      action_allow_rate: ratio(actions, (decision) => decision === "allow"),
      average_eval_score: average(numeric("eval_score")),
      average_cost_usd: average(numeric("cost_usd")),
      average_action_count: average(numeric("action_count"))
    }
  };
}

export function compareOutcomes({ baseline, current, minimumSample = 10 }) {
  const result = { schema_version: 1, baseline_sample_size: baseline.sample_size, current_sample_size: current.sample_size, claims_allowed: baseline.sample_size >= minimumSample && current.sample_size >= minimumSample, metrics: {} };
  for (const key of Object.keys(METRIC_DEFINITIONS)) {
    const before = baseline.metrics[key]?.value ?? null;
    const after = current.metrics[key]?.value ?? null;
    result.metrics[key] = { baseline: before, current: after, delta: before == null || after == null ? null : after - before };
  }
  result.claim_blockers = result.claims_allowed ? [] : [`at least ${minimumSample} baseline and current observations are required`];
  return result;
}
