import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, pulseDigest } from "./pulse-contract.mjs";

const LANGUAGE_BY_EXTENSION = new Map([
  [".js", "javascript"], [".jsx", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".ts", "typescript"], [".tsx", "typescript"], [".mts", "typescript"], [".cts", "typescript"],
  [".py", "python"], [".go", "go"], [".rs", "rust"], [".java", "java"], [".kt", "kotlin"], [".kts", "kotlin"], [".cs", "csharp"]
]);
const DEFAULT_EXCLUDES = [
  /(^|\/)(node_modules|vendor|vendors|dist|build|target|coverage|\.git|\.codegraph|\.cocoindex_code|\.ai-agent-kit)(\/|$)/,
  /(^|\/)(generated|__generated__|\.generated)(\/|$)/,
  /(?:\.min\.(?:js|css)|\.bundle\.js)$/
];
const COVERAGE_GAP_REASONS = new Set(["unreadable", "symlink", "hard_link", "oversized", "resource_limit", "path_escape", "unsafe_path", "not_regular_file"]);
const CONFIG_KEYS = new Set(["schema_version", "include", "exclude", "max_files", "max_file_bytes", "max_total_bytes", "timeout_ms", "boundaries", "bridges", "rules"]);
const LIMIT_MAXIMUMS = { max_files: 100000, max_file_bytes: 16 * 1024 * 1024, max_total_bytes: 512 * 1024 * 1024, timeout_ms: 600000 };
const RULE_TYPES = new Set(["new-cycles", "boundary-violations", "depth-increase", "cohesion-loss", "hotspot-growth", "blast-radius-growth", "coverage-drop", "confidence-drop"]);
const RULE_SEVERITIES = new Set(["info", "warning", "block"]);

function runGit(root, args, options = {}) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: options.timeoutMs ?? 30000, maxBuffer: 32 * 1024 * 1024 });
}

function normalizedRelative(root, candidate) {
  if (typeof candidate !== "string" || !candidate || candidate.includes("\0") || path.isAbsolute(candidate)) return null;
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function repositoryIdentity(root, timeoutMs) {
  const remote = runGit(root, ["config", "--get", "remote.origin.url"], { timeoutMs });
  const common = runGit(root, ["rev-parse", "--git-common-dir"], { timeoutMs });
  const identity = remote.status === 0 && remote.stdout.trim()
    ? remote.stdout.trim().replace(/\.git$/, "")
    : common.status === 0 ? path.resolve(root, common.stdout.trim()) : root;
  return { identity_hash: pulseDigest(identity), available: remote.status === 0 || common.status === 0 };
}

function gitInventory(root, timeoutMs) {
  const result = runGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { timeoutMs });
  if (result.status !== 0) throw new Error(`git inventory failed: ${(result.stderr || "not a Git repository").trim()}`);
  return result.stdout.split("\0").filter(Boolean);
}

