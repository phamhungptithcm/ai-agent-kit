import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { identitySummary, normalizeTeamSurface, rejectRestrictedTeamData, requireTeamCapability, safeTeamId, teamControlDigest, teamSurfacesOverlap, teamTimestamp, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";
import { resolveRepositoryIdentity } from "./memory-contract.mjs";

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const MAX_TASKS = 2000;
const MAX_CLAIMS = 10000;
const MAX_EVENTS = 20000;
const MAX_HOST_ATTESTATIONS = 10000;
const DEFAULT_LOCK_STALE_MS = 30_000;

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function resolveTeamRegistryLocation(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const commonRaw = options.commonGitDir ?? git(root, ["rev-parse", "--git-common-dir"]);
  const commonGitPath = path.resolve(root, commonRaw);
  if (!fs.existsSync(commonGitPath) || !fs.lstatSync(commonGitPath).isDirectory()) throw new Error("Git common directory is unavailable");
  const commonGitDir = fs.realpathSync(commonGitPath);
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity({ target: root });
  const stateDirectory = path.join(commonGitDir, "ai-agent-kit", "team-control");
  let current = commonGitDir;
  for (const part of ["ai-agent-kit", "team-control"]) { current = path.join(current, part); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("team registry state path cannot contain symbolic links"); }
  return {
    root,
    common_git_dir: commonGitDir,
    repository_id: identity.repository_id,
    registry_file: path.join(stateDirectory, `${identity.repository_id}.json`),
    lock_file: path.join(stateDirectory, `${identity.repository_id}.lock`)
  };
}

function emptyRegistry(location, now) {
  const registry = { schema_version: 1, repository_id: location.repository_id, revision: 0, fencing_counter: 0, tasks: [], claims: [], host_attestations: [], events: [], created_at: now, updated_at: now };
  return seal(registry);
}

function seal(registry) {
  const copy = structuredClone(registry); delete copy.registry_hash;
  registry.registry_hash = teamControlDigest(copy); return registry;
}

function verify(registry, location) {
  if (!registry || registry.schema_version !== 1 || registry.repository_id !== location.repository_id) throw new Error("team registry contract is invalid");
  const copy = structuredClone(registry); const claimed = copy.registry_hash; delete copy.registry_hash;
  if (!claimed || claimed !== teamControlDigest(copy)) throw new Error("team registry hash mismatch");
  return registry;
}

function read(location, now, create = true) {
  if (!fs.existsSync(location.registry_file)) {
    if (!create) throw new Error("team registry is missing");
    return emptyRegistry(location, now);
  }
  const stat = fs.lstatSync(location.registry_file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REGISTRY_BYTES) throw new Error("team registry must be a bounded regular file");
  try { return verify(JSON.parse(fs.readFileSync(location.registry_file, "utf8")), location); } catch (error) { if (error instanceof SyntaxError) throw new Error("team registry contains invalid JSON"); throw error; }
}

function write(location, registry) {
  if (registry.tasks.length > MAX_TASKS || registry.claims.length > MAX_CLAIMS || registry.host_attestations.length > MAX_HOST_ATTESTATIONS || registry.events.length > MAX_EVENTS) throw new Error("team registry storage budget exceeded");
  fs.mkdirSync(path.dirname(location.registry_file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(location.registry_file) && fs.lstatSync(location.registry_file).isSymbolicLink()) throw new Error("team registry cannot be a symbolic link");
  const sealed = seal(registry); const serialized = `${JSON.stringify(sealed, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_REGISTRY_BYTES) throw new Error("team registry exceeds its byte budget");
  const temporary = `${location.registry_file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try { fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, location.registry_file); }
  catch (error) { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* preserve original error */ } throw error; }
  return sealed;
}

function withLock(location, options, callback) {
  fs.mkdirSync(path.dirname(location.lock_file), { recursive: true, mode: 0o700 });
  let descriptor; let recovered = false;
  try { descriptor = fs.openSync(location.lock_file, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(location.lock_file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("team registry lock is unsafe");
    if (Date.now() - stat.mtimeMs <= (options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS)) throw new Error("team registry is being updated; retry after the active transaction completes");
    fs.unlinkSync(location.lock_file); descriptor = fs.openSync(location.lock_file, "wx", 0o600); recovered = true;
  }
  try { return callback(recovered); }
  finally { fs.closeSync(descriptor); try { fs.unlinkSync(location.lock_file); } catch { /* next writer performs bounded recovery */ } }
}

function expireClaims(registry, now) {
  for (const claim of registry.claims) if (claim.status === "ACTIVE" && Date.parse(claim.expires_at) <= Date.parse(now)) claim.status = "EXPIRED";
}

function revision(registry, expected) {
  if (expected != null && (!Number.isInteger(expected) || expected !== registry.revision)) throw new Error(`team registry revision conflict: expected ${expected}, current ${registry.revision}`);
}

function event(registry, type, now, data) {
  registry.events.push({ sequence: registry.events.length ? registry.events.at(-1).sequence + 1 : 1, type, timestamp: now, ...data });
  if (registry.events.length > MAX_EVENTS) registry.events.splice(0, registry.events.length - MAX_EVENTS);
}

function identityFor(options, capability, now) {
  const identity = verifyTeamIdentityAuthentication(options.identity, { now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey, seenIdentityNonces: options.seenIdentityNonces }); requireTeamCapability(identity, capability); return identity;
}

export function inspectTeamRegistry(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options); const registry = read(location, now);
  expireClaims(registry, now);
  return { ...structuredClone(registry), storage: { authority: "GIT_COMMON_DIR", common_git_dir: location.common_git_dir, registry_file: location.registry_file } };
}

export function registerRepositoryTask(options = {}) {
  rejectRestrictedTeamData(options.record ?? {}, "task record");
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options); const identity = identityFor(options, "task.register", now);
  return withLock(location, options, (recovered) => {
    const registry = read(location, now); expireClaims(registry, now); revision(registry, options.expectedRevision);
    const taskId = safeTeamId(options.taskId, "task id"); const existing = registry.tasks.find((item) => item.task_id === taskId);
    const status = options.status ?? "ACTIVE"; if (!["ACTIVE", "BLOCKED", "COMPLETED", "CANCELLED"].includes(status)) throw new Error("repository task status is invalid");
    const record = { task_id: taskId, goal_hash: options.goalHash ?? null, parent_commit: options.parentCommit ?? null, status, registered_by: identitySummary(identity), updated_at: now };
    if (record.goal_hash && !/^[a-f0-9]{64}$/.test(record.goal_hash)) throw new Error("task goal_hash must be a SHA-256 digest");
    if (record.parent_commit && !/^[a-f0-9]{40,64}$/.test(record.parent_commit)) throw new Error("task parent_commit must be a full Git digest");
    if (existing && existing.registered_by.principal_id !== identity.principal_id && !identity.roles.includes("team-lead") && !identity.roles.includes("operator")) throw new Error("principal cannot update another principal's repository task");
    if (existing) Object.assign(existing, record); else registry.tasks.push({ ...record, created_at: now });
    registry.revision += 1; registry.updated_at = now; event(registry, existing ? "TASK_UPDATED" : "TASK_REGISTERED", now, { task_id: taskId, principal_id: identity.principal_id });
    if (recovered) event(registry, "STALE_LOCK_RECOVERED", now, { principal_id: identity.principal_id });
    const saved = write(location, registry); return { task: structuredClone(saved.tasks.find((item) => item.task_id === taskId)), revision: saved.revision, registry_hash: saved.registry_hash };
  });
}

export function acquireRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options);
  return withLock(location, options, (recovered) => {
    const registry = read(location, now); expireClaims(registry, now); revision(registry, options.expectedRevision);
    const taskId = safeTeamId(options.taskId, "task id"); const assignmentId = safeTeamId(options.assignmentId, "assignment id");
    if (!registry.tasks.some((item) => item.task_id === taskId && item.status === "ACTIVE")) throw new Error("an active repository task is required before claiming work");
    const surfaces = (options.surfaces ?? []).map(normalizeTeamSurface);
    if (!surfaces.length || surfaces.length > 200) throw new Error("repository claim requires 1-200 surfaces");
    const capability = surfaces.some((item) => item.mode === "WRITE") ? "claim.write" : "claim.read"; const identity = identityFor(options, capability, now);
    const conflict = registry.claims.find((claim) => claim.status === "ACTIVE" && claim.surfaces.some((left) => surfaces.some((right) => teamSurfacesOverlap(left, right))));
    if (conflict) throw new Error(`repository scope conflicts with active claim ${conflict.claim_id} from task ${conflict.task_id}`);
    const leaseSeconds = options.leaseSeconds ?? 900;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw new Error("leaseSeconds must be an integer from 30 to 3600");
    registry.fencing_counter += 1;
    const claim = {
      claim_id: `repo-claim-${crypto.randomUUID()}`, task_id: taskId, assignment_id: assignmentId,
      principal: identitySummary(identity), surfaces, workspace: options.workspace ?? null,
      fencing_token: registry.fencing_counter, status: "ACTIVE", claimed_at: now,
      expires_at: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(), heartbeat_at: null
    };
    rejectRestrictedTeamData(claim, "repository claim"); registry.claims.push(claim); registry.revision += 1; registry.updated_at = now;
    event(registry, "CLAIM_ACQUIRED", now, { task_id: taskId, assignment_id: assignmentId, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token });
    if (recovered) event(registry, "STALE_LOCK_RECOVERED", now, { principal_id: identity.principal_id });
    const saved = write(location, registry); return { claim: structuredClone(claim), revision: saved.revision, registry_hash: saved.registry_hash };
  });
}

