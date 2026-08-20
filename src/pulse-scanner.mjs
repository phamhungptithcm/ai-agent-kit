import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, pulseDigest } from "./pulse-contract.mjs";

const LANGUAGE_BY_EXTENSION = new Map([
  [".js", "javascript"], [".jsx", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".ts", "typescript"], [".tsx", "typescript"], [".mts", "typescript"], [".cts", "typescript"],
  [".py", "python"], [".go", "go"], [".rs", "rust"], [".java", "java"], [".kt", "kotlin"], [".kts", "kotlin"], [".cs", "csharp"]
]);
const MANIFEST_BY_NAME = new Map([
  ["package.json", "javascript-manifest"], ["tsconfig.json", "typescript-config"], ["jsconfig.json", "javascript-config"],
  ["pyproject.toml", "python-manifest"], ["go.mod", "go-manifest"], ["go.work", "go-workspace"],
  ["Cargo.toml", "rust-manifest"], ["Cargo.lock", "rust-lock"], ["pom.xml", "maven-manifest"],
  ["build.gradle", "gradle-manifest"], ["build.gradle.kts", "gradle-manifest"], ["settings.gradle", "gradle-settings"],
  ["settings.gradle.kts", "gradle-settings"]
]);
const NON_SOURCE_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".html", ".css", ".scss", ".sass", ".less", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".lock", ".csv"]);
const SOURCE_DIRECTORIES = new Set(["src", "lib", "app", "apps", "packages", "services", "server", "client", "backend", "frontend", "test", "tests"]);
const DEFAULT_EXCLUDES = [
  /(^|\/)(node_modules|vendor|vendors|dist|build|target|coverage|\.git|\.codegraph|\.cocoindex_code|\.ai-agent-kit)(\/|$)/,
  /(^|\/)(generated|__generated__|\.generated)(\/|$)/,
  /(?:\.min\.(?:js|css)|\.bundle\.js)$/
];
const INTERNAL_STATE = /(^|\/)(\.ai-agent-kit|\.codegraph|\.cocoindex_code)(\/|$)/;
const CONFIG_KEYS = new Set([
  "schema_version", "include", "exclude", "max_files", "max_file_bytes", "max_total_bytes", "timeout_ms",
  "max_artifact_bytes", "graph_shard_bytes", "boundaries", "bridges", "components", "layers", "rules", "waivers",
  "resolvers", "blocking_minimum_tier", "external_packages", "public_apis", "cache"
]);
const LIMIT_MAXIMUMS = {
  max_files: 100000,
  max_file_bytes: 16 * 1024 * 1024,
  max_total_bytes: 512 * 1024 * 1024,
  timeout_ms: 600000,
  max_artifact_bytes: 16 * 1024 * 1024,
  graph_shard_bytes: 8 * 1024 * 1024
};
const RULE_TYPES = new Set([
  "new-cycles", "boundary-violations", "depth-increase", "cohesion-loss", "hotspot-growth",
  "blast-radius-growth", "coverage-drop", "confidence-drop", "forbidden-dependency",
  "required-dependency", "reachable-dependency", "public-api-only", "layer-order", "no-new-findings"
]);
const RULE_SEVERITIES = new Set(["info", "warning", "block"]);
const EVIDENCE_TIERS = new Set(["SOURCE_FALLBACK", "AST_VERIFIED", "RESOLVER_VERIFIED", "INDEX_VERIFIED", "EXPLICIT_MANIFEST"]);

function runGit(root, args, options = {}) {
  const remaining = options.deadline ? Math.max(1, options.deadline.deadline_at - Date.now()) : options.timeoutMs ?? 30000;
  return spawnSync("git", args, { cwd: root, encoding: options.encoding === undefined ? "utf8" : options.encoding, timeout: remaining, maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024 });
}

export function createPulseDeadline(timeoutMs = 30000) {
  const value = Number(timeoutMs);
  if (!Number.isInteger(value) || value < 1 || value > LIMIT_MAXIMUMS.timeout_ms) throw new Error(`pulse timeout must be between 1 and ${LIMIT_MAXIMUMS.timeout_ms}`);
  const started_at = Date.now();
  return {
    started_at,
    deadline_at: started_at + value,
    check(stage = "analysis") {
      if (Date.now() > this.deadline_at) {
        const error = new Error(`Architecture Pulse deadline exceeded during ${stage}`);
        error.code = "DEADLINE_EXCEEDED";
        throw error;
      }
    },
    remaining() {
      return Math.max(1, this.deadline_at - Date.now());
    }
  };
}

