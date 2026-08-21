import crypto from "node:crypto";

import {
  identitySummary,
  normalizeTeamSurface,
  rejectRestrictedTeamData,
  requireTeamCapability,
  safeTeamId,
  teamControlDigest,
  teamSurfacesOverlap,
  teamTimestamp,
  verifyTeamIdentityAuthentication
} from "./team-control-contract.mjs";
import { resolveTeamControlStoreLocation, withTeamControlStore } from "./team-control-store.mjs";

const INTEGRATION_FENCE_STATES = new Set(["ACTIVE", "RESULT_READY", "PACKAGE_QUEUED", "REVIEWED"]);
const WRITE_FENCE_STATES = new Set(["ACTIVE"]);
const CONFLICT_BLOCKING_STATES = new Set(["ACTIVE", "EXPIRED_PENDING_RECOVERY", "RESULT_READY", "PACKAGE_QUEUED", "REVIEWED"]);
const TERMINAL_CLAIM_STATES = new Set(["ADMITTED", "REJECTED", "RELEASED", "CANCELLED", "REVOKED"]);

export function resolveTeamRegistryLocation(options = {}) {
  const location = resolveTeamControlStoreLocation(options);
  return {
    root: location.root,
    common_git_dir: location.common_git_dir,
    repository_id: location.repository_id,
    database_file: location.database_file,
    registry_file: location.legacy_registry_file,
    lock_file: null
  };
}

function markExpiredClaims(snapshot, now) {
  let changed = false;
  for (const claim of snapshot.claims) {
    if (claim.status === "ACTIVE" && Date.parse(claim.expires_at) <= Date.parse(now)) {
      claim.status = "EXPIRED_PENDING_RECOVERY";
      claim.expired_at = now;
      changed = true;
    }
  }
  return changed;
}

function requireRevision(snapshot, expected) {
  if (expected != null && (!Number.isInteger(expected) || expected !== snapshot.revision)) throw new Error(`team control revision conflict: expected ${expected}, current ${snapshot.revision}`);
}

function identityFor(options, capability, now) {
  const repositoryResolver = options.resolveIdentityKey ?? ((keyId) => withTeamControlStore(options, (store) => store.getTrustedKey(keyId)));
  const identity = verifyTeamIdentityAuthentication(options.identity, {
    now,
    identitySecret: options.identitySecret,
    resolveIdentityKey: repositoryResolver,
    seenIdentityNonces: options.seenIdentityNonces
  });
  requireTeamCapability(identity, capability);
  return identity;
}

function advance(snapshot, store, type, now, data) {
  snapshot.revision += 1;
  snapshot.updated_at = now;
  store.appendEvent(snapshot, type, data, now);
}

function claimFor(snapshot, options) { return snapshot.claims.find((item) => item.claim_id === options.claimId); }

function mutationResult(mutation, result) {
  return { ...result, revision: mutation.snapshot.revision, registry_hash: teamControlDigest(mutation.snapshot) };
}

export function inspectTeamRegistry(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    markExpiredClaims(snapshot, now);
    return {
      schema_version: 2,
      repository_id: snapshot.repository_id,
      revision: snapshot.revision,
      fencing_counter: snapshot.fencing_counter,
      tasks: snapshot.tasks,
      claims: snapshot.claims,
      host_attestations: snapshot.host_attestations,
      events: snapshot.events,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
      storage: {
        authority: "GIT_COMMON_DIR",
        backend: "SQLITE_TRANSACTIONAL",
        common_git_dir: store.location.common_git_dir,
        database_file: store.location.database_file,
        health: store.health().status
      }
    };
  });
}

