import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { hasSymlinkComponent } from "./paths.mjs";
import {
  aclAllowsRead,
  memoryDigest,
  normalizeLegacyMemoryEntry,
  resolveMemoryActor,
  resolveRepositoryIdentity,
  scopeAllowsRead
} from "./memory-contract.mjs";
import { withMemoryStore } from "./memory-store.mjs";

function legacyFile(root) {
  const resolved = path.resolve(root);
  const rel = ".ai-agent-kit/runtime/memory/entries.jsonl";
  if (hasSymlinkComponent(resolved, rel)) throw new Error(`refusing memory access through a symbolic link: ${rel}`);
  return path.join(resolved, rel);
}

export function readLegacyMemory(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const file = legacyFile(root);
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("legacy memory ledger must be a bounded regular file");
  const identity = resolveRepositoryIdentity({ ...options, target: root });
  const latest = new Map();
  for (const [index, line] of fs.readFileSync(file, "utf8").split("\n").filter(Boolean).entries()) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { throw new Error(`invalid memory ledger JSON at line ${index + 1}`); }
    try { latest.set(parsed.id, normalizeLegacyMemoryEntry(parsed, { ...options, target: root, repositoryIdentity: identity })); }
    catch (error) { throw new Error(`invalid legacy memory entry at line ${index + 1}: ${error.message}`); }
  }
  return [...latest.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function commitReachable(root, commit) {
  if (!commit) return false;
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: path.resolve(root), timeout: 30000 }).status === 0;
}

export function classifyMemory(entry, { root, now = new Date() }) {
  const status = String(entry.status ?? "").toUpperCase();
  if (["REJECTED", "REVOKED", "SUPERSEDED", "QUARANTINED"].includes(status)) return { eligible: false, state: status, reason_code: `STATUS_${status}`, reason: `memory is ${status.toLowerCase()}` };
  if (status !== "APPROVED") return { eligible: false, state: status, reason_code: "NOT_APPROVED", reason: "memory is not approved" };
  if (entry.retention?.delete_after && new Date(entry.retention.delete_after) <= now) return { eligible: false, state: "EXPIRED", reason_code: "DELETE_AFTER_PASSED", reason: "memory deletion deadline has passed" };
  if (entry.retention?.expires_at && new Date(entry.retention.expires_at) <= now) return { eligible: false, state: "EXPIRED", reason_code: "EXPIRED", reason: "memory expiry has passed" };
  const today = new Date(now.toISOString().slice(0, 10));
  if (!entry.retention?.review_date || new Date(`${entry.retention.review_date}T00:00:00.000Z`) < today) return { eligible: false, state: "STALE", reason_code: "REVIEW_OVERDUE", reason: "memory review date has passed" };
  if (!commitReachable(root, entry.provenance?.source_commit)) return { eligible: false, state: "STALE", reason_code: "SOURCE_UNREACHABLE", reason: "source commit is missing or not reachable from HEAD" };
  return { eligible: true, state: "APPROVED", reason_code: "APPROVED_CURRENT", reason: "approved, current, and source-reachable" };
}

