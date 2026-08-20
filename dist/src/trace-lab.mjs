import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";

const SCENARIOS = {
  "production-bug": { injected: "missed failure path", gate: "final-review", input: { high_findings: 1, fix_evidence: true }, fix: "add atomic cleanup and regression evidence" },
  "security-escape": { injected: "plugin path escape", gate: "plugin-authority", input: { requested: ["repo/**"], allowed: ["src/**"], tampered: true }, fix: "restrict effective path intersection" },
  "parent-drift": { injected: "parent branch changed", gate: "parent-drift", input: { baseline: "abc", current: "def", sync_approved: false }, fix: "refresh baseline and request sync approval" },
  "incomplete-evidence": { injected: "tests pass but review evidence is missing", gate: "release-readiness", input: { tests_passed: true, review_passed: false, fix_evidence: true }, fix: "run fresh independent review" },
  "agent-crash": { injected: "writer interrupted after checkpoint", gate: "run-recovery", input: { interrupted: true, ledger_verified: true, writer_reconciled: true }, fix: "verify ledger and resume from immutable handoff" },
  "conflicting-findings": { injected: "reviewers disagree", gate: "team-context", input: { conflict_count: 1, human_decision: false }, fix: "record evidence-bound conflict resolution" }
};

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function escape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

function evaluateGate(scenario) {
  const input = scenario.input;
  if (scenario.gate === "final-review") return { decision: input.high_findings ? "RETURN_FOR_FIX" : "PASS", recovered: input.high_findings > 0 && input.fix_evidence };
  if (scenario.gate === "plugin-authority") { const allowed = new Set(input.allowed); const escaped = input.requested.some((value) => !allowed.has(value)); return { decision: escaped || input.tampered ? "DENY_AND_QUARANTINE" : "ALLOW", recovered: escaped || input.tampered };
  }
  if (scenario.gate === "parent-drift") { const drifted = input.baseline !== input.current; return { decision: drifted && !input.sync_approved ? "BLOCK_WRITER_DISPATCH" : "ALLOW", recovered: !drifted || input.sync_approved }; }
  if (scenario.gate === "release-readiness") return { decision: input.tests_passed && !input.review_passed ? "NOT_READY" : "READY", recovered: input.fix_evidence };
  if (scenario.gate === "run-recovery") return { decision: input.interrupted ? "PAUSE_AND_RECONCILE" : "CONTINUE", recovered: input.ledger_verified && input.writer_reconciled };
  return { decision: input.conflict_count && !input.human_decision ? "HUMAN_DECISION_REQUIRED" : "RESOLVED", recovered: Boolean(input.human_decision) };
}

export function listTraceLabScenarios() { return Object.entries(SCENARIOS).map(([id, scenario]) => { const evaluated = evaluateGate(scenario); return { id, injected_failure: scenario.injected, expected_gate: scenario.gate, expected_decision: evaluated.decision }; }); }

export function runTraceLab(options = {}) {
  const id = options.scenario ?? "production-bug";
  const scenario = SCENARIOS[id];
  if (!scenario) throw new Error(`unknown TraceLab scenario: ${id}`);
  const evaluated = evaluateGate(scenario);
  const timeline = [
    ["Task", "COMPLETE", "Bounded synthetic fixture"],
    ["Plan", "COMPLETE", "Risk and rollback recorded"],
    ["Approve", "COMPLETE", "Synthetic approval fixture"],
    ["Execute", "FAILED", scenario.injected],
    ["Gate", evaluated.decision.includes("DENY") || evaluated.decision.includes("BLOCK") ? "BLOCKED" : "RETURNED", `${scenario.gate}: ${evaluated.decision}`],
    ["Fix", evaluated.recovered ? "COMPLETE" : "AWAITING_HUMAN", scenario.fix],
    ["Verify", evaluated.recovered ? "PASSED" : "BLOCKED", evaluated.recovered ? "Fresh evidence accepted" : "Protected work remains stopped"],
    ["Report", evaluated.recovered ? "READY" : "NOT_READY", "Synthetic evidence, never production proof"]
  ].map(([stage, status, detail], offset) => ({ offset: offset + 1, stage, status, detail }));
  const report = { schema_version: 1, fixture_type: "SYNTHETIC_OFFLINE_DEMO", scenario: id, injected_failure: scenario.injected, evaluated_gate: scenario.gate, policy_decision: evaluated.decision, recovered: evaluated.recovered, network_required: false, contains_source: false, contains_prompts: false, contains_secrets: false, timeline };
  return { ...report, report_hash: hash(report) };
}