export function heartbeatRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options);
  return withLock(location, options, () => {
    const registry = read(location, now); expireClaims(registry, now); revision(registry, options.expectedRevision); const identity = identityFor(options, "claim.renew", now);
    const claim = registry.claims.find((item) => item.claim_id === options.claimId && item.status === "ACTIVE");
    if (!claim || claim.principal.principal_id !== identity.principal_id || claim.fencing_token !== options.fencingToken) throw new Error("active matching repository claim and fencing token are required");
    const leaseSeconds = options.leaseSeconds ?? 900; if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw new Error("leaseSeconds must be an integer from 30 to 3600");
    claim.heartbeat_at = now; claim.expires_at = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(); registry.revision += 1; registry.updated_at = now;
    event(registry, "CLAIM_HEARTBEAT", now, { task_id: claim.task_id, assignment_id: claim.assignment_id, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token });
    const saved = write(location, registry); return { claim_id: claim.claim_id, fencing_token: claim.fencing_token, expires_at: claim.expires_at, revision: saved.revision, registry_hash: saved.registry_hash };
  });
}

export function releaseRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options);
  return withLock(location, options, () => {
    const registry = read(location, now); expireClaims(registry, now); revision(registry, options.expectedRevision); const identity = identityFor(options, "claim.release", now);
    const claim = registry.claims.find((item) => item.claim_id === options.claimId);
    if (!claim) return { released: false, revision: registry.revision, registry_hash: registry.registry_hash };
    if (claim.principal.principal_id !== identity.principal_id && !identity.roles.includes("team-lead") && !identity.roles.includes("operator")) throw new Error("principal cannot release another principal's claim");
    if (claim.fencing_token !== options.fencingToken) throw new Error("repository claim fencing token mismatch");
    if (claim.status !== "ACTIVE") return { released: false, status: claim.status, revision: registry.revision, registry_hash: registry.registry_hash };
    const status = options.status ?? "RELEASED"; if (!["RELEASED", "CANCELLED", "REVOKED"].includes(status)) throw new Error("repository claim release status is invalid");
    claim.status = status; claim.released_at = now; registry.revision += 1; registry.updated_at = now;
    event(registry, "CLAIM_RELEASED", now, { task_id: claim.task_id, assignment_id: claim.assignment_id, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token });
    const saved = write(location, registry); return { released: true, status: claim.status, revision: saved.revision, registry_hash: saved.registry_hash };
  });
}

