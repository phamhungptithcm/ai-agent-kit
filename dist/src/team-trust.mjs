import {
  requireTeamCapability,
  safeTeamId,
  teamControlDigest,
  teamTimestamp,
  verifySignedTeamAction,
  verifyTeamIdentityAuthentication
} from "./team-control-contract.mjs";
import { withTeamControlStore } from "./team-control-store.mjs";

function authenticateTrustAdministrator(options, store, now) {
  const existing = store.listTrustedKeys();
  if (!existing.length) {
    if (!options.bootstrap || !/^[a-f0-9]{64}$/.test(options.approvalHash ?? "")) throw new Error("initial team trust bootstrap requires explicit approval evidence");
    return { principal_id: safeTeamId(options.approvedBy, "trust bootstrap approver"), bootstrap: true };
  }
  const identity = verifyTeamIdentityAuthentication(options.identity, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId) });
  requireTeamCapability(identity, "trust.admin");
  if (!identity.roles.includes("operator") && !identity.roles.includes("team-lead")) throw new Error("team trust administration requires operator or team-lead role");
  return identity;
}

function authorizeTrustMutation(options, store, administrator, operation, payloadHash, now) {
  if (administrator.bootstrap) return null;
  const action = verifySignedTeamAction(options.actionEnvelope, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId), repositoryId: store.location.repository_id, operation, payloadHash });
  const revision = store.health().revision;
  if (action.principal_id !== administrator.principal_id || action.expected_revision !== revision) throw new Error("signed trust action principal or revision mismatch");
  store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
  return action;
}

export function registerTeamTrustedKey(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withTeamControlStore(options, (store) => {
    const execute = store.database.transaction(() => {
      const administrator = authenticateTrustAdministrator(options, store, now);
      const action = authorizeTrustMutation(options, store, administrator, "trust.register", teamControlDigest(options.key), now);
      const authorizationEvidenceHash = administrator.bootstrap ? options.approvalHash : teamControlDigest({ ...action, signature: options.actionEnvelope.signature });
      const key = store.putTrustedKey(options.key, { now, replace: Boolean(options.replace), administeredBy: administrator.principal_id, authorizationEvidenceHash });
      return {
        schema_version: 1,
        status: key.duplicate ? "UNCHANGED" : "TRUSTED",
        key: { ...key, public_key_pem: undefined },
        administered_by: administrator.principal_id,
        bootstrap: Boolean(administrator.bootstrap),
        approval_hash: options.approvalHash ?? null,
        receipt_hash: teamControlDigest({ key_id: key.key_id, record_hash: key.record_hash, administered_by: administrator.principal_id, now })
      };
    });
    return execute.immediate();
  });
}

export function revokeTeamTrustedKey(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  return withTeamControlStore(options, (store) => {
    const execute = store.database.transaction(() => {
      const administrator = authenticateTrustAdministrator(options, store, now);
      const keyId = safeTeamId(options.keyId, "trusted key id");
      const action = authorizeTrustMutation(options, store, administrator, "trust.revoke", teamControlDigest({ key_id: keyId }), now);
      const authorizationEvidenceHash = administrator.bootstrap ? options.approvalHash : teamControlDigest({ ...action, signature: options.actionEnvelope.signature });
      const key = store.revokeTrustedKey(keyId, { now, administeredBy: administrator.principal_id, authorizationEvidenceHash });
      return { schema_version: 1, status: "REVOKED", key_id: key.key_id, administered_by: administrator.principal_id, revoked_at: now };
    });
    return execute.immediate();
  });
}

export function inspectTeamTrust(options = {}) {
  return withTeamControlStore(options, (store) => ({
    schema_version: 1,
    repository_id: store.location.repository_id,
    keys: store.listTrustedKeys().map(({ public_key_pem: ignored, ...key }) => key)
  }));
}

export function resolveRepositoryTeamKey(options = {}) {
  return (keyId) => withTeamControlStore(options, (store) => store.getTrustedKey(keyId));
}