function normalizeRemote(value) {
  let remote = String(value ?? "").trim().replace(/^git\+/, "").replace(/\.git$/, "");
  const scp = remote.match(/^([^@]+@)?([^:]+):(.+)$/);
  if (scp && !remote.includes("://")) remote = `ssh://${scp[2]}/${scp[3]}`;
  try {
    const parsed = new URL(remote);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return remote.replaceAll("\\", "/");
  }
}

function normalizedRelative(root, candidate) {
  if (typeof candidate !== "string" || !candidate || candidate.includes("\0") || path.isAbsolute(candidate)) return null;
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function repositoryIdentity(root, deadline) {
  const remote = runGit(root, ["config", "--get", "remote.origin.url"], { deadline });
  const common = runGit(root, ["rev-parse", "--git-common-dir"], { deadline });
  const identity = remote.status === 0 && remote.stdout.trim()
    ? normalizeRemote(remote.stdout)
    : common.status === 0 ? path.resolve(root, common.stdout.trim()) : root;
  return { identity_hash: pulseDigest(identity), available: remote.status === 0 || common.status === 0 };
}

function gitInventory(root, deadline) {
  const result = runGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { deadline });
  if (result.status !== 0) throw new Error(`git inventory failed: ${(result.stderr || "not a Git repository").trim()}`);
  return result.stdout.split("\0").filter(Boolean).map((file) => ({ path: file, size: null }));
}