export function validateRepositoryFence(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options); const registry = read(location, now); expireClaims(registry, now);
  const claim = registry.claims.find((item) => item.claim_id === options.claimId);
  const valid = Boolean(claim && claim.status === "ACTIVE" && claim.fencing_token === options.fencingToken && (!options.principalId || claim.principal.principal_id === options.principalId));
  return { schema_version: 1, status: valid ? "VALID" : "STALE_OR_INVALID", claim_id: options.claimId, fencing_token: options.fencingToken, current_status: claim?.status ?? "MISSING", current_fencing_token: claim?.fencing_token ?? null, repository_revision: registry.revision };
}

export function consumeHostAttestation(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString()); const location = resolveTeamRegistryLocation(options);
  if (!/^[a-f0-9]{64}$/.test(options.attestationHash ?? "")) throw new Error("host attestation hash must be a SHA-256 digest");
  const nonceKey = safeTeamId(options.nonceKey, "host attestation nonce key");
  const expiresAt = teamTimestamp(options.expiresAt, "host attestation expiry");
  if (Date.parse(expiresAt) <= Date.parse(now) || Date.parse(expiresAt) - Date.parse(now) > 3_600_000) throw new Error("host attestation expiry must be within the next hour");
  return withLock(location, options, () => {
    const registry = read(location, now); revision(registry, options.expectedRevision); const identity = identityFor(options, "task.register", now);
    registry.host_attestations = registry.host_attestations.filter((item) => Date.parse(item.expires_at) > Date.parse(now));
    if (registry.host_attestations.some((item) => item.attestation_hash === options.attestationHash || item.nonce_key === nonceKey)) throw new Error("host attestation was already consumed");
    registry.host_attestations.push({ attestation_hash: options.attestationHash, nonce_key: nonceKey, expires_at: expiresAt, consumed_by: identity.principal_id, consumed_at: now });
    registry.revision += 1; registry.updated_at = now;
    event(registry, "HOST_ATTESTATION_CONSUMED", now, { principal_id: identity.principal_id, attestation_hash: options.attestationHash, nonce_key: nonceKey });
    const saved = write(location, registry); return { status: "CONSUMED", revision: saved.revision, registry_hash: saved.registry_hash };
  });
}
