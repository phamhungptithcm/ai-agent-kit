import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";
import { inspectDecisionChronicle, inspectRun } from "./traceability.mjs";
import { pluginTrustCenter } from "./plugin-runtime.mjs";

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function escape(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

export function buildOperatorSnapshot(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const decisions = inspectDecisionChronicle({ target });
  const plugins = pluginTrustCenter({ target });
  const file = path.join(target, ".ai-agent-kit/trace/runs.jsonl");
  if (hasSymlinkComponent(target, ".ai-agent-kit/trace/runs.jsonl")) throw new Error("operator view refuses a symbolic-link run ledger");
  if (fs.existsSync(file)) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("run ledger must be a bounded regular file"); }
  const runs = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
  const runIds = [...new Set(runs.map((record) => record.data.run_id))];
  const latestRuns = runIds.map((runId) => { const run = inspectRun({ target, runId }); const latest = run.events.at(-1); return { run_id_hash: hash(runId), phase: latest.data.phase, offset: latest.offset, head_hash: latest.record_hash, blocker_count: latest.data.blockers?.length ?? 0, repository_status: run.status }; });
  const runAttention = latestRuns.some((run) => run.repository_status !== "CURRENT" || run.blocker_count > 0);
  const base = { schema_version: 1, privacy: { contains_run_ids: false, contains_source: false, contains_prompts: false, contains_secrets: false }, health: decisions.status === "VERIFIED" && plugins.status === "HEALTHY" && !runAttention ? "HEALTHY" : "ATTENTION", decisions: { integrity: decisions.integrity, counts: decisions.counts, total: decisions.decisions.length }, runs: latestRuns, plugins: { status: plugins.status, counts: plugins.counts, items: plugins.plugins.map(({ id, ...plugin }) => ({ id_hash: hash(id), ...plugin })) } };
  return { ...base, snapshot_hash: hash(base) };
}

export function renderOperatorHtml(snapshot) {
  const runs = snapshot.runs.map((run) => `<tr><td>${escape(run.run_id_hash.slice(0, 12))}</td><td>${escape(run.phase)}</td><td>${run.offset}</td><td>${run.blocker_count}</td></tr>`).join("") || '<tr><td colspan="4">No recorded runs.</td></tr>';
  const plugins = snapshot.plugins.items.map((plugin) => `<tr><td>${escape(plugin.id_hash.slice(0, 12))}</td><td>${escape(plugin.state)}</td><td>${escape(plugin.trust)}</td><td>${plugin.risks.length}</td></tr>`).join("") || '<tr><td colspan="4">No installed plugins.</td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>AI Agent Kit Control View</title><style>:root{color-scheme:dark;--bg:#07111d;--panel:#101d2b;--line:#263a50;--text:#f4f7fb;--muted:#98aabd;--green:#45d39a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}.shell{width:min(1100px,calc(100% - 28px));margin:auto;padding:40px 0}.hero{display:flex;justify-content:space-between;gap:20px;align-items:end}.hero h1{font-size:clamp(36px,7vw,70px);line-height:.95;letter-spacing:-.06em;margin:0}.status{color:var(--green);font-weight:800}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px}.card strong{display:block;font-size:34px}.card span{color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;margin-top:14px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:540px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;text-transform:uppercase}.proof{margin-top:18px;color:var(--muted);font:12px ui-monospace,monospace;word-break:break-all}@media(max-width:700px){.hero{display:block}.grid{grid-template-columns:1fr}}</style></head><body><main class="shell"><div class="hero"><h1>Traceability<br>control view</h1><div><div class="status">${escape(snapshot.health)}</div><p>Local · redacted · rebuildable</p></div></div><div class="grid"><div class="card"><strong>${snapshot.decisions.total}</strong><span>decisions</span></div><div class="card"><strong>${snapshot.runs.length}</strong><span>runs</span></div><div class="card"><strong>${snapshot.plugins.counts.total}</strong><span>plugins</span></div></div><section><h2>Runs</h2><table><thead><tr><th>Run hash</th><th>Phase</th><th>Offset</th><th>Blockers</th></tr></thead><tbody>${runs}</tbody></table></section><section><h2>Plugin trust</h2><table><thead><tr><th>Plugin hash</th><th>State</th><th>Trust</th><th>Risks</th></tr></thead><tbody>${plugins}</tbody></table></section><div class="proof">${escape(snapshot.snapshot_hash)} · Derived view, never the source of truth</div></main></body></html>`;
}

export function writeOperatorView(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const relative = options.output ?? ".ai-agent-kit/control";
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..") || hasSymlinkComponent(target, relative)) throw new Error("control output must remain inside the repository");
  const output = path.join(target, relative);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const snapshot = buildOperatorSnapshot({ target });
  const files = { json: path.join(output, "snapshot.json"), html: path.join(output, "index.html") };
  fs.writeFileSync(files.json, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(files.html, renderOperatorHtml(snapshot), { mode: 0o600 });
  return { status: snapshot.health, snapshot_hash: snapshot.snapshot_hash, files };
}
