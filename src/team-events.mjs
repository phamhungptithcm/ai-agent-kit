import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { hasSymlinkComponent } from "./paths.mjs";

const MAX_JOURNAL = 8 * 1024 * 1024;
const MAX_EVENTS = 5000;
const EVENT_TYPES = new Set([
  "TEAM_PLANNED", "TEAM_STARTED", "APPROVAL_BLOCKED", "APPROVAL_RECORDED",
  "ASSIGNMENT_DISPATCHED", "ASSIGNMENT_HEARTBEAT", "RESULT_INGESTED",
  "TEAM_CANCELLED", "TEAM_RESUMED", "TEAM_RECOVERED", "JOURNAL_RECONCILED",
  "CONFORMANCE_RECORDED", "BENCHMARK_RECORDED"
]);
const DATA_KEYS = new Set([
  "team_hash", "context_hash", "run_id", "assignment_id", "spawn_id", "external_run_id",
  "agent_id", "claim_id", "status", "reason_code", "idempotency_key", "handoff_hash",
  "evidence_hash", "approval_hash", "adapter", "execution_mode", "team_type", "stale_assignments",
  "duplicate", "journal_head", "usage", "result_status", "conformance_level", "benchmark_status"
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function timestamp(value) { if (!Number.isFinite(Date.parse(value))) throw new Error("team event timestamp is invalid"); return new Date(value).toISOString(); }
function relativePath(id) { return `.ai-agent-kit/runtime/team-events/${safe(id, "task id")}.jsonl`; }
function lockPath(id) { return `.ai-agent-kit/runtime/team-events/${safe(id, "task id")}.lock`; }

function inside(root, relative, label) {
  const file = path.resolve(root, relative); const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel) || hasSymlinkComponent(root, rel)) throw new Error(`${label} must remain inside a non-symlinked repository path`);
  return file;
}

function withLock(root, id, callback) {
  const file = inside(root, lockPath(id), "team event lock"); fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor;
  try { descriptor = fs.openSync(file, "wx", 0o600); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("team event lock is unsafe");
    if (Date.now() - stat.mtimeMs <= 30000) throw new Error("team journal is being updated; retry");
    fs.unlinkSync(file); descriptor = fs.openSync(file, "wx", 0o600);
  }
  try { return callback(); } finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}

function normalizeData(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("team event data must be an object");
  if (Object.keys(data).some((key) => !DATA_KEYS.has(key))) throw new Error("team event data contains an unsupported field");
  const serialized = JSON.stringify(data);
  if (serialized.length > 10000) throw new Error("team event data exceeds its storage budget");
  if (/-----BEGIN|\b(?:password|secret|token|authorization|api[_ -]?key)\b\s*[:=]/i.test(serialized)) throw new Error("team event data contains secret-like content");
  return structuredClone(data);
}

export function readTeamEvents(options) {
  const root = path.resolve(options.target ?? process.cwd()); const file = inside(root, relativePath(options.id), "team event journal");
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOURNAL) throw new Error("team event journal must be a bounded regular file");
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length > MAX_EVENTS) throw new Error("team event journal exceeds its event budget");
  try { return lines.map(JSON.parse); } catch { throw new Error("team event journal contains invalid JSONL"); }
}

export function verifyTeamJournal(options) {
  const events = readTeamEvents(options); let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]; const claimed = event.event_hash; const copy = structuredClone(event); delete copy.event_hash;
    if (event.sequence !== index + 1 || event.previous_event_hash !== previous || !claimed || digest(copy) !== claimed) {
      return { schema_version: 1, task_id: options.id, status: "FAILED", event_count: events.length, failed_sequence: index + 1, journal_head: previous };
    }
    previous = claimed;
  }
  return { schema_version: 1, task_id: options.id, status: "VERIFIED", event_count: events.length, failed_sequence: null, journal_head: previous };
}

export function recordTeamEvent(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = safe(options.id, "task id");
  if (!EVENT_TYPES.has(options.type)) throw new Error("team event type is invalid");
  return withLock(root, id, () => {
    const verification = verifyTeamJournal({ target: root, id });
    if (verification.status !== "VERIFIED") throw new Error("team event journal hash chain is invalid");
    if (verification.event_count >= MAX_EVENTS) throw new Error("team event journal exceeds its event budget");
    const event = { schema_version: 1, task_id: id, sequence: verification.event_count + 1, type: options.type, timestamp: timestamp(options.now ?? new Date().toISOString()), previous_event_hash: verification.journal_head, data: normalizeData(options.data) };
    event.event_hash = digest(event);
    const file = inside(root, relativePath(id), "team event journal"); fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("team event journal cannot be a symbolic link");
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    return event;
  });
}

