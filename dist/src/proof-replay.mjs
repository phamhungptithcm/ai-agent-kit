import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";
import { memoryHealth } from "./memory-lifecycle.mjs";
import { loadRepositoryPolicyOverlays } from "./policy-overlays.mjs";
import { getPackageVersion } from "./version.mjs";
import { verifyArchitectureArtifact } from "./system-design.mjs";
import { inspectTeam, reportTeam } from "./team-orchestrator.mjs";
import { buildFinalTaskReport } from "./task-report.mjs";

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("proof task id must be 1-128 safe characters");
  return value;
}

function guarded(root, suffix) {
  const rel = `.ai-agent-kit/runtime/${suffix}`;
  if (hasSymlinkComponent(root, rel)) throw new Error(`refusing proof access through a symbolic link: ${rel}`);
  return path.join(root, rel);
}

function readJson(file, label, required = false) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`${label} is missing`);
    return null;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} contains invalid JSON`); }
}

function readJsonl(file, label) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file`);
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`${label} contains invalid JSON at line ${index + 1}`); }
  });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function latestBy(items, key) {
  const result = new Map();
  for (const item of items) result.set(item[key], item);
  return [...result.values()];
}

function proofStatus(report, architecture) {
  const blockers = [...report.production_readiness.blockers];
  if (architecture && architecture.status !== "VERIFIED") blockers.push(`Architecture evidence is ${architecture.status}.`);
  return { status: blockers.length ? "NOT_READY" : "READY", blockers };
}

function architecturePath(root, id) {
  const rel = `.ai-agent-kit/architecture/designs/${id}/architecture.json`;
  if (hasSymlinkComponent(root, rel)) throw new Error(`refusing architecture proof access through a symbolic link: ${rel}`);
  return path.join(root, rel);
}