export function registerRepositoryTask(options = {}) {
  rejectRestrictedTeamData(options.record ?? {}, "task record");
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const identity = identityFor(options, "task.register", now);
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const taskId = safeTeamId(options.taskId, "task id");
      const existing = snapshot.tasks.find((item) => item.task_id === taskId);
      const status = options.status ?? "ACTIVE";
      if (!["ACTIVE", "BLOCKED", "COMPLETED", "CANCELLED"].includes(status)) throw new Error("repository task status is invalid");
      const record = { task_id: taskId, goal_hash: options.goalHash ?? null, parent_commit: options.parentCommit ?? null, status, registered_by: identitySummary(identity), updated_at: now };
      if (record.goal_hash && !/^[a-f0-9]{64}$/.test(record.goal_hash)) throw new Error("task goal_hash must be a SHA-256 digest");
      if (record.parent_commit && !/^[a-f0-9]{40,64}$/.test(record.parent_commit)) throw new Error("task parent_commit must be a full Git digest");
      if (existing && existing.registered_by.principal_id !== identity.principal_id && !identity.roles.includes("team-lead") && !identity.roles.includes("operator")) throw new Error("principal cannot update another principal's repository task");
      if (existing) Object.assign(existing, record); else snapshot.tasks.push({ ...record, created_at: now });
      advance(snapshot, store, existing ? "TASK_UPDATED" : "TASK_REGISTERED", now, { task_id: taskId, principal_id: identity.principal_id });
      return taskId;
    }, { now });
    const task = mutation.snapshot.tasks.find((item) => item.task_id === mutation.result);
    return mutationResult(mutation, { task: structuredClone(task) });
  });
}

export function acquireRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const taskId = safeTeamId(options.taskId, "task id");
      const assignmentId = safeTeamId(options.assignmentId, "assignment id");
      if (!snapshot.tasks.some((item) => item.task_id === taskId && item.status === "ACTIVE")) throw new Error("an active repository task is required before claiming work");
      const surfaces = (options.surfaces ?? []).map(normalizeTeamSurface);
      if (!surfaces.length || surfaces.length > 200) throw new Error("repository claim requires 1-200 surfaces");
      const capability = surfaces.some((item) => item.mode === "WRITE") ? "claim.write" : "claim.read";
      const identity = identityFor(options, capability, now);
      const conflict = snapshot.claims.find((claim) => CONFLICT_BLOCKING_STATES.has(claim.status) && claim.surfaces.some((left) => surfaces.some((right) => teamSurfacesOverlap(left, right))));
      if (conflict) {
        const recovery = conflict.status === "EXPIRED_PENDING_RECOVERY" ? "; explicit operator takeover evidence is required" : "";
        throw new Error(`repository scope conflicts with ${conflict.status.toLowerCase()} claim ${conflict.claim_id} from task ${conflict.task_id}${recovery}`);
      }
      const leaseSeconds = options.leaseSeconds ?? 900;
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw new Error("leaseSeconds must be an integer from 30 to 3600");
      snapshot.fencing_counter += 1;
      const claim = {
        claim_id: `repo-claim-${crypto.randomUUID()}`,
        task_id: taskId,
        assignment_id: assignmentId,
        principal: identitySummary(identity),
        surfaces,
        workspace: options.workspace ?? null,
        fencing_token: snapshot.fencing_counter,
        status: "ACTIVE",
        claimed_at: now,
        expires_at: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(),
        heartbeat_at: null
      };
      rejectRestrictedTeamData(claim, "repository claim");
      snapshot.claims.push(claim);
      advance(snapshot, store, "CLAIM_ACQUIRED", now, { task_id: taskId, assignment_id: assignmentId, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token });
      return claim.claim_id;
    }, { now });
    const claim = mutation.snapshot.claims.find((item) => item.claim_id === mutation.result);
    return mutationResult(mutation, { claim: structuredClone(claim) });
  });
}

export function heartbeatRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const identity = identityFor(options, "claim.renew", now);
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const claim = claimFor(snapshot, options);
      if (!claim || claim.status !== "ACTIVE" || claim.principal.principal_id !== identity.principal_id || claim.fencing_token !== options.fencingToken) throw new Error("active matching repository claim and fencing token are required");
      const leaseSeconds = options.leaseSeconds ?? 900;
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw new Error("leaseSeconds must be an integer from 30 to 3600");
      claim.heartbeat_at = now;
      claim.expires_at = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
      advance(snapshot, store, "CLAIM_HEARTBEAT", now, { task_id: claim.task_id, assignment_id: claim.assignment_id, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token });
      return claim.claim_id;
    }, { now });
    const claim = mutation.snapshot.claims.find((item) => item.claim_id === mutation.result);
    return mutationResult(mutation, { claim_id: claim.claim_id, fencing_token: claim.fencing_token, expires_at: claim.expires_at });
  });
}

