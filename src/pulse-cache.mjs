import fs from "node:fs";
import path from "node:path";
import { canonicalJson, pulseDigest } from "./pulse-contract.mjs";

const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function safeInside(root, requested, label) {
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the repository`);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link`);
  }
  return absolute;
}

function directory(scan) {
  const requested = scan.config.cache?.directory ?? ".ai-agent-kit/pulse/cache";
  return safeInside(scan.root, requested, "pulse cache directory");
}

export function pulseCacheKey(scan, versions) {
  return pulseDigest({
    repository_identity: scan.repository.identity_hash,
    source_digest: scan.inventory.source_digest,
    analysis_config_digest: scan.inventory.analysis_config_digest,
    ...versions
  });
}

export function readPulseAnalysisCache(scan, versions) {
  if (scan.config.cache?.enabled !== true) return { status: "DISABLED", analysis: null };
  const key = pulseCacheKey(scan, versions);
  const file = path.join(directory(scan), `${key}.json`);
  if (!fs.existsSync(file)) return { status: "MISS", key, analysis: null };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > MAX_CACHE_BYTES) return { status: "IGNORED_UNTRUSTED", key, analysis: null };
    const cache = JSON.parse(fs.readFileSync(file, "utf8"));
    const { integrity, ...body } = cache;
    if (cache.key !== key || integrity?.algorithm !== "SHA-256" || pulseDigest(body) !== integrity?.digest) return { status: "IGNORED_UNTRUSTED", key, analysis: null };
    return { status: "HIT", key, analysis: cache.analysis };
  } catch {
    return { status: "IGNORED_UNTRUSTED", key, analysis: null };
  }
}

export function writePulseAnalysisCache(scan, versions, analysis) {
  if (scan.config.cache?.enabled !== true) return { status: "DISABLED" };
  const key = pulseCacheKey(scan, versions);
  const body = { schema_version: 1, protocol: "aak-architecture-pulse-cache-v1", key, versions, analysis };
  const cache = { ...body, integrity: { algorithm: "SHA-256", digest: pulseDigest(body) } };
  const payload = `${JSON.stringify(cache)}\n`;
  if (Buffer.byteLength(payload) > MAX_CACHE_BYTES) return { status: "SKIPPED_BUDGET", key };
  const root = directory(scan);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${key}.json`);
  const temporary = path.join(root, `.${key}.${process.pid}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { status: "WRITTEN", key, digest: pulseDigest(canonicalJson(cache)) };
}