export function renderTraceLabHtml(report) {
  const nodes = report.timeline.map((item) => `<article class="node ${item.status.toLowerCase()}"><span>${item.offset}</span><h2>${escape(item.stage)}</h2><b>${escape(item.status)}</b><p>${escape(item.detail)}</p></article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>TraceLab · ${escape(report.scenario)}</title><style>:root{color-scheme:dark;--bg:#07111f;--panel:#101d2d;--line:#29405a;--text:#f7f9fc;--muted:#9fb0c4;--good:#49d49d;--bad:#ff7784;--warn:#ffc66d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#173864,transparent 36%),var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}.shell{width:min(1200px,calc(100% - 32px));margin:auto;padding:48px 0}.tag{font:700 12px ui-monospace,monospace;color:#76b2ff;letter-spacing:.14em}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin:12px 0 34px}.hero h1{font-size:clamp(38px,7vw,72px);line-height:.95;letter-spacing:-.06em;margin:0}.hero p{color:var(--muted);max-width:420px}.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.node{min-height:170px;padding:18px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(160deg,#12243a,var(--panel))}.node span{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--line);border-radius:9px}.node h2{margin:22px 0 5px}.node b{font-size:11px;color:var(--warn)}.node.passed b,.node.ready b,.node.complete b{color:var(--good)}.node.failed b,.node.blocked b,.node.not_ready b{color:var(--bad)}.node p{color:var(--muted);font-size:13px}.proof{margin-top:20px;padding:18px;border:1px solid var(--line);border-radius:14px;color:var(--muted);font:12px ui-monospace,monospace;word-break:break-all}@media(max-width:800px){.flow{grid-template-columns:repeat(2,1fr)}.hero{display:block}}@media(max-width:480px){.flow{grid-template-columns:1fr}}@media(prefers-reduced-motion:no-preference){.node{animation:up .35s ease both}@keyframes up{from{opacity:0;transform:translateY(8px)}}}</style></head><body><main class="shell"><div class="tag">TRACELAB · SYNTHETIC OFFLINE PROOF</div><section class="hero"><h1>Fail safely.<br>Recover clearly.</h1><p>${escape(report.injected_failure)}. The real control states explain what stopped, what changed, and why the result is ${report.recovered ? "ready" : "still blocked"}.</p></section><section class="flow">${nodes}</section><div class="proof">${escape(report.report_hash)} · No source · No prompts · No secrets · No network</div></main></body></html>`;
}

export function writeTraceLab(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const report = runTraceLab(options);
  const relative = options.output ?? `.ai-agent-kit/tracelab/${report.scenario}`;
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..") || hasSymlinkComponent(root, relative)) throw new Error("TraceLab output must remain inside the repository");
  const output = path.join(root, relative);
  const local = path.join(root, ".ai-agent-kit");
  fs.mkdirSync(local, { recursive: true, mode: 0o700 });
  const ignore = path.join(local, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n!.gitignore\n", { mode: 0o600 });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const files = { json: path.join(output, "report.json"), html: path.join(output, "index.html") };
  fs.writeFileSync(files.json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(files.html, renderTraceLabHtml(report), { mode: 0o600 });
  return { status: report.recovered ? "RECOVERED" : "BLOCKED_AS_DESIGNED", scenario: report.scenario, report_hash: report.report_hash, files };
}

function proportion(value, total) { return total ? value / total : null; }

export function evaluateReliabilityBenchmark(fixture) {
  if (!fixture || fixture.schema_version !== 1 || !Array.isArray(fixture.runs) || !fixture.runs.length) throw new Error("benchmark fixture requires schema_version 1 and runs");
  const countFields = ["requirements_met", "requirements_total", "regressions", "escaped_findings", "trace_items_present", "trace_items_required", "elapsed_seconds", "tokens"];
  fixture.runs.forEach((run, index) => {
    if (!run.configuration || !["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(run.status)) throw new Error(`benchmark run ${index + 1} has an invalid configuration or status`);
    for (const field of countFields) if (!Number.isFinite(run[field]) || run[field] < 0) throw new Error(`benchmark run ${index + 1} has invalid ${field}`);
    if (run.requirements_met > run.requirements_total || run.trace_items_present > run.trace_items_required) throw new Error(`benchmark run ${index + 1} has a numerator larger than its denominator`);
    if (run.estimated_cost_usd != null && (!Number.isFinite(run.estimated_cost_usd) || run.estimated_cost_usd < 0)) throw new Error(`benchmark run ${index + 1} has invalid estimated cost`);
  });
  const groups = Object.groupBy ? Object.groupBy(fixture.runs, (run) => run.configuration) : fixture.runs.reduce((result, run) => { (result[run.configuration] ??= []).push(run); return result; }, {});
  const configurations = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([configuration, runs]) => {
    const completed = runs.filter((run) => run.status === "COMPLETED");
    const sum = (key) => completed.reduce((total, run) => total + Number(run[key] ?? 0), 0);
    return { configuration, sample_size: runs.length, completed: completed.length, failed_or_timed_out: runs.length - completed.length, requirement_coverage: proportion(sum("requirements_met"), sum("requirements_total")), regressions: sum("regressions"), escaped_findings: sum("escaped_findings"), trace_completeness: proportion(sum("trace_items_present"), sum("trace_items_required")), recovery_success_rate: proportion(completed.filter((run) => run.recovery_required).filter((run) => run.recovery_succeeded).length, completed.filter((run) => run.recovery_required).length), elapsed_seconds: sum("elapsed_seconds"), tokens: sum("tokens"), estimated_cost_usd: completed.every((run) => Number.isFinite(run.estimated_cost_usd)) ? sum("estimated_cost_usd") : null, limitations: [...new Set(runs.flatMap((run) => run.limitations ?? []))] };
  });
  const result = { schema_version: 1, status: configurations.length >= 2 ? "MEASURED" : "INSUFFICIENT_COMPARISON", fixture_id: fixture.fixture_id, measured_at: fixture.measured_at ?? null, environment: fixture.environment ?? null, claims_boundary: "Results describe this fixture, model, host, settings, date, and sample only; they do not prove universal superiority.", configurations };
  return { ...result, result_hash: hash(result) };
}
