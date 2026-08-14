import crypto from "node:crypto";

import { normalizeTeamIdentity, safeTeamId, stableTeamValue, teamControlDigest, teamTimestamp } from "./team-control-contract.mjs";

function payload(attestation) {
  const copy = structuredClone(attestation); delete copy.signature; return stableTeamValue(copy);
}

export function signHostAttestation(attestation, secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("host attestation signing secret must contain at least 32 characters");
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload(attestation))).digest("hex");
}

export function verifyHostAttestation(attestation, options = {}) {
  if (!attestation || attestation.schema_version !== 1) throw new Error("host attestation contract is invalid");
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const normalized = {
    schema_version: 1,
    attestation_id: safeTeamId(attestation.attestation_id, "attestation id"),
    host_id: safeTeamId(attestation.host_id, "host id"),
    key_id: safeTeamId(attestation.key_id, "host key id"),
    nonce: safeTeamId(attestation.nonce, "host nonce"),
    issued_at: teamTimestamp(attestation.issued_at, "attestation issue time"),
    expires_at: teamTimestamp(attestation.expires_at, "attestation expiry"),
    identity: normalizeTeamIdentity(attestation.identity, { now }),
    capabilities: [...new Set((attestation.capabilities ?? []).map((item) => safeTeamId(item, "host capability")))].sort(),
    bridge_kind: safeTeamId(attestation.bridge_kind, "bridge kind")
  };
  if (normalized.identity.type !== "HOST" || normalized.identity.principal_id !== normalized.host_id) throw new Error("host identity does not match attested host");
  if (Date.parse(normalized.expires_at) <= Date.parse(now)) return { schema_version: 1, status: "REJECTED", reason: "EXPIRED", host_id: normalized.host_id };
  if (Date.parse(normalized.expires_at) - Date.parse(normalized.issued_at) > 3_600_000) return { schema_version: 1, status: "REJECTED", reason: "VALIDITY_TOO_LONG", host_id: normalized.host_id };
  if (Date.parse(normalized.issued_at) > Date.parse(now) + 300_000) return { schema_version: 1, status: "REJECTED", reason: "FUTURE_ISSUE_TIME", host_id: normalized.host_id };
  const replayKey = `${normalized.key_id}:${normalized.nonce}`;
  if (options.seenNonces?.has(replayKey)) return { schema_version: 1, status: "REJECTED", reason: "REPLAY", host_id: normalized.host_id };
  const secret = options.resolveKey?.(normalized.key_id);
  if (typeof secret !== "string") return { schema_version: 1, status: "UNVERIFIED", reason: "KEY_UNAVAILABLE", host_id: normalized.host_id };
  const expected = signHostAttestation(normalized, secret); const supplied = String(attestation.signature ?? "");
  const valid = /^[a-f0-9]{64}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  if (!valid) return { schema_version: 1, status: "REJECTED", reason: "SIGNATURE_INVALID", host_id: normalized.host_id };
  options.seenNonces?.add(replayKey);
  return { schema_version: 1, status: "VERIFIED", host_id: normalized.host_id, identity: normalized.identity, capabilities: normalized.capabilities, bridge_kind: normalized.bridge_kind, attestation_hash: teamControlDigest(normalized), expires_at: normalized.expires_at };
}