export function markRepositoryResultReady(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const identity = identityFor(options, "result.publish", now);
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const claim = claimFor(snapshot, options);
      if (!claim || !["ACTIVE", "RESULT_READY"].includes(claim.status) || claim.principal.principal_id !== identity.principal_id || claim.fencing_token !== options.fencingToken) throw new Error("matching active writer claim and fencing token are required to publish a result");
      const evidenceHashes = [...new Set(options.evidenceHashes ?? [])].sort();
      if (!evidenceHashes.length || evidenceHashes.some((item) => !/^[a-f0-9]{64}$/.test(item))) throw new Error("completion receipt requires SHA-256 evidence hashes");
      const outputCommit = options.outputCommit ?? claim.workspace?.commit ?? null;
      if (outputCommit && !/^[a-f0-9]{40,64}$/.test(outputCommit)) throw new Error("completion receipt output commit must be a full Git digest");
      const receiptBase = {
        schema_version: 1,
        receipt_id: options.receiptId ?? `completion-${crypto.randomUUID()}`,
        task_id: claim.task_id,
        assignment_id: claim.assignment_id,
        claim_id: claim.claim_id,
        fencing_token: claim.fencing_token,
        principal_id: identity.principal_id,
        workspace_snapshot_hash: claim.workspace?.snapshot_hash ?? null,
        output_commit: outputCommit,
        diff_hash: options.diffHash ?? null,
        evidence_hashes: evidenceHashes,
        created_at: now
      };
      if (receiptBase.diff_hash && !/^[a-f0-9]{64}$/.test(receiptBase.diff_hash)) throw new Error("completion receipt diff hash must be SHA-256");
      const existing = snapshot.completion_receipts.find((item) => item.claim_id === claim.claim_id);
      if (existing) {
        const sameEvidence = existing.fencing_token === receiptBase.fencing_token
          && existing.principal_id === receiptBase.principal_id
          && existing.output_commit === receiptBase.output_commit
          && existing.diff_hash === receiptBase.diff_hash
          && teamControlDigest(existing.evidence_hashes) === teamControlDigest(receiptBase.evidence_hashes);
        if (!sameEvidence) throw new Error("claim result was already frozen with different evidence");
        return existing.receipt_id;
      }
      const receipt = { ...receiptBase, receipt_hash: teamControlDigest(receiptBase), package_id: null };
      claim.status = "RESULT_READY";
      claim.result_ready_at = now;
      claim.completion_receipt_id = receipt.receipt_id;
      snapshot.completion_receipts.push(receipt);
      advance(snapshot, store, "CLAIM_RESULT_READY", now, { task_id: claim.task_id, assignment_id: claim.assignment_id, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token, receipt_hash: receipt.receipt_hash });
      return receipt.receipt_id;
    }, { now });
    const receipt = mutation.snapshot.completion_receipts.find((item) => item.receipt_id === mutation.result);
    return mutationResult(mutation, { receipt: structuredClone(receipt) });
  });
}

export function releaseRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const identity = identityFor(options, "claim.release", now);
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const claim = claimFor(snapshot, options);
      if (!claim) return { released: false, claim_id: null };
      if (claim.principal.principal_id !== identity.principal_id && !identity.roles.includes("team-lead") && !identity.roles.includes("operator")) throw new Error("principal cannot release another principal's claim");
      if (claim.fencing_token !== options.fencingToken) throw new Error("repository claim fencing token mismatch");
      if (TERMINAL_CLAIM_STATES.has(claim.status)) return { released: false, claim_id: claim.claim_id, status: claim.status };
      const status = options.status ?? "RELEASED";
      if (!["RELEASED", "CANCELLED", "REVOKED"].includes(status)) throw new Error("repository claim release cannot synthesize an integration decision");
      if (status === "REVOKED" && !identity.roles.includes("team-lead") && !identity.roles.includes("operator")) throw new Error("repository claim revocation requires operator or team-lead role");
      if (["RESULT_READY", "PACKAGE_QUEUED", "REVIEWED"].includes(claim.status) && status !== "REVOKED") throw new Error("a frozen integration claim can only terminate through admission, rejection, or operator revocation");
      claim.status = status;
      claim.released_at = now;
      advance(snapshot, store, "CLAIM_RELEASED", now, { task_id: claim.task_id, assignment_id: claim.assignment_id, claim_id: claim.claim_id, principal_id: identity.principal_id, fencing_token: claim.fencing_token, terminal_status: status });
      return { released: true, claim_id: claim.claim_id, status };
    }, { now });
    return mutationResult(mutation, mutation.result);
  });
}

