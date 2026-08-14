import crypto from "node:crypto";
import path from "node:path";

export const TEAM_CONTROL_SCHEMA_VERSION = 1;
export const PRINCIPAL_TYPES = new Set(["MEMBER", "AGENT", "HOST", "SERVICE"]);
export const PRINCIPAL_ROLES = new Set(["team-lead", "implementer", "reviewer", "integration-owner", "operator", "observer"]);
export const TEAM_CAPABILITIES = new Set([
  "task.register", "claim.read", "claim.write", "claim.renew", "claim.release",
  "workspace.plan", "workspace.provision", "workspace.cleanup", "result.publish",
  "review.submit", "integration.enqueue", "integration.admit", "metrics.read"
]);
export const SURFACE_KINDS = new Set(["PATH", "SYMBOL", "API", "SCHEMA", "MIGRATION", "DEPENDENCY", "GENERATED"]);
export const CLAIM_MODES = new Set(["READ", "WRITE"]);

const FORBIDDEN_KEYS = new Set([
  "prompt", "raw_prompt", "system_prompt", "conversation", "chat_history", "chain_of_thought",
  "reasoning", "credential", "credentials", "secret", "secrets", "source_body", "raw_tool_output"
]);

export function stableTeamValue(value) {
  if (Array.isArray(value)) return value.map(stableTeamValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableTeamValue(value[key])]));
  return value;
}

export function teamControlDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableTeamValue(value))).digest("hex");
}

export function safeTeamId(value, label = "identifier") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(String(value ?? ""))) throw new Error(`${label} must be a safe bounded identifier`);
  return String(value);
}

export function teamTimestamp(value, label = "timestamp") {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`);
  return new Date(value).toISOString();
}

export function rejectRestrictedTeamData(value, current = "team-control") {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectRestrictedTeamData(item, `${current}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`${current}.${key} is forbidden in team-control state`);
    rejectRestrictedTeamData(child, `${current}.${key}`);
  }
}

function boundedSet(values, label, allowed, max = 50) {
  if (!Array.isArray(values) || values.length > max) throw new Error(`${label} must be a bounded array`);
  const result = [...new Set(values.map((value) => String(value)))].sort();
  if (result.some((value) => !allowed.has(value))) throw new Error(`${label} contains an unsupported value`);
  return result;
}

export function normalizeTeamIdentity(input, options = {}) {
  rejectRestrictedTeamData(input, "identity");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("team identity must be an object");
  const now = Date.parse(options.now ?? new Date().toISOString());
  const type = String(input.type ?? "").toUpperCase();
  if (!PRINCIPAL_TYPES.has(type)) throw new Error("team identity type is invalid");
  const expiresAt = teamTimestamp(input.expires_at, "identity expiry");
  if (Date.parse(expiresAt) <= now) throw new Error("team identity is expired");
  const evidenceDigest = String(input.evidence_digest ?? "");
  if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) throw new Error("identity evidence_digest must be a SHA-256 digest");
  const identity = {
    schema_version: TEAM_CONTROL_SCHEMA_VERSION,
    principal_id: safeTeamId(input.principal_id, "principal id"),
    type,
    issuer: safeTeamId(input.issuer, "identity issuer"),
    subject: safeTeamId(input.subject, "identity subject"),
    roles: boundedSet(input.roles ?? [], "identity roles", PRINCIPAL_ROLES, 20),
    capabilities: boundedSet(input.capabilities ?? [], "identity capabilities", TEAM_CAPABILITIES, 50),
    issued_at: teamTimestamp(input.issued_at, "identity issue time"),
    expires_at: expiresAt,
    evidence_digest: evidenceDigest,
    authentication: input.authentication ? {
      method: String(input.authentication.method ?? "").toUpperCase(),
      key_id: safeTeamId(input.authentication.key_id, "identity authentication key id"),
      nonce: safeTeamId(input.authentication.nonce, "identity authentication nonce"),
      signature: String(input.authentication.signature ?? "")
    } : null
  };
  if (identity.authentication && (identity.authentication.method !== "HMAC_SHA256" || !/^[a-f0-9]{64}$/.test(identity.authentication.signature))) throw new Error("identity authentication is invalid");
  if (Date.parse(identity.issued_at) > now + 300_000) throw new Error("identity issue time is in the future");
  return identity;
}