function gitState(root, timeoutMs) {
  const commit = runGit(root, ["rev-parse", "HEAD"], { timeoutMs });
  const branch = runGit(root, ["branch", "--show-current"], { timeoutMs });
  const status = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).ai-agent-kit/**", ":(exclude).codegraph/**", ":(exclude).cocoindex_code/**"], { timeoutMs });
  return {
    available: commit.status === 0 && branch.status === 0 && status.status === 0,
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() || null : null,
    dirty: status.status !== 0 || Boolean(status.stdout),
    worktree_digest: pulseDigest(status.status === 0 ? status.stdout : "git-status-unavailable")
  };
}

export function currentPulseRepositoryState(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMIT_MAXIMUMS.timeout_ms) throw new Error(`pulse repository timeout must be between 1 and ${LIMIT_MAXIMUMS.timeout_ms}`);
  const identity = repositoryIdentity(root, timeoutMs);
  const state = gitState(root, timeoutMs);
  return { ...identity, ...state, available: identity.available && state.available };
}

function excluded(relative, config) {
  if (DEFAULT_EXCLUDES.some((pattern) => pattern.test(relative))) return "generated_or_vendor";
  for (const prefix of config.exclude ?? []) {
    const normalized = configPath(prefix, "pulse configuration exclude");
    if (normalized && (relative === normalized || relative.startsWith(`${normalized}/`))) return "configured_exclusion";
  }
  if (config.include?.length && !config.include.some((prefix) => {
    const normalized = configPath(prefix, "pulse configuration include");
    return relative === normalized || relative.startsWith(`${normalized}/`);
  })) return "outside_include_scope";
  return null;
}

function configPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value)) throw new Error(`${label} must be a non-empty repository-relative path`);
  const normalized = value.replaceAll("\\", "/").replace(/\*\*?$/, "").replace(/\/$/, "").replace(/^\.\//, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new Error(`${label} cannot escape the repository`);
  return normalized;
}

function exactObject(value, label, required, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of required) if (!(key in value)) throw new Error(`${label} requires ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unsupported property ${key}`);
}

export function validatePulseConfig(config = {}) {
  exactObject(config, "pulse configuration", [], CONFIG_KEYS);
  if (config.schema_version != null && config.schema_version !== 1) throw new Error("pulse configuration contract is invalid");
  for (const key of ["include", "exclude", "boundaries", "bridges", "rules"]) {
    if (config[key] != null && (!Array.isArray(config[key]) || config[key].length > 256)) throw new Error(`pulse configuration ${key} must be an array with at most 256 items`);
  }
  for (const key of ["include", "exclude"]) for (const value of config[key] ?? []) configPath(value, `pulse configuration ${key}`);
  for (const [name, maximum] of Object.entries(LIMIT_MAXIMUMS)) {
    if (config[name] == null) continue;
    if (!Number.isInteger(config[name]) || config[name] < 1 || config[name] > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  for (const boundary of config.boundaries ?? []) {
    exactObject(boundary, "pulse boundary", ["name", "from"], new Set(["name", "from", "allow", "deny"]));
    if (typeof boundary.name !== "string" || !boundary.name.trim()) throw new Error("pulse boundary name must be a non-empty string");
    configPath(boundary.from, "pulse boundary from");
    for (const key of ["allow", "deny"]) {
      if (boundary[key] != null && (!Array.isArray(boundary[key]) || boundary[key].length > 256)) throw new Error(`pulse boundary ${key} must be an array with at most 256 items`);
      for (const value of boundary[key] ?? []) configPath(value, `pulse boundary ${key}`);
    }
  }
  for (const bridge of config.bridges ?? []) {
    exactObject(bridge, "pulse bridge", ["from", "to"], new Set(["id", "from", "to"]));
    configPath(bridge.from, "pulse bridge from"); configPath(bridge.to, "pulse bridge to");
    if (bridge.id != null && (typeof bridge.id !== "string" || !bridge.id.trim())) throw new Error("pulse bridge id must be a non-empty string");
  }
  for (const rule of config.rules ?? []) {
    exactObject(rule, "pulse rule", ["id", "type"], new Set(["id", "type", "threshold", "severity"]));
    if (typeof rule.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rule.id)) throw new Error("pulse rule id is invalid");
    if (!RULE_TYPES.has(rule.type)) throw new Error(`unsupported pulse rule type: ${rule.type}`);
    if (rule.threshold != null && (!Number.isFinite(rule.threshold) || rule.threshold < 0)) throw new Error(`pulse rule ${rule.id} threshold must be non-negative`);
    if (rule.severity != null && !RULE_SEVERITIES.has(rule.severity)) throw new Error(`pulse rule ${rule.id} severity is invalid`);
  }
  return config;
}

function binaryBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export function scanRepository(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const config = validatePulseConfig(options.config ?? {});
  const limits = {
    max_files: Number(config.max_files ?? 20000),
    max_file_bytes: Number(config.max_file_bytes ?? 2 * 1024 * 1024),
    max_total_bytes: Number(config.max_total_bytes ?? 64 * 1024 * 1024),
    timeout_ms: Number(config.timeout_ms ?? 30000)
  };
  const started = Date.now();
  const candidates = gitInventory(root, limits.timeout_ms).sort((left, right) => left.localeCompare(right));
  const boundedCandidates = candidates.slice(0, limits.max_files);
  const entries = [];
  const exclusions = [];
  const reasonCounts = {};
  let totalBytes = 0;
  let resourceLimited = candidates.length > boundedCandidates.length;
  const exclude = (file, reason) => {
    exclusions.push({ path: file, reason });
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };
  let truncated = candidates.length - boundedCandidates.length;
  for (let index = 0; index < boundedCandidates.length; index += 1) {
    const candidate = boundedCandidates[index];
    if (Date.now() - started > limits.timeout_ms) {
      resourceLimited = true;
      truncated += boundedCandidates.length - index;
      break;
    }
    const relative = normalizedRelative(root, candidate);
    if (!relative) { exclude(String(candidate), "unsafe_path"); continue; }
    const excludedReason = excluded(relative, config);
    if (excludedReason) { exclude(relative, excludedReason); continue; }
    const absolute = path.resolve(root, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { exclude(relative, "unreadable"); continue; }
    if (stat.isSymbolicLink()) { exclude(relative, "symlink"); continue; }
    if (!stat.isFile() || stat.nlink > 1) { exclude(relative, stat.nlink > 1 ? "hard_link" : "not_regular_file"); continue; }
    let real;
    try { real = fs.realpathSync(absolute); } catch { exclude(relative, "unreadable"); continue; }
    const realRelative = path.relative(root, real);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) { exclude(relative, "path_escape"); continue; }
    if (stat.size > limits.max_file_bytes) { exclude(relative, "oversized"); continue; }
    if (totalBytes + stat.size > limits.max_total_bytes) { resourceLimited = true; exclude(relative, "resource_limit"); continue; }
    const language = path.posix.basename(relative) === "go.mod" ? "go-manifest" : LANGUAGE_BY_EXTENSION.get(path.extname(relative).toLowerCase()) ?? null;
    if (!language) { exclude(relative, "unsupported_language"); continue; }
    let content;
    try { content = fs.readFileSync(real); } catch { exclude(relative, "unreadable"); continue; }
    if (binaryBuffer(content)) { exclude(relative, "binary"); continue; }
    totalBytes += stat.size;
    entries.push({ path: relative, language, bytes: stat.size, content_hash: pulseDigest(content) });
  }
  if (truncated) reasonCounts.resource_limit = (reasonCounts.resource_limit ?? 0) + truncated;
  const repository = currentPulseRepositoryState({ target: root, timeoutMs: limits.timeout_ms });
  if (!repository.available) {
    resourceLimited = true;
    reasonCounts.resource_limit = (reasonCounts.resource_limit ?? 0) + 1;
  }
  const configDigest = pulseDigest({ include: config.include ?? [], exclude: config.exclude ?? [], limits, boundaries: config.boundaries ?? [], bridges: config.bridges ?? [], rules: config.rules ?? [] });
  const sourceDigest = pulseDigest(entries.map(({ path: file, language, bytes, content_hash }) => ({ path: file, language, bytes, content_hash })));
  const eligible = entries.length + exclusions.filter((item) => COVERAGE_GAP_REASONS.has(item.reason)).length + truncated;
  const coverage = eligible ? entries.length / eligible : 0;
  return {
    root,
    repository,
    inventory: {
      entries,
      exclusions,
      counts: { discovered: candidates.length, analyzed: entries.length, excluded: candidates.length - entries.length, truncated, exclusion_reasons: reasonCounts },
      bytes_analyzed: totalBytes,
      file_coverage: Number(coverage.toFixed(6)),
      source_digest: sourceDigest,
      config_digest: configDigest,
      limits,
      status: resourceLimited ? "DEGRADED" : "COMPLETE"
    },
    config: JSON.parse(canonicalJson(config))
  };
}

export function readScannedSource(scan, entry) {
  const absolute = path.resolve(scan.root, entry.path);
  const relative = path.relative(scan.root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("scanned source escaped repository root");
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > scan.inventory.limits.max_file_bytes) throw new Error(`scanned source changed to an unsafe file: ${entry.path}`);
  const content = fs.readFileSync(absolute);
  if (pulseDigest(content) !== entry.content_hash) throw new Error(`scanned source changed during analysis: ${entry.path}`);
  return content.toString("utf8");
}