function allEntries(root, options, store) {
  const stored = store.list();
  if (options.includeLegacy === false) return stored;
  const byId = new Map(readLegacyMemory({ ...options, target: root }).map((entry) => [entry.id, entry]));
  for (const entry of stored) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function requestScope(options, identity, actor) {
  return {
    organization_id: actor.organization_id,
    repository_id: actor.repository_id,
    branch: options.branch ?? identity.branch,
    modules: options.modules ?? (options.module ? [options.module] : []),
    task_id: options.taskId ?? options.id ?? null,
    run_id: options.runId ?? null,
    session_id: options.sessionId ?? null,
    agent_id: options.agentId ?? actor.actor_id
  };
}

function words(value) { return new Set(String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []); }
function keywordScore(entry, query) {
  const terms = words(query);
  if (!terms.size) return 0;
  const title = words(entry.title); const category = words(entry.category); const content = words(entry.content);
  let score = 0;
  for (const term of terms) score += title.has(term) ? 5 : category.has(term) ? 3 : content.has(term) ? 1 : 0;
  return score;
}
function trustScore(value) { return ({ verified: 3, reviewed: 2, provisional: 1 })[value] ?? 0; }
function tokenEstimate(entry) { return Math.max(1, Math.ceil(`${entry.title}\n${entry.content}`.length / 4)); }
function scopeKey(entry) {
  return JSON.stringify([entry.scope.organization_id, entry.scope.repository_id, entry.scope.visibility, entry.scope.branch, entry.scope.modules, entry.scope.task_id, entry.scope.run_id, entry.scope.session_id, entry.scope.agent_id, entry.title]);
}

export function retrieveScopedMemory(options = {}, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const identity = resolveRepositoryIdentity({ ...options, target: root });
  const actor = resolveMemoryActor(options, identity);
  const request = requestScope(options, identity, actor);
  const limit = Number(options.limit ?? 5);
  const budget = Number(options.tokenBudget ?? 4000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("memory query limit must be an integer from 1 to 10");
  if (!Number.isInteger(budget) || budget < 1 || budget > 100_000) throw new Error("memory token budget must be an integer from 1 to 100000");
  return withMemoryStore({ ...options, target: root }, (store) => {
    const entries = allEntries(root, options, store);
    const conflicting = new Set();
    const groups = new Map();
    for (const entry of entries) {
      const key = scopeKey(entry); const group = groups.get(key) ?? []; group.push(entry); groups.set(key, group);
    }
    for (const group of groups.values()) if (new Set(group.map((entry) => entry.content_hash)).size > 1) group.forEach((entry) => conflicting.add(entry.id));
    const eligible = [];
    const excluded = [];
    for (const entry of entries) {
      const classification = classifyMemory(entry, { root, now: options.now ?? new Date() });
      let reasonCode = null;
      if (!classification.eligible) reasonCode = classification.reason_code;
      else if (conflicting.has(entry.id)) reasonCode = "CONFLICTED";
      else if (!aclAllowsRead(entry, actor)) reasonCode = "ACL_DENIED";
      else if (!scopeAllowsRead(entry, request)) reasonCode = "SCOPE_MISMATCH";
      const score = keywordScore(entry, options.query);
      if (!reasonCode && options.query && score === 0) reasonCode = "NO_KEYWORD_MATCH";
      if (reasonCode) excluded.push({ id: entry.id, reason_code: reasonCode });
      else eligible.push({ entry, keyword_score: score });
    }
    let semantic = { status: "DISABLED", reason_code: "DETERMINISTIC_ONLY" };
    if (deps.semanticRanker && eligible.length) {
      try {
        const ranked = deps.semanticRanker({ query: options.query ?? "", entries: eligible.map(({ entry }) => ({ id: entry.id, title: entry.title, content: entry.content })) });
        if (ranked && typeof ranked.then === "function") throw new Error("async semantic rankers are unsupported");
        const scores = new Map((ranked ?? []).map((item) => [item.id, Number(item.score)]));
        eligible.forEach((item) => { item.semantic_score = Number.isFinite(scores.get(item.entry.id)) ? scores.get(item.entry.id) : 0; });
        semantic = { status: "APPLIED", reason_code: "HARD_FILTERS_PRECEDED_SEMANTIC" };
      } catch (error) {
        eligible.forEach((item) => { item.semantic_score = 0; });
        semantic = { status: "DEGRADED", reason_code: "SEMANTIC_FALLBACK", error_hash: memoryDigest(error.message) };
      }
    }
    eligible.sort((a, b) =>
      (b.semantic_score ?? 0) - (a.semantic_score ?? 0)
      || b.keyword_score - a.keyword_score
      || trustScore(b.entry.trust_tier) - trustScore(a.entry.trust_tier)
      || b.entry.confidence - a.entry.confidence
      || a.entry.id.localeCompare(b.entry.id)
    );
    const selected = []; let usedTokens = 0;
    for (const item of eligible) {
      const estimatedTokens = tokenEstimate(item.entry);
      if (selected.length >= limit) { excluded.push({ id: item.entry.id, reason_code: "ENTRY_LIMIT" }); continue; }
      if (usedTokens + estimatedTokens > budget) { excluded.push({ id: item.entry.id, reason_code: "TOKEN_BUDGET" }); continue; }
      usedTokens += estimatedTokens;
      selected.push({
        ...item.entry,
        lifecycle: classifyMemory(item.entry, { root, now: options.now ?? new Date() }),
        retrieval: {
          keyword_score: item.keyword_score,
          semantic_score: item.semantic_score ?? null,
          estimated_tokens: estimatedTokens,
          reason_codes: ["APPROVED_CURRENT", "ACL_ALLOWED", "SCOPE_ALLOWED", item.keyword_score ? "KEYWORD_MATCH" : "DEFAULT_ORDER"]
        }
      });
    }
    const receiptCore = {
      schema_version: 1,
      status: semantic.status === "DEGRADED" ? "DEGRADED" : "SELECTED",
      repository_identity_hash: memoryDigest({ organization_id: identity.organization_id, repository_id: identity.repository_id }),
      actor_hash: memoryDigest(actor),
      request_hash: memoryDigest({ request, query: options.query ?? null }),
      filters: ["STATUS", "EXPIRY", "REVIEW", "SOURCE_REACHABILITY", "CONFLICT", "ACL", "SCOPE", "KEYWORD"],
      semantic,
      selected: selected.map((entry) => ({ id: entry.id, content_hash: entry.content_hash, keyword_score: entry.retrieval.keyword_score, semantic_score: entry.retrieval.semantic_score, estimated_tokens: entry.retrieval.estimated_tokens, reason_codes: entry.retrieval.reason_codes })),
      excluded: excluded.sort((a, b) => a.id.localeCompare(b.id) || a.reason_code.localeCompare(b.reason_code)),
      budget: { max_entries: limit, max_estimated_tokens: budget, used_estimated_tokens: usedTokens, estimator: "ceil(characters/4)" }
    };
    const receipt = { ...receiptCore, receipt_id: memoryDigest(receiptCore) };
    const auditReceipt = store.recordRetrieval ? store.recordRetrieval(receipt, { actor }) : null;
    return { entries: selected, receipt: { ...receipt, audit_receipt_hash: auditReceipt?.receipt_hash ?? null } };
  });
}

export function queryEligibleMemory(options = {}, deps = {}) { return retrieveScopedMemory(options, deps).entries; }

export function transitionMemory(options) {
  const root = path.resolve(options.target ?? process.cwd());
  return withMemoryStore({ ...options, target: root }, (store) => {
    if (!store.get(options.memoryId)) {
      const legacy = readLegacyMemory({ ...options, target: root }).find((entry) => entry.id === options.memoryId);
      if (legacy) store.importEntries([legacy], { apply: true, actor: options.approver, reasonCode: "LEGACY_LIFECYCLE_TRANSITION" });
    }
    return store.transition(options.memoryId, options.action, options).entry;
  });
}

export function memoryHealth(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  return withMemoryStore({ ...options, target: root }, (store) => {
    const storage = store.health();
    const entries = allEntries(root, options, store);
    const classified = entries.map((entry) => ({ id: entry.id, title: entry.title, ...classifyMemory(entry, { root, now: options.now ?? new Date() }) }));
    const counts = Object.create(null);
    for (const item of classified) {
      counts[item.state] = (counts[item.state] ?? 0) + 1;
      const compatibilityState = item.state.toLowerCase();
      counts[compatibilityState] = (counts[compatibilityState] ?? 0) + 1;
    }
    const conflicts = [];
    const groups = new Map();
    for (const entry of entries.filter((candidate) => classifyMemory(candidate, { root, now: options.now ?? new Date() }).eligible)) {
      const key = scopeKey(entry); const group = groups.get(key) ?? []; group.push(entry); groups.set(key, group);
    }
    for (const group of groups.values()) if (new Set(group.map((entry) => entry.content_hash)).size > 1) conflicts.push({ memory_ids: group.map((entry) => entry.id).sort(), reason: "same title and scope have different approved content" });
    return { schema_version: 3, status: storage.status === "HEALTHY" && !conflicts.length && classified.every((item) => item.eligible) ? "HEALTHY" : "ATTENTION", storage, total: entries.length, counts, conflicts, entries: classified };
  });
}