function identityAuthenticationPayload(identity) {
  const copy = structuredClone(identity); if (copy.authentication) delete copy.authentication.signature; return stableTeamValue(copy);
}

export function signTeamIdentity(identity, secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("identity signing secret must contain at least 32 characters");
  if (!identity?.authentication?.key_id || !identity?.authentication?.nonce) throw new Error("identity signing requires authentication key_id and nonce");
  const copy = structuredClone(identity); copy.authentication = { ...copy.authentication, method: "HMAC_SHA256", signature: "" };
  return crypto.createHmac("sha256", secret).update(JSON.stringify(identityAuthenticationPayload(copy))).digest("hex");
}

export function createSignedTeamIdentity(input, secret, options = {}) {
  const candidate = structuredClone(input);
  candidate.authentication = { method: "HMAC_SHA256", key_id: safeTeamId(input.authentication?.key_id, "identity authentication key id"), nonce: safeTeamId(input.authentication?.nonce, "identity authentication nonce"), signature: "0".repeat(64) };
  const normalized = normalizeTeamIdentity(candidate, options); normalized.authentication.signature = signTeamIdentity(normalized, secret);
  return normalizeTeamIdentity(normalized, options);
}

export function verifyTeamIdentityAuthentication(input, options = {}) {
  const identity = normalizeTeamIdentity(input, options); const authentication = identity.authentication;
  if (!authentication) throw new Error("team identity requires cryptographic authentication");
  const secret = options.identitySecret ?? options.resolveIdentityKey?.(authentication.key_id);
  if (typeof secret !== "string") throw new Error("team identity verification key is unavailable");
  const expected = signTeamIdentity(identity, secret); const supplied = authentication.signature;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new Error("team identity signature is invalid");
  const replayKey = `${authentication.key_id}:${authentication.nonce}`;
  if (options.seenIdentityNonces?.has(replayKey)) throw new Error("team identity authentication nonce was replayed");
  options.seenIdentityNonces?.add(replayKey); return identity;
}

export function requireTeamCapability(identity, capability) {
  if (!TEAM_CAPABILITIES.has(capability)) throw new Error("requested team capability is unknown");
  if (!identity.capabilities.includes(capability)) throw new Error(`principal lacks ${capability} capability`);
  return true;
}

export function normalizeTeamPath(value, label = "team path") {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || value.includes("\0")) throw new Error(`${label} must be a bounded repository-relative path`);
  const slash = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(slash) || /^[A-Za-z]:\//.test(slash)) throw new Error(`${label} must be repository-relative`);
  const normalized = path.posix.normalize(slash);
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`${label} must remain in the repository`);
  return normalized.replace(/\/$/, "");
}

export function normalizeTeamSurface(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("change surface must be an object");
  const kind = String(input.kind ?? "PATH").toUpperCase();
  if (!SURFACE_KINDS.has(kind)) throw new Error("change surface kind is invalid");
  const mode = String(input.mode ?? "WRITE").toUpperCase();
  if (!CLAIM_MODES.has(mode)) throw new Error("change surface mode is invalid");
  const name = kind === "PATH" || kind === "GENERATED" || kind === "MIGRATION"
    ? normalizeTeamPath(input.name, "surface name")
    : safeTeamId(input.name, "surface name");
  return { kind, name, mode, source: input.source ? normalizeTeamPath(input.source, "surface source") : null };
}

function pathBase(value) { return value.replace(/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, ""); }

export function teamSurfacesOverlap(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.mode === "READ" && right.mode === "READ") return false;
  if (left.kind === "PATH" || left.kind === "GENERATED" || left.kind === "MIGRATION") {
    const a = pathBase(left.name); const b = pathBase(right.name);
    return Boolean(a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
  }
  return left.name === right.name;
}

export function identitySummary(identity) {
  return { principal_id: identity.principal_id, type: identity.type, issuer: identity.issuer, roles: identity.roles, capabilities: identity.capabilities, expires_at: identity.expires_at, evidence_digest: identity.evidence_digest, authentication_key_id: identity.authentication?.key_id ?? null };
}