export function findTeamEvent(options) {
  return readTeamEvents(options).findLast((event) => event.type === options.type && Object.entries(options.match ?? {}).every(([key, value]) => event.data?.[key] === value)) ?? null;
}

export function buildTeamTimeline(options) {
  const events = readTeamEvents(options); const verification = verifyTeamJournal(options);
  return { schema_version: 1, task_id: options.id, status: verification.status, synthetic: Boolean(options.synthetic), event_count: events.length, journal_head: verification.journal_head, events: events.map(({ sequence, type, timestamp: at, event_hash, data }) => ({ sequence, type, timestamp: at, event_hash, data })) };
}

function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }

export function renderTeamTimelineText(timeline) {
  const lines = [`Agent Department timeline: ${timeline.task_id}`, `Journal: ${timeline.status} · ${timeline.event_count} events${timeline.synthetic ? " · SYNTHETIC DEMO" : ""}`];
  for (const event of timeline.events) lines.push(`${String(event.sequence).padStart(3, "0")}  ${event.timestamp}  ${event.type}  ${JSON.stringify(event.data)}`);
  return `${lines.join("\n")}\n`;
}

export function renderTeamTimelineHtml(timeline) {
  const cards = timeline.events.map((event) => `<li><div class="seq">${event.sequence}</div><div><strong>${escapeHtml(event.type)}</strong><time>${escapeHtml(event.timestamp)}</time><code>${escapeHtml(JSON.stringify(event.data, null, 2))}</code></div></li>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Department · ${escapeHtml(timeline.task_id)}</title><style>:root{color-scheme:dark;--bg:#07110f;--card:#0e1d19;--line:#284b3f;--ink:#e7fff4;--muted:#91b9a9;--accent:#65f2b4}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#16372e,var(--bg) 42%);color:var(--ink);font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:980px;margin:auto;padding:48px 24px}h1{font:700 clamp(30px,6vw,64px)/1 system-ui;margin:.2em 0}.eyebrow,.meta{color:var(--accent);letter-spacing:.08em;text-transform:uppercase}.meta{color:var(--muted);letter-spacing:0}ol{list-style:none;padding:0;display:grid;gap:14px}li{display:grid;grid-template-columns:44px 1fr;gap:16px;padding:18px;background:color-mix(in srgb,var(--card) 94%,transparent);border:1px solid var(--line);border-radius:14px}.seq{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--bg);font-weight:800}strong,time{display:block}time{color:var(--muted);font-size:12px}code{display:block;white-space:pre-wrap;word-break:break-word;margin-top:10px;color:#c5e9da}@media(prefers-reduced-motion:no-preference){li{animation:show .35s ease both}@keyframes show{from{opacity:0;transform:translateY(6px)}}}</style><main><p class="eyebrow">ai-agent-kit / Agent Department</p><h1>Execution proof, not agent theater.</h1><p class="meta">Task ${escapeHtml(timeline.task_id)} · ${escapeHtml(timeline.status)} journal · ${timeline.event_count} events${timeline.synthetic ? " · synthetic demo" : ""}</p><ol>${cards}</ol></main></html>`;
}

export function writeTeamTimeline(options) {
  const root = path.resolve(options.target ?? process.cwd()); const timeline = options.timeline ?? buildTeamTimeline(options);
  const output = path.resolve(root, options.output ?? `.ai-agent-kit/proof/${safe(options.id, "task id")}`); const rel = path.relative(root, output);
  if (rel.startsWith("..") || path.isAbsolute(rel) || hasSymlinkComponent(root, rel)) throw new Error("team timeline output must remain inside the repository");
  fs.mkdirSync(output, { recursive: true });
  const json = path.join(output, "team-timeline.json"); const text = path.join(output, "team-timeline.txt"); const html = path.join(output, "team-timeline.html");
  for (const file of [json, text, html]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("team timeline output cannot be a symbolic link");
  fs.writeFileSync(json, `${JSON.stringify(timeline, null, 2)}\n`, { mode: 0o600 }); fs.writeFileSync(text, renderTeamTimelineText(timeline), { mode: 0o600 }); fs.writeFileSync(html, renderTeamTimelineHtml(timeline), { mode: 0o600 });
  return { schema_version: 1, task_id: timeline.task_id, status: timeline.status, synthetic: timeline.synthetic, output, artifacts: { json, text, html }, journal_head: timeline.journal_head };
}
