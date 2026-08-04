import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";

function fileFor(root) {
  const resolved = path.resolve(root);
  const rel = ".ai-agent-kit/runtime/memory/entries.jsonl";
  if (hasSymlinkComponent(resolved, rel)) throw new Error(`refusing memory access through a symbolic link: ${rel}`);
  return path.join(resolved, rel);
}

function readAll(root) {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`invalid memory ledger JSON at line ${index + 1}`); }
  });
}

function append(root, entry) {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

function latestEntries(root) {
  const latest = new Map();
  for (const entry of readAll(root)) latest.set(entry.id, entry);
  return [...latest.values()];
}

function commitReachable(root, commit) {
  if (!commit) return false;
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: path.resolve(root), timeout: 30000 }).status === 0;
}

export function classifyMemory(entry, { root, now = new Date() }) {
  if (["rejected", "revoked", "superseded"].includes(entry.status)) return { eligible: false, state: entry.status, reason: `memory is ${entry.status}` };
  if (entry.status !== "approved") return { eligible: false, state: entry.status, reason: "memory is not approved" };
  if (entry.expires_at && new Date(entry.expires_at) <= now) return { eligible: false, state: "expired", reason: "memory expiry has passed" };
  if (!entry.review_date || new Date(entry.review_date) < new Date(now.toISOString().slice(0, 10))) return { eligible: false, state: "stale", reason: "memory review date has passed" };
  if (!commitReachable(root, entry.source_commit)) return { eligible: false, state: "stale", reason: "source commit is missing or not reachable from HEAD" };
  return { eligible: true, state: "approved", reason: "approved, current, and source-reachable" };
}

export function transitionMemory(options) {
  const root = options.target ?? process.cwd();
  const current = latestEntries(root).find((entry) => entry.id === options.memoryId);
  if (!current) throw new Error(`memory not found: ${options.memoryId}`);
  const action = options.action;
  if (!new Set(["revoke", "supersede"]).has(action)) throw new Error("memory transition requires revoke or supersede");
  if (!options.approver || !options.reason) throw new Error("memory transition requires approver and reason");
  if (action === "supersede" && !options.replacementId) throw new Error("supersede requires replacementId");
  if (action === "supersede") {
    const replacement = latestEntries(root).find((entry) => entry.id === options.replacementId);
    if (!replacement || !classifyMemory(replacement, { root }).eligible) throw new Error("supersede replacement must be current approved memory");
  }
  const next = {
    ...current,
    status: action === "revoke" ? "revoked" : "superseded",
    lifecycle_reason: options.reason,
    lifecycle_approver: options.approver,
    replacement_id: options.replacementId ?? null,
    updated_at: new Date().toISOString()
  };
  append(root, next);
  return next;
}

export function queryEligibleMemory(options = {}) {
  const root = options.target ?? process.cwd();
  const limit = Number(options.limit ?? 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("memory query limit must be an integer from 1 to 10");
  const latest = latestEntries(root);
  const conflicting = new Set();
  for (let index = 0; index < latest.length; index += 1) {
    for (const candidate of latest.slice(index + 1)) {
      const leftHash = latest[index].content_hash ?? latest[index].content;
      const rightHash = candidate.content_hash ?? candidate.content;
      if (latest[index].scope === candidate.scope && latest[index].title === candidate.title && leftHash !== rightHash) {
        conflicting.add(latest[index].id);
        conflicting.add(candidate.id);
      }
    }
  }
  const result = [];
  for (const entry of latest) {
    const classification = classifyMemory(entry, { root, now: options.now ?? new Date() });
    if (!classification.eligible || conflicting.has(entry.id)) continue;
    if (options.scope && entry.scope !== options.scope) continue;
    if (options.query && !`${entry.title}\n${entry.content}`.toLowerCase().includes(options.query.toLowerCase())) continue;
    result.push({ ...entry, lifecycle: classification, provenance: { source: entry.source, source_commit: entry.source_commit, approver: entry.approver } });
  }
  const trust = { verified: 3, reviewed: 2, provisional: 1 };
  return result.sort((a, b) => (trust[b.trust_tier] ?? 0) - (trust[a.trust_tier] ?? 0) || b.confidence - a.confidence || a.id.localeCompare(b.id)).slice(0, limit);
}

export function memoryHealth(options = {}) {
  const root = options.target ?? process.cwd();
  const latest = latestEntries(root);
  const entries = latest.map((entry) => ({ id: entry.id, title: entry.title, ...classifyMemory(entry, { root, now: options.now ?? new Date() }) }));
  const counts = Object.create(null);
  for (const entry of entries) counts[entry.state] = (counts[entry.state] ?? 0) + 1;
  const conflicts = [];
  const eligible = latest.filter((entry) => classifyMemory(entry, { root, now: options.now ?? new Date() }).eligible);
  for (let index = 0; index < eligible.length; index += 1) {
    for (const candidate of eligible.slice(index + 1)) {
      const leftHash = eligible[index].content_hash ?? eligible[index].content;
      const rightHash = candidate.content_hash ?? candidate.content;
      if (eligible[index].scope === candidate.scope && eligible[index].title === candidate.title && leftHash !== rightHash) {
        conflicts.push({ memory_ids: [eligible[index].id, candidate.id].sort(), reason: "same title and scope have different approved content" });
      }
    }
  }
  return { schema_version: 2, status: entries.some((entry) => !entry.eligible) || conflicts.length ? "ATTENTION" : "HEALTHY", total: entries.length, counts, conflicts, entries };
}