export function buildProofReplay(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const id = safeId(options.id);
  const task = readJson(guarded(root, `tasks/${id}.json`), "task record", true);
  const receipts = readJsonl(guarded(root, `evidence/${id}.jsonl`), "evidence ledger");
  const report = buildFinalTaskReport({ ...options, target: root, id, productionTarget: true }, deps);
  const commitResult = (deps.spawnSync ?? spawnSync)("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  const currentCommit = commitResult.status === 0 ? commitResult.stdout.trim() : null;
  const checks = report.quality.gates;
  const review = report.final_review;
  const policies = loadRepositoryPolicyOverlays({ target: root, kitVersion: getPackageVersion() });
  const memory = memoryHealth({ target: root });
  const architectureArtifact = readJson(architecturePath(root, id), "architecture artifact");
  const architecture = architectureArtifact ? { ...verifyArchitectureArtifact(architectureArtifact, { repositoryCommit: currentCommit }), request_hash: architectureArtifact.request?.request_hash ?? null, model_hash: architectureArtifact.model?.model_hash ?? null } : null;
  let team = null;
  try { const contract = inspectTeam({ target: root, id }); const report = reportTeam({ target: root, id }); team = { ...report, state: contract.state, assignment_statuses: contract.assignments.map((item) => ({ id: item.id, role: item.role, status: item.status, write_access: item.write_access, finding_count: item.finding_count })), review_cycles: contract.result_history.filter((item) => item.assignment_id === "independent-reviewer").length }; } catch (error) { if (!/team contract is missing/.test(error.message)) throw error; }
  const policyDecisions = receipts.filter((item) => item.type === "policy.decision").map((item) => ({ decision: item.data?.decision, reason_code: item.data?.reason_code, timestamp: item.timestamp, receipt_hash: item.receipt_hash }));
  const actions = receipts.filter((item) => item.type === "action.execution").map((item) => ({ status: item.data?.status, reason_code: item.data?.reason_code ?? null, timestamp: item.timestamp, receipt_hash: item.receipt_hash }));
  const timeline = [
    { stage: "Understand", status: task.goal ? "complete" : "missing", detail: task.goal ? "Goal contract recorded" : "Goal missing" },
    { stage: "Inspect", status: task.context?.facts?.length ? "complete" : "limited", detail: `${task.context?.facts?.length ?? 0} grounded facts` },
    { stage: "Plan", status: task.plan?.steps?.length ? "complete" : "missing", detail: `${task.plan?.steps?.length ?? 0} planned steps` },
    { stage: "Approve", status: task.capability?.approval_hash ? "complete" : "limited", detail: task.capability?.approval_hash ? "Capability bound to approval" : "No approval hash" },
    { stage: "Execute", status: actions.length ? "complete" : "limited", detail: `${actions.length} execution receipts` },
    { stage: "Verify", status: checks.some((item) => item.status === "PASSED") ? "complete" : "limited", detail: `${checks.filter((item) => item.status === "PASSED").length}/${checks.length} checks passed` },
    { stage: "Review", status: review.status === "PASSED" ? "complete" : "blocked", detail: `${review.cycle_count ?? 0} cycles · ${review.finding_history?.length ?? review.findings?.length ?? 0} findings` },
    { stage: "Report", status: ["REVIEW_READY", "RELEASED"].includes(task.state) ? "complete" : "blocked", detail: `Task state ${task.state}` }
  ];
  const evidenceIntegrity = report.evidence;
  const readiness = proofStatus(report, architecture);
  const proof = {
    schema_version: 1,
    generated_at: task.updated_at ?? receipts.at(-1)?.timestamp ?? new Date(0).toISOString(),
    privacy: { mode: "redacted", contains_source: false, contains_prompts: false, contains_secrets: false, contains_raw_logs: false },
    task: { id, goal: `Governed task ${id}`, goal_hash: task.goal ? hash(task.goal) : null, state: task.state, adapter: task.capability?.agent_adapter ?? "unknown", action_count: task.action_count ?? actions.length },
    readiness,
    timeline,
    policy: { effective_rule_count: Object.keys(policies.provenance).length, sources: [...new Set(Object.values(policies.provenance).map((item) => `${item.layer}:${item.bundle_id}@${item.version}`))], decisions: policyDecisions },
    quality: { checks, review: { status: review.status, stale: Boolean(review.stale), cycles: review.cycle_count ?? 0, findings: (review.finding_history ?? review.findings ?? []).map((item) => ({ id: item.id, cycle: item.cycle ?? null, severity: item.severity, status: item.status, category: item.category, summary: `${item.category} finding reviewed`, resolution: item.resolution ? "Resolution evidence recorded" : null })), residual_risk_count: review.residual_risks?.length ?? 0, limitation_count: review.limitations?.length ?? 0 } },
    memory: { status: memory.status, total: memory.total, counts: memory.counts, conflict_count: memory.conflicts?.length ?? 0 },
    architecture,
    team,
    evidence: { ...evidenceIntegrity, receipt_count: receipts.length, latest_receipt_hash: receipts.at(-1)?.receipt_hash ?? null },
    actions
  };
  proof.proof_hash = hash(proof);
  return proof;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function icon(stage) {
  return { Understand: "◎", Inspect: "⌕", Plan: "◇", Approve: "◆", Execute: "▶", Verify: "✓", Review: "↻", Report: "▣" }[stage] ?? "•";
}

export function renderProofReplayHtml(proof) {
  const ready = proof.readiness.status === "READY";
  const checks = proof.quality.checks.map((item) => `<div class="row"><span>${escapeHtml(item.gate)}</span><b class="${item.status === "PASSED" ? "good" : "warn"}">${escapeHtml(item.status)}</b></div>`).join("") || '<p class="muted">No quality checks recorded.</p>';
  const findings = proof.quality.review.findings.map((item) => `<article class="finding"><div><b>${escapeHtml(item.id)}</b><span class="severity">${escapeHtml(item.severity)}</span></div><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(item.status)}${item.resolution ? ` · ${escapeHtml(item.resolution)}` : ""}</small></article>`).join("") || '<p class="muted">No findings recorded.</p>';
  const blockers = proof.readiness.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>All configured readiness gates have current evidence.</li>";
  const architecture = proof.architecture ? `<div class="row"><span>Verification</span><b class="${proof.architecture.status === "VERIFIED" ? "good" : "warn"}">${escapeHtml(proof.architecture.status)}</b></div><div class="row"><span>Artifact</span><b>${escapeHtml(proof.architecture.artifact_hash?.slice(0, 12) ?? "UNAVAILABLE")}</b></div><div class="row"><span>Request</span><b>${escapeHtml(proof.architecture.request_hash?.slice(0, 12) ?? "UNAVAILABLE")}</b></div><div class="row"><span>Capacity model</span><b>${escapeHtml(proof.architecture.model_hash?.slice(0, 12) ?? "UNAVAILABLE")}</b></div>` : '<p class="muted">No architecture artifact applies to this task.</p>';
  const team = proof.team ? `<div class="row"><span>Workcell</span><b>${escapeHtml(proof.team.team_type)}</b></div><div class="row"><span>Execution</span><b>${escapeHtml(proof.team.execution_mode)}</b></div><div class="row"><span>Assignments</span><b>${proof.team.completed_assignments}/${proof.team.total_assignments}</b></div><div class="row"><span>Shared handoffs</span><b>${proof.team.context?.handoff_count ?? 0}</b></div><div class="row"><span>Open conflicts</span><b class="${proof.team.context?.open_conflicts ? "warn" : "good"}">${proof.team.context?.open_conflicts ?? 0}</b></div><div class="row"><span>Review independence</span><b class="${proof.team.review_independence === "VERIFIED" ? "good" : "warn"}">${escapeHtml(proof.team.review_independence)}</b></div>` : '<p class="muted">This task used the standard single-agent path.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><link rel="icon" href="data:,"><title>Agent Proof · ${escapeHtml(proof.task.id)}</title><style>
:root{color-scheme:dark;--bg:#071019;--panel:#0d1925;--line:#223448;--text:#f3f7fb;--muted:#93a6ba;--blue:#65a9ff;--green:#46d99a;--amber:#f5bd62;--red:#ff6b7a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% -10%,#163661 0,transparent 35%),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{width:min(1180px,calc(100% - 32px));margin:auto;padding:48px 0 64px}.eyebrow{color:var(--blue);font-weight:750;letter-spacing:.14em;text-transform:uppercase;font-size:12px}.hero{display:flex;justify-content:space-between;gap:32px;align-items:end;margin:10px 0 34px}.hero h1{font-size:clamp(34px,6vw,64px);line-height:1;letter-spacing:-.055em;margin:0;max-width:760px}.hero p{color:var(--muted);max-width:370px;margin:0}.status{display:inline-flex;gap:9px;align-items:center;padding:9px 14px;border:1px solid;border-radius:999px;font-weight:800;font-size:13px}.status.ready{color:var(--green);border-color:#28664e;background:#102b22}.status.blocked{color:var(--red);border-color:#68323c;background:#2b151b}.timeline{display:grid;grid-template-columns:repeat(8,1fr);gap:10px;margin:0 0 18px}.node{position:relative;min-height:128px;padding:18px 14px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(180deg,#102031,#0b1722)}.node:after{content:'→';position:absolute;right:-10px;top:49px;color:#526a82;z-index:2}.node:last-child:after{display:none}.node i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#172c41;color:var(--blue);font-style:normal;font-size:20px}.node h3{margin:16px 0 4px;font-size:14px}.node p{margin:0;color:var(--muted);font-size:11px}.node.complete{border-color:#275941}.node.blocked{border-color:#6a3440}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:18px}.card{border:1px solid var(--line);background:rgba(13,25,37,.92);border-radius:18px;padding:22px}.card h2{margin:0 0 16px;font-size:17px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{padding:18px;border:1px solid var(--line);border-radius:15px;background:#0a1520}.stat strong{display:block;font-size:28px;letter-spacing:-.04em}.stat span,.muted{color:var(--muted)}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #192b3d}.row:last-child{border:0}.good{color:var(--green)}.warn{color:var(--amber)}.finding{padding:13px 0;border-bottom:1px solid #192b3d}.finding div{display:flex;justify-content:space-between}.finding p{margin:6px 0}.finding small,.severity{color:var(--muted)}ul{padding-left:18px;margin:0}.footer{margin-top:18px;color:var(--muted);font:12px ui-monospace,SFMono-Regular,monospace;word-break:break-all}@media(max-width:900px){.timeline{grid-template-columns:repeat(4,1fr)}.node:nth-child(4):after{display:none}.grid{grid-template-columns:1fr}.hero{display:block}.hero p{margin-top:20px}}@media(max-width:560px){.shell{width:min(100% - 20px,1180px);padding-top:28px}.timeline{grid-template-columns:repeat(2,1fr)}.node:nth-child(even):after{display:none}.stats{grid-template-columns:repeat(2,1fr)}.card{padding:17px}}@media(prefers-reduced-motion:no-preference){.card,.node{animation:up .45s ease both}.node{animation-delay:calc(var(--i)*45ms)}@keyframes up{from{opacity:0;transform:translateY(8px)}}}
</style></head><body><main class="shell"><div class="eyebrow">Agent Proof Replay · ${escapeHtml(proof.task.adapter)}</div><section class="hero"><div><h1>${escapeHtml(proof.task.goal ?? proof.task.id)}</h1></div><div><span class="status ${ready ? "ready" : "blocked"}">${ready ? "✓ READY" : "× NOT READY"}</span><p>Evidence, policy decisions, review cycles, and readiness—without source, prompts, secrets, or raw logs.</p></div></section><section class="timeline">${proof.timeline.map((item, index) => `<article class="node ${item.status}" style="--i:${index}"><i>${icon(item.stage)}</i><h3>${item.stage}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</section><section class="stats"><div class="stat"><strong>${proof.evidence.receipt_count}</strong><span>receipts</span></div><div class="stat"><strong>${proof.quality.review.cycles}</strong><span>review cycles</span></div><div class="stat"><strong>${proof.quality.review.findings.length}</strong><span>findings</span></div><div class="stat"><strong>${proof.task.action_count}</strong><span>actions</span></div></section><section class="grid"><div class="card"><h2>Quality gates</h2>${checks}</div><div class="card"><h2>Readiness</h2><ul>${blockers}</ul></div><div class="card"><h2>Review findings</h2>${findings}</div><div class="card"><h2>Engineering team</h2>${team}</div><div class="card"><h2>Architecture evidence</h2>${architecture}</div><div class="card"><h2>Trust context</h2><div class="row"><span>Effective policy rules</span><b>${proof.policy.effective_rule_count}</b></div><div class="row"><span>Policy decisions</span><b>${proof.policy.decisions.length}</b></div><div class="row"><span>Memory health</span><b class="${proof.memory.status === "HEALTHY" ? "good" : "warn"}">${proof.memory.status}</b></div><div class="row"><span>Memory conflicts</span><b>${proof.memory.conflict_count}</b></div></div></section><div class="footer">Proof ${proof.proof_hash} · Generated ${escapeHtml(proof.generated_at)}</div></main></body></html>`;
}

export function renderProofCard(proof) {
  const mark = proof.readiness.status === "READY" ? "✅" : "⛔";
  return `## ${mark} AI Change Assurance\n\n| Gate | Result |\n| --- | --- |\n| Scope & policy | ${proof.policy.decisions.some((item) => item.decision === "deny") ? "⚠️ Review required" : "✅ Verified"} |\n| Quality checks | ${proof.quality.checks.filter((item) => item.status === "PASSED").length}/${proof.quality.checks.length} passed |\n| Final review | ${proof.quality.review.status} · ${proof.quality.review.cycles} cycles |\n| Findings | ${proof.quality.review.findings.length} recorded |\n| Memory | ${proof.memory.status} |\n| Architecture | ${proof.architecture?.status ?? "NOT_APPLICABLE"} |\n| Engineering team | ${proof.team?.status ?? "NOT_APPLICABLE"} |\n| Readiness | **${proof.readiness.status}** |\n\nProof: \`${proof.proof_hash}\`\n`;
}

export function renderTrustBadge(proof) {
  const ready = proof.readiness.status === "READY";
  const label = ready ? "governed ✓" : "not ready";
  const color = ready ? "#16845b" : "#b04452";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="174" height="28" role="img" aria-label="AI Agent Kit: ${label}"><title>AI Agent Kit: ${label}</title><linearGradient id="s" x2="0" y2="100%"><stop stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".08"/></linearGradient><clipPath id="r"><rect width="174" height="28" rx="7"/></clipPath><g clip-path="url(#r)"><rect width="98" height="28" fill="#142334"/><rect x="98" width="76" height="28" fill="${color}"/><rect width="174" height="28" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Arial,sans-serif" font-size="11" font-weight="600"><text x="49" y="18">AI Agent Kit</text><text x="136" y="18">${label}</text></g></svg>`;
}

export function proofToOtlp(proof) {
  const traceId = proof.proof_hash.slice(0, 32);
  const start = BigInt(new Date(proof.generated_at).getTime()) * 1_000_000n;
  return { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "ai-agent-kit" } }] }, scopeSpans: [{ scope: { name: "@hunpeolabs/ai-agent-kit", version: getPackageVersion() }, spans: proof.timeline.map((item, index) => ({ traceId, spanId: hash(`${proof.proof_hash}:${index}`).slice(0, 16), name: `invoke_agent ${item.stage.toLowerCase()}`, kind: 1, startTimeUnixNano: String(start + BigInt(index) * 1_000_000n), endTimeUnixNano: String(start + BigInt(index + 1) * 1_000_000n), attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "invoke_agent" } }, { key: "gen_ai.agent.name", value: { stringValue: proof.task.adapter } }, { key: "ai_agent.stage", value: { stringValue: item.stage } }, { key: "ai_agent.stage.status", value: { stringValue: item.status } }, { key: "ai_agent.proof.hash", value: { stringValue: proof.proof_hash } }], status: { code: item.status === "blocked" ? 2 : 1 } })) }] }] };
}