export function takeoverRepositoryClaim(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const identity = identityFor(options, "claim.takeover", now);
  if (!identity.roles.includes("operator") && !identity.roles.includes("team-lead")) throw new Error("claim takeover requires operator or team-lead role");
  if (!/^[a-f0-9]{64}$/.test(options.recoveryEvidenceHash ?? "")) throw new Error("claim takeover requires a SHA-256 recovery evidence hash");
  const leaseSeconds = options.leaseSeconds ?? 900;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw new Error("leaseSeconds must be an integer from 30 to 3600");
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      markExpiredClaims(snapshot, now);
      requireRevision(snapshot, options.expectedRevision);
      const stale = claimFor(snapshot, options);
      if (!stale || stale.status !== "EXPIRED_PENDING_RECOVERY") throw new Error("only an expired claim pending recovery can be taken over");
      stale.status = "REVOKED";
      stale.released_at = now;
      stale.recovery_evidence_hash = options.recoveryEvidenceHash;
      snapshot.fencing_counter += 1;
      const replacement = {
        ...structuredClone(stale),
        claim_id: `repo-claim-${crypto.randomUUID()}`,
        principal: identitySummary(identity),
        fencing_token: snapshot.fencing_counter,
        status: "ACTIVE",
        claimed_at: now,
        expires_at: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString(),
        heartbeat_at: null,
        takeover_of: stale.claim_id
      };
      delete replacement.released_at;
      snapshot.claims.push(replacement);
      advance(snapshot, store, "CLAIM_TAKEN_OVER", now, { task_id: replacement.task_id, assignment_id: replacement.assignment_id, claim_id: replacement.claim_id, prior_claim_id: stale.claim_id, principal_id: identity.principal_id, fencing_token: replacement.fencing_token, recovery_evidence_hash: options.recoveryEvidenceHash });
      return replacement.claim_id;
    }, { now });
    const claim = mutation.snapshot.claims.find((item) => item.claim_id === mutation.result);
    return mutationResult(mutation, { claim: structuredClone(claim) });
  });
}

export function validateRepositoryFence(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    markExpiredClaims(snapshot, now);
    const claim = claimFor(snapshot, options);
    const acceptedStates = options.purpose === "INTEGRATION" ? INTEGRATION_FENCE_STATES : WRITE_FENCE_STATES;
    const valid = Boolean(claim && acceptedStates.has(claim.status) && claim.fencing_token === options.fencingToken && (!options.principalId || claim.principal.principal_id === options.principalId));
    return { schema_version: 2, status: valid ? "VALID" : "STALE_OR_INVALID", purpose: options.purpose ?? "WRITE", claim_id: options.claimId, fencing_token: options.fencingToken, current_status: claim?.status ?? "MISSING", current_fencing_token: claim?.fencing_token ?? null, repository_revision: snapshot.revision };
  });
}

export function consumeHostAttestation(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  if (!/^[a-f0-9]{64}$/.test(options.attestationHash ?? "")) throw new Error("host attestation hash must be a SHA-256 digest");
  const nonceKey = safeTeamId(options.nonceKey, "host attestation nonce key");
  const expiresAt = teamTimestamp(options.expiresAt, "host attestation expiry");
  if (Date.parse(expiresAt) <= Date.parse(now) || Date.parse(expiresAt) - Date.parse(now) > 3_600_000) throw new Error("host attestation expiry must be within the next hour");
  const identity = identityFor(options, "task.register", now);
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      requireRevision(snapshot, options.expectedRevision);
      snapshot.host_attestations = snapshot.host_attestations.filter((item) => Date.parse(item.expires_at) > Date.parse(now));
      if (snapshot.host_attestations.some((item) => item.attestation_hash === options.attestationHash || item.nonce_key === nonceKey)) throw new Error("host attestation was already consumed");
      snapshot.host_attestations.push({ attestation_hash: options.attestationHash, nonce_key: nonceKey, expires_at: expiresAt, consumed_by: identity.principal_id, consumed_at: now });
      advance(snapshot, store, "HOST_ATTESTATION_CONSUMED", now, { principal_id: identity.principal_id, attestation_hash: options.attestationHash, nonce_key: nonceKey });
      return true;
    }, { now });
    return mutationResult(mutation, { status: "CONSUMED" });
  });
}

export function inspectTeamRegistryHealth(options = {}) {
  return withTeamControlStore(options, (store) => store.health());
}

export function migrateLegacyTeamRegistry(options = {}) {
  return withTeamControlStore(options, (store) => options.apply ? store.applyLegacyMigration(options) : store.previewLegacyMigration());
}