function gitRevisionInventory(root, revision, deadline) {
  const resolved = runGit(root, ["rev-parse", "--verify", `${revision}^{commit}`], { deadline });
  if (resolved.status !== 0) throw new Error(`invalid Pulse revision: ${revision}`);
  const commit = resolved.stdout.trim();
  const result = runGit(root, ["ls-tree", "-r", "-z", "--long", commit], { deadline, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git revision inventory failed: ${result.stderr.trim()}`);
  const candidates = result.stdout.split("\0").filter(Boolean).flatMap((line) => {
    const match = line.match(/^\d+\s+blob\s+[a-f0-9]+\s+(\d+)\t(.+)$/s);
    return match ? [{ path: match[2], size: Number(match[1]) }] : [];
  });
  return { commit, candidates };
}

function gitState(root, deadline, revision = null) {
  if (revision) {
    return { available: true, commit: revision, branch: null, dirty: false, worktree_digest: pulseDigest(`revision:${revision}`) };
  }
  const commit = runGit(root, ["rev-parse", "HEAD"], { deadline });
  const branch = runGit(root, ["branch", "--show-current"], { deadline });
  const status = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).ai-agent-kit/**", ":(exclude).codegraph/**", ":(exclude).cocoindex_code/**"], { deadline });
  const unstaged = runGit(root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--", ".", ":(exclude).ai-agent-kit/**", ":(exclude).codegraph/**", ":(exclude).cocoindex_code/**"], { deadline, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  const staged = runGit(root, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--", ".", ":(exclude).ai-agent-kit/**", ":(exclude).codegraph/**", ":(exclude).cocoindex_code/**"], { deadline, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  const untracked = untrackedState(root, deadline);
  const available = commit.status === 0 && branch.status === 0 && status.status === 0 && unstaged.status === 0 && staged.status === 0 && untracked.available;
  return {
    available,
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() || null : null,
    dirty: status.status !== 0 || Boolean(status.stdout),
    worktree_digest: pulseDigest(available ? {
      status: pulseDigest(status.stdout),
      unstaged: pulseDigest(unstaged.stdout),
      staged: pulseDigest(staged.stdout),
      untracked: untracked.entries
    } : "git-worktree-evidence-unavailable")
  };
}

function untrackedState(root, deadline, maximumFiles = 20000, maximumBytes = 64 * 1024 * 1024) {
  const listed = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude).ai-agent-kit/**", ":(exclude).codegraph/**", ":(exclude).cocoindex_code/**"], { deadline });
  if (listed.status !== 0) return { available: false, entries: [] };
  const files = listed.stdout.split("\0").filter(Boolean).sort();
  if (files.length > maximumFiles) return { available: false, entries: [] };
  const entries = [];
  let bytes = 0;
  for (const relative of files) {
    deadline.check("untracked repository state");
    const normalized = normalizedRelative(root, relative);
    if (!normalized) return { available: false, entries: [] };
    const absolute = path.resolve(root, normalized);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        bytes += Buffer.byteLength(target);
        if (bytes > maximumBytes) return { available: false, entries: [] };
        entries.push({ path: normalized, kind: "symlink", digest: pulseDigest(target) });
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (stat.nlink > 1 || bytes > maximumBytes) return { available: false, entries: [] };
        entries.push({ path: normalized, kind: "file", digest: pulseDigest(fs.readFileSync(absolute)) });
      } else return { available: false, entries: [] };
    } catch {
      return { available: false, entries: [] };
    }
  }
  return { available: true, entries };
}

export function currentPulseRepositoryState(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const deadline = options.deadline ?? createPulseDeadline(options.timeoutMs ?? 30000);
  const identity = repositoryIdentity(root, deadline);
  const state = gitState(root, deadline, options.revision ?? null);
  return { ...identity, ...state, available: identity.available && state.available };
}

function configPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value)) throw new Error(`${label} must be a non-empty repository-relative path`);
  const normalized = value.replaceAll("\\", "/").replace(/\*\*?$/, "").replace(/\/$/, "").replace(/^\.\//, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "..")) throw new Error(`${label} cannot escape the repository`);
  return normalized;
}

function pathMatches(file, prefix) {
  const normalized = configPath(prefix, "pulse path matcher");
  return file === normalized || file.startsWith(`${normalized}/`);
}

function excluded(relative, config) {
  if (DEFAULT_EXCLUDES.some((pattern) => pattern.test(relative))) return "generated_or_vendor";
  for (const prefix of config.exclude ?? []) if (pathMatches(relative, prefix)) return "configured_exclusion";
  if (config.include?.length && !config.include.some((prefix) => pathMatches(relative, prefix))) return "outside_include_scope";
  return null;
}

function exactObject(value, label, required, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of required) if (!(key in value)) throw new Error(`${label} requires ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unsupported property ${key}`);
}

function validateRule(rule) {
  exactObject(rule, "pulse rule", ["id", "type"], new Set(["id", "type", "threshold", "severity", "from", "to", "layer", "allow", "evidence_tier"]));
  if (typeof rule.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rule.id)) throw new Error("pulse rule id is invalid");
  if (!RULE_TYPES.has(rule.type)) throw new Error(`unsupported pulse rule type: ${rule.type}`);
  if (rule.threshold != null && (!Number.isFinite(rule.threshold) || rule.threshold < 0)) throw new Error(`pulse rule ${rule.id} threshold must be non-negative`);
  if (rule.severity != null && !RULE_SEVERITIES.has(rule.severity)) throw new Error(`pulse rule ${rule.id} severity is invalid`);
  if (rule.evidence_tier != null && !EVIDENCE_TIERS.has(rule.evidence_tier)) throw new Error(`pulse rule ${rule.id} evidence tier is invalid`);
  for (const key of ["from", "to", "layer"]) if (rule[key] != null) configPath(rule[key], `pulse rule ${rule.id} ${key}`);
}

function validateWaiver(waiver) {
  exactObject(waiver, "pulse waiver", ["fingerprint", "owner", "reason", "approved_by", "created_at", "expires_at", "integrity"], new Set(["fingerprint", "owner", "reason", "issue", "approved_by", "created_at", "expires_at", "integrity"]));
  if (!/^[a-z-]+:[a-f0-9]{64}$/.test(waiver.fingerprint ?? "")) throw new Error("pulse waiver fingerprint is invalid");
  for (const key of ["owner", "reason", "approved_by"]) if (typeof waiver[key] !== "string" || !waiver[key].trim()) throw new Error(`pulse waiver ${key} is required`);
  for (const key of ["created_at", "expires_at"]) if (!Number.isFinite(Date.parse(waiver[key] ?? ""))) throw new Error(`pulse waiver ${key} is invalid`);
  if (!waiver.integrity || waiver.integrity.algorithm !== "SHA-256" || !/^[a-f0-9]{64}$/.test(waiver.integrity.digest ?? "")) throw new Error("pulse waiver integrity is invalid");
}

export function validatePulseConfig(config = {}) {
  exactObject(config, "pulse configuration", [], CONFIG_KEYS);
  if (config.schema_version != null && !new Set([1, 2]).has(config.schema_version)) throw new Error("pulse configuration contract is invalid");
  for (const key of ["include", "exclude", "boundaries", "bridges", "components", "layers", "rules", "waivers", "external_packages", "public_apis"]) {
    if (config[key] != null && (!Array.isArray(config[key]) || config[key].length > 256)) throw new Error(`pulse configuration ${key} must be an array with at most 256 items`);
  }
  for (const key of ["include", "exclude", "external_packages", "public_apis"]) for (const value of config[key] ?? []) configPath(value, `pulse configuration ${key}`);
  for (const [name, maximum] of Object.entries(LIMIT_MAXIMUMS)) {
    if (config[name] == null) continue;
    if (!Number.isInteger(config[name]) || config[name] < 1 || config[name] > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  if (config.blocking_minimum_tier != null && !EVIDENCE_TIERS.has(config.blocking_minimum_tier)) throw new Error("pulse blocking_minimum_tier is invalid");
  if (config.resolvers != null) {
    exactObject(config.resolvers, "pulse resolvers", [], new Set(["typescript", "python", "go", "rust", "jvm", "csharp"]));
    for (const [key, value] of Object.entries(config.resolvers)) if (typeof value !== "boolean") throw new Error(`pulse resolver ${key} must be boolean`);
  }
  if (config.cache != null) {
    exactObject(config.cache, "pulse cache", [], new Set(["enabled", "directory"]));
    if (config.cache.enabled != null && typeof config.cache.enabled !== "boolean") throw new Error("pulse cache enabled must be boolean");
    if (config.cache.directory != null) configPath(config.cache.directory, "pulse cache directory");
  }
  for (const boundary of config.boundaries ?? []) {
    exactObject(boundary, "pulse boundary", ["name", "from"], new Set(["name", "from", "allow", "deny", "owner"]));
    if (typeof boundary.name !== "string" || !boundary.name.trim()) throw new Error("pulse boundary name must be a non-empty string");
    configPath(boundary.from, "pulse boundary from");
    for (const key of ["allow", "deny"]) for (const value of boundary[key] ?? []) configPath(value, `pulse boundary ${key}`);
  }
  for (const bridge of config.bridges ?? []) {
    exactObject(bridge, "pulse bridge", ["from", "to"], new Set(["id", "from", "to", "kind"]));
    configPath(bridge.from, "pulse bridge from");
    configPath(bridge.to, "pulse bridge to");
  }
  for (const component of config.components ?? []) {
    exactObject(component, "pulse component", ["id", "paths"], new Set(["id", "paths", "owner", "public_api"]));
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(component.id ?? "") || !Array.isArray(component.paths) || !component.paths.length) throw new Error("pulse component is invalid");
    for (const value of component.paths) configPath(value, "pulse component path");
    for (const value of component.public_api ?? []) configPath(value, "pulse component public API");
  }
  for (const layer of config.layers ?? []) {
    exactObject(layer, "pulse layer", ["id", "paths", "order"], new Set(["id", "paths", "order"]));
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(layer.id ?? "") || !Array.isArray(layer.paths) || !layer.paths.length || !Number.isInteger(layer.order)) throw new Error("pulse layer is invalid");
    for (const value of layer.paths) configPath(value, "pulse layer path");
  }
  for (const rule of config.rules ?? []) validateRule(rule);
  for (const waiver of config.waivers ?? []) validateWaiver(waiver);
  return JSON.parse(canonicalJson(config));
}

function binaryBuffer(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function manifestLanguage(relative) {
  const name = path.posix.basename(relative);
  if (/\.(?:csproj|fsproj|vbproj|sln)$/.test(name)) return "msbuild-manifest";
  return MANIFEST_BY_NAME.get(name) ?? null;
}

function sourceLikeUnsupported(relative, config) {
  if (config.include?.length) return true;
  const first = relative.split("/")[0];
  const extension = path.extname(relative).toLowerCase();
  return SOURCE_DIRECTORIES.has(first) && !NON_SOURCE_EXTENSIONS.has(extension);
}

function readRevisionFile(root, revision, relative, deadline, maximum) {
  const result = runGit(root, ["show", `${revision}:${relative}`], { deadline, encoding: null, maxBuffer: maximum + 1024 });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error(`cannot read ${relative} from revision ${revision}`);
  return result.stdout;
}

function revalidateWorkingTreeSources(root, entries, deadline, maximum) {
  for (const entry of entries) {
    deadline.check("source snapshot revalidation");
    const absolute = path.resolve(root, entry.path);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("scanned source escaped repository root during revalidation");
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maximum) throw new Error(`scanned source changed to an unsafe file: ${entry.path}`);
    if (pulseDigest(fs.readFileSync(absolute)) !== entry.content_hash) throw new Error(`scanned source changed during analysis: ${entry.path}`);
  }
}

export function scanRepository(options = {}) {
  const root = fs.realpathSync(path.resolve(options.target ?? process.cwd()));
  const config = validatePulseConfig(options.config ?? {});
  const limits = {
    max_files: Number(config.max_files ?? 20000),
    max_file_bytes: Number(config.max_file_bytes ?? 2 * 1024 * 1024),
    max_total_bytes: Number(config.max_total_bytes ?? 64 * 1024 * 1024),
    timeout_ms: Number(config.timeout_ms ?? 30000),
    max_artifact_bytes: Number(config.max_artifact_bytes ?? 8 * 1024 * 1024),
    graph_shard_bytes: Number(config.graph_shard_bytes ?? 4 * 1024 * 1024)
  };
  const deadline = options.deadline ?? createPulseDeadline(limits.timeout_ms);
  const revisionInventory = options.revision ? gitRevisionInventory(root, options.revision, deadline) : null;
  const revision = revisionInventory?.commit ?? null;
  const candidates = (revisionInventory?.candidates ?? gitInventory(root, deadline)).filter((candidate) => !INTERNAL_STATE.test(candidate.path)).sort((left, right) => left.path.localeCompare(right.path));
  const boundedCandidates = candidates.slice(0, limits.max_files);
  const entries = [];
  const exclusions = [];
  const reasonCounts = {};
  const sourceCache = new Map();
  let totalBytes = 0;
  let resourceLimited = candidates.length > boundedCandidates.length;
  let truncated = candidates.length - boundedCandidates.length;
  const exclude = (file, reason, scope = "excluded_by_policy") => {
    exclusions.push({ path: file, reason, scope });
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  };
  for (let index = 0; index < boundedCandidates.length; index += 1) {
    deadline.check("repository scan");
    const candidate = boundedCandidates[index];
    const relative = normalizedRelative(root, candidate.path);
    if (!relative) { exclude(String(candidate.path), "unsafe_path", "unsupported_in_scope"); continue; }
    const excludedReason = excluded(relative, config);
    if (excludedReason) { exclude(relative, excludedReason); continue; }
    const language = LANGUAGE_BY_EXTENSION.get(path.extname(relative).toLowerCase()) ?? manifestLanguage(relative);
    if (!language) {
      exclude(relative, "unsupported_language", sourceLikeUnsupported(relative, config) ? "unsupported_in_scope" : "excluded_by_policy");
      continue;
    }
    let stat = null;
    let content;
    if (revision) {
      if ((candidate.size ?? 0) > limits.max_file_bytes) { exclude(relative, "oversized", "unsupported_in_scope"); continue; }
      try { content = readRevisionFile(root, revision, relative, deadline, limits.max_file_bytes); } catch { exclude(relative, "unreadable", "unsupported_in_scope"); continue; }
      stat = { size: content.length };
    } else {
      const absolute = path.resolve(root, relative);
      try { stat = fs.lstatSync(absolute); } catch { exclude(relative, "unreadable", "unsupported_in_scope"); continue; }
      if (stat.isSymbolicLink()) { exclude(relative, "symlink", "unsupported_in_scope"); continue; }
      if (!stat.isFile() || stat.nlink > 1) { exclude(relative, stat.nlink > 1 ? "hard_link" : "not_regular_file", "unsupported_in_scope"); continue; }
      let real;
      try { real = fs.realpathSync(absolute); } catch { exclude(relative, "unreadable", "unsupported_in_scope"); continue; }
      const realRelative = path.relative(root, real);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) { exclude(relative, "path_escape", "unsupported_in_scope"); continue; }
      if (stat.size > limits.max_file_bytes) { exclude(relative, "oversized", "unsupported_in_scope"); continue; }
      try { content = fs.readFileSync(real); } catch { exclude(relative, "unreadable", "unsupported_in_scope"); continue; }
    }
    if (totalBytes + stat.size > limits.max_total_bytes) { resourceLimited = true; exclude(relative, "resource_limit", "unsupported_in_scope"); continue; }
    if (binaryBuffer(content)) { exclude(relative, "binary", "unsupported_in_scope"); continue; }
    totalBytes += stat.size;
    const role = LANGUAGE_BY_EXTENSION.has(path.extname(relative).toLowerCase()) ? "source" : "manifest";
    entries.push({ path: relative, language, role, bytes: stat.size, content_hash: pulseDigest(content) });
    sourceCache.set(relative, content);
  }
  if (truncated) reasonCounts.resource_limit = (reasonCounts.resource_limit ?? 0) + truncated;
  const repository = currentPulseRepositoryState({ target: root, deadline, revision });
  if (!revision) revalidateWorkingTreeSources(root, entries, deadline, limits.max_file_bytes);
  if (!repository.available) {
    resourceLimited = true;
    reasonCounts.resource_limit = (reasonCounts.resource_limit ?? 0) + 1;
  }
  const analysisConfig = {
    include: config.include ?? [], exclude: config.exclude ?? [], limits,
    boundaries: config.boundaries ?? [], bridges: config.bridges ?? [], components: config.components ?? [],
    layers: config.layers ?? [], resolvers: config.resolvers ?? {}, external_packages: config.external_packages ?? [],
    public_apis: config.public_apis ?? []
  };
  const policyConfig = {
    rules: config.rules ?? [],
    waivers: config.waivers ?? [],
    blocking_minimum_tier: config.blocking_minimum_tier ?? (config.schema_version === 2 ? "RESOLVER_VERIFIED" : "SOURCE_FALLBACK")
  };
  const sourceDigest = pulseDigest(entries.map(({ path: file, language, role, bytes, content_hash }) => ({ path: file, language, role, bytes, content_hash })));
  const unsupportedInScope = exclusions.filter((item) => item.scope === "unsupported_in_scope").length + truncated;
  const supportedInScope = entries.filter((entry) => entry.role === "source").length;
  const excludedByPolicy = exclusions.filter((item) => item.scope === "excluded_by_policy").length;
  const scopeTotal = supportedInScope + unsupportedInScope;
  const fileCoverage = scopeTotal ? supportedInScope / scopeTotal : 1;
  const status = resourceLimited || unsupportedInScope > 0 ? "DEGRADED" : "COMPLETE";
  const inventory = {
    entries,
    exclusions,
    counts: {
      discovered: candidates.length,
      analyzed: supportedInScope,
      manifests: entries.filter((entry) => entry.role === "manifest").length,
      indexes: entries.filter((entry) => entry.role === "index").length,
      supported_in_scope: supportedInScope,
      unsupported_in_scope: unsupportedInScope,
      excluded_by_policy: excludedByPolicy,
      truncated,
      exclusion_reasons: reasonCounts
    },
    bytes_analyzed: totalBytes,
    file_coverage: Number(fileCoverage.toFixed(6)),
    source_digest: sourceDigest,
    analysis_config_digest: pulseDigest(analysisConfig),
    policy_digest: pulseDigest(policyConfig),
    config_digest: pulseDigest({ analysis: analysisConfig, policy: policyConfig }),
    limits,
    revision,
    status
  };
  const result = { root, repository, inventory, config, deadline };
  Object.defineProperty(result, "source_cache", { value: sourceCache, enumerable: false });
  return result;
}

export function readScannedSource(scan, entry) {
  scan.deadline?.check("source read");
  const cached = scan.source_cache?.get(entry.path);
  if (cached) {
    if (pulseDigest(cached) !== entry.content_hash) throw new Error(`scanned source changed during analysis: ${entry.path}`);
    return cached.toString("utf8");
  }
  const absolute = path.resolve(scan.root, entry.path);
  const relative = path.relative(scan.root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("scanned source escaped repository root");
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > scan.inventory.limits.max_file_bytes) throw new Error(`scanned source changed to an unsafe file: ${entry.path}`);
  const content = fs.readFileSync(absolute);
  if (pulseDigest(content) !== entry.content_hash) throw new Error(`scanned source changed during analysis: ${entry.path}`);
  return content.toString("utf8");
}