export function demoProof() {
  const proof = { schema_version: 1, generated_at: new Date().toISOString(), privacy: { mode: "redacted", contains_source: false, contains_prompts: false, contains_secrets: false, contains_raw_logs: false }, task: { id: "DEMO-001", goal: "Add a guarded account export without leaking private data", state: "REVIEW_READY", adapter: "cross-agent demo", action_count: 7 }, readiness: { status: "READY", blockers: [] }, timeline: [
    ["Understand", "complete", "Goal · scope · risk"], ["Inspect", "complete", "Code · data · impact"], ["Plan", "complete", "Change · tests · rollback"], ["Approve", "complete", "Human gate passed"], ["Execute", "complete", "6 allowed · 1 denied"], ["Verify", "complete", "12 checks passed"], ["Review", "complete", "2 cycles · 2 fixes"], ["Report", "complete", "Evidence ready"]
  ].map(([stage, status, detail]) => ({ stage, status, detail })), policy: { effective_rule_count: 18, sources: ["organization:security@2.1.0", "repository:product@1.4.0"], decisions: [{ decision: "deny", reason_code: "PII_EXPORT_BLOCKED" }, { decision: "allow", reason_code: "SCOPED_EXPORT_APPROVED" }] }, quality: { checks: ["lint", "typecheck", "tests", "security", "privacy", "final-review"].map((gate) => ({ gate, status: "PASSED", required: true, summary: "Current evidence verified" })), review: { status: "PASSED", stale: false, cycles: 2, findings: [{ id: "PRIV-01", severity: "high", status: "FIXED", category: "privacy", summary: "Export included an unapproved identifier.", resolution: "Removed the field and added a regression test." }, { id: "ERR-02", severity: "medium", status: "FIXED", category: "error-handling", summary: "Partial export failure had no recovery path.", resolution: "Added atomic output and cleanup." }], residual_risks: [], limitations: [] } }, memory: { status: "HEALTHY", total: 3, counts: { approved: 3 }, conflict_count: 0 }, evidence: { receipt_count: 24, latest_receipt_hash: "demo-receipt" }, actions: [] };
  proof.proof_hash = hash(proof);
  return proof;
}

