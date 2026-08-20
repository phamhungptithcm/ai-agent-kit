import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";
import { buildProofReplay } from "./proof-replay.mjs";
import { getPackageVersion } from "./version.mjs";
import { readPulseDocument, verifyPulseFreshness } from "./pulse.mjs";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function canonical(value) { return JSON.stringify(stable(value)); }
function digest(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) || typeof value === "string" ? value : canonical(value)).digest("hex"); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }

function inside(root, rel) {
  const absolute = path.resolve(root, rel);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("passport path must remain inside the non-symlinked repository");
  return absolute;
}

function protect(root) {
  const directory = inside(root, ".ai-agent-kit");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, ".gitignore");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
  fs.writeFileSync(file, `${[...new Set([...lines, "local/", "passport/"])].join("\n")}\n`, { mode: 0o644 });
}

function readBounded(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file`);
  return fs.readFileSync(file);
}

function trustStore(root) {
  const file = inside(root, ".ai/passports/trusted-keys.json");
  if (!fs.existsSync(file)) return { schema_version: 1, keys: [] };
  const value = JSON.parse(readBounded(file, "passport trust store").toString("utf8"));
  if (value.schema_version !== 1 || !Array.isArray(value.keys)) throw new Error("passport trust store is invalid");
  return value;
}

export function generatePassportKey(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const keyId = safe(options.keyId ?? "local-passport", "passport key id");
  protect(root);
  const directory = inside(root, ".ai-agent-kit/local/passport-keys");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const privateFile = path.join(directory, `${keyId}.private.pem`);
  const publicFile = path.join(directory, `${keyId}.public.pem`);
  if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) throw new Error(`passport key already exists: ${keyId}`);
  const storeFile = inside(root, ".ai/passports/trusted-keys.json");
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const store = trustStore(root);
  if (store.keys.some((item) => item.key_id === keyId)) throw new Error(`passport trust store already contains ${keyId}`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  fs.writeFileSync(privateFile, privatePem, { mode: 0o600 });
  fs.writeFileSync(publicFile, publicPem, { mode: 0o644 });
  store.keys.push({ key_id: keyId, public_key: publicPem, revoked: false });
  fs.writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o644 });
  return { status: "CREATED", key_id: keyId, private_key: path.relative(root, privateFile), public_key: path.relative(root, publicFile), trust_store: path.relative(root, storeFile) };
}

function gitState(root, deps) {
  const run = deps.spawnSync ?? spawnSync;
  const commit = run("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  const changes = run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const trackedDiff = run("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], { cwd: root, encoding: "buffer", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (commit.status !== 0 || changes.status !== 0 || trackedDiff.status !== 0 || untracked.status !== 0) throw new Error("passport requires a readable Git repository");
  const records = changes.stdout.split("\0").filter(Boolean).map((entry) => ({ status: entry.slice(0, 2), path_hash: digest(entry.slice(3)) }));
  const untrackedFiles = untracked.stdout.split("\0").filter(Boolean).map((name) => {
    const file = inside(root, name);
    const stat = fs.lstatSync(file);
    return { path_hash: digest(name), content_hash: stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024 ? digest(fs.readFileSync(file)) : digest(`unsupported:${stat.mode}:${stat.size}`) };
  });
  return { commit: commit.stdout.trim(), dirty: records.length > 0, change_count: records.length, changes: records, tracked_diff_hash: digest(trackedDiff.stdout), untracked: untrackedFiles };
}

export function issueChangePassport(options, deps = {}) {
  if (!options.apply) throw new Error("passport issue requires --apply after reviewing proof and failure evidence");
  const root = path.resolve(options.target ?? process.cwd());
  const keyId = safe(options.keyId, "passport key id");
  const privateFile = inside(root, options.privateKey);
  const privateKey = crypto.createPrivateKey(readBounded(privateFile, "passport private key"));
  const publicPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const trusted = trustStore(root).keys.find((item) => item.key_id === keyId && item.public_key === publicPem && item.revoked !== true);
  if (!trusted) throw new Error("passport signing key is not trusted by this repository");
  const proof = (deps.buildProofReplay ?? buildProofReplay)(options, deps);
  if (proof.readiness.status !== "READY") throw new Error("passport can only be issued for a READY proof");
  let failure = null;
  if (options.failureReport) {
    const file = inside(root, options.failureReport);
    failure = JSON.parse(readBounded(file, "failure report").toString("utf8"));
    const copy = structuredClone(failure); delete copy.report_hash;
    if (failure.status !== "PASSED" || failure.report_hash !== digest(copy)) throw new Error("passport requires an untampered PASSED failure report");
  }
  let architecturePulse = { status: "NOT_RUN", outcome: null, evidence_digest: null };
  if (options.pulseResult) {
    const document = readPulseDocument({ target: root, file: options.pulseResult });
    if (document.governance?.task_id !== proof.task.id) throw new Error("passport Architecture Pulse evidence is not bound to the proof task");
    const freshness = verifyPulseFreshness(document, { target: root });
    if (freshness.status !== "VERIFIED") throw new Error(`passport rejects ${freshness.status.toLowerCase()} Architecture Pulse evidence: ${freshness.reason}`);
    if (document.protocol === "aak-architecture-pulse-v1") {
      if (document.analysis_status !== "COMPLETE" || document.confidence.band === "LOW") throw new Error("passport requires complete, sufficiently confident Architecture Pulse evidence");
      architecturePulse = { status: "VERIFIED", outcome: document.analysis_status, evidence_digest: document.result_digest, coverage: document.coverage.files, confidence: document.confidence.band };
    } else {
      if (["STALE", "UNTRUSTED", "DEGRADED"].includes(document.status) || document.blocking) throw new Error(`passport rejects Architecture Pulse outcome ${document.status}${document.blocking ? " with blocking regressions" : ""}`);
      architecturePulse = { status: "VERIFIED", outcome: document.status, evidence_digest: document.evidence_digest, coverage: document.current?.coverage?.files ?? null, confidence: document.current?.confidence?.band ?? null };
    }
  }
  const body = { schema_version: 1, type: "https://hunpeolabs.com/ai-agent-kit/change-passport/v1", issued_at: new Date().toISOString(), kit_version: getPackageVersion(), subject: { task_id: proof.task.id, proof_hash: proof.proof_hash }, repository: gitState(root, deps), assurance: { readiness: proof.readiness.status, evidence_integrity: proof.evidence.status, review: proof.quality.review.status, architecture_pulse: architecturePulse, failure_lab: failure ? { status: failure.status, report_hash: failure.report_hash, cases: failure.summary.total } : { status: "NOT_RUN", report_hash: null, cases: 0 } }, signer: { key_id: keyId, public_key: publicPem } };
  const signature = crypto.sign(null, Buffer.from(canonical(body)), privateKey).toString("base64");
  const passport = { ...body, signature, passport_hash: digest({ ...body, signature }) };
  protect(root);
  const output = inside(root, options.output ?? `.ai-agent-kit/passport/${proof.task.id}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(passport, null, 2)}\n`, { mode: 0o600 });
  return { status: "ISSUED", file: path.relative(root, output), passport_hash: passport.passport_hash, failure_lab: passport.assurance.failure_lab.status, architecture_pulse: passport.assurance.architecture_pulse.status };
}

export function verifyChangePassport(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const file = inside(root, options.file);
  let passport;
  try { passport = JSON.parse(readBounded(file, "change passport").toString("utf8")); } catch (error) { return { status: "REJECTED", reason: error.message }; }
  const { signature, passport_hash: claimedHash, ...body } = passport;
  if (!signature || !body.signer?.public_key || digest({ ...body, signature }) !== claimedHash) return { status: "REJECTED", reason: "passport hash mismatch" };
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(canonical(body)), body.signer.public_key, Buffer.from(signature, "base64")); } catch { valid = false; }
  if (!valid) return { status: "REJECTED", reason: "passport signature verification failed" };
  const trusted = trustStore(root).keys.some((item) => item.key_id === body.signer.key_id && item.public_key === body.signer.public_key && item.revoked !== true);
  const repositoryMatch = canonical(gitState(root, deps)) === canonical(body.repository);
  const status = !trusted ? "VALID_UNTRUSTED" : repositoryMatch ? "VERIFIED" : "STALE";
  return { status, trusted, repository_match: repositoryMatch, task_id: body.subject?.task_id, passport_hash: claimedHash, readiness: body.assurance?.readiness, architecture_pulse: body.assurance?.architecture_pulse ?? { status: "NOT_RUN" } };
}