export function writeProofArtifacts({ proof, target, output, otlp = false }) {
  const root = path.resolve(target ?? process.cwd());
  const localDirectory = path.join(root, ".ai-agent-kit");
  if (hasSymlinkComponent(root, ".ai-agent-kit")) throw new Error("proof output must remain in a non-symlinked repository path");
  fs.mkdirSync(localDirectory, { recursive: true });
  const ignoreFile = path.join(localDirectory, ".gitignore");
  const requiredIgnores = ["local/", "proof/", "demo/", "runtime/"];
  const existingIgnores = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8").split(/\r?\n/).filter(Boolean) : [];
  fs.writeFileSync(ignoreFile, `${[...new Set([...existingIgnores, ...requiredIgnores])].join("\n")}\n`, { mode: 0o644 });
  const directory = path.resolve(root, output ?? path.join(".ai-agent-kit", "proof", proof.task.id));
  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("proof output must remain in a non-symlinked repository path");
  fs.mkdirSync(directory, { recursive: true });
  const files = { json: path.join(directory, "proof.json"), html: path.join(directory, "index.html"), card: path.join(directory, "proof-card.md"), badge: path.join(directory, "trust-badge.svg") };
  fs.writeFileSync(files.json, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(files.html, renderProofReplayHtml(proof), { mode: 0o600 });
  fs.writeFileSync(files.card, renderProofCard(proof), { mode: 0o600 });
  fs.writeFileSync(files.badge, renderTrustBadge(proof), { mode: 0o600 });
  if (otlp) {
    files.otlp = path.join(directory, "proof.otlp.json");
    fs.writeFileSync(files.otlp, `${JSON.stringify(proofToOtlp(proof), null, 2)}\n`, { mode: 0o600 });
  }
  return { status: "GENERATED", directory, files, proof_hash: proof.proof_hash };
}
