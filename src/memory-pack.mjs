import crypto from "node:crypto";

import { memoryDigest, resolveRepositoryIdentity, stableValue, validateMemoryEntry } from "./memory-contract.mjs";

const PACK_PROTOCOL = "aak-memory-pack-v1";
const MAX_PACK_ENTRIES = 10_000;
const PACK_KEYS = new Set(["protocol", "key_id", "repository", "nonce", "created_at", "expires_at", "entries", "entries_hash", "integrity"]);

function hmac(value, secret) { return crypto.createHmac("sha256", secret).update(JSON.stringify(stableValue(value))).digest("hex"); }
function boundedSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("memory pack signing secret must contain at least 32 bytes");
  return secret;
}

export function createMemoryPack(store, options = {}) {
  const secret = boundedSecret(options.signingSecret);
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity(options);
  const createdAt = options.now ?? new Date().toISOString();
  const expiresAt = options.expiresAt ?? new Date(Date.parse(createdAt) + 15 * 60 * 1000).toISOString();
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(createdAt) || Date.parse(expiresAt) - Date.parse(createdAt) > 24 * 60 * 60 * 1000) throw new Error("memory pack validity window is invalid");
  const entries = store.list({ organizationId: identity.organization_id, repositoryId: identity.repository_id, status: "APPROVED", maxEntries: MAX_PACK_ENTRIES }).map(validateMemoryEntry);
  const keyId = options.keyId ?? "local-shared-memory";
  const nonce = options.nonce ?? crypto.randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) throw new Error("memory pack key id is invalid");
  if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 256) throw new Error("memory pack nonce is invalid");
  const payload = {
    protocol: PACK_PROTOCOL,
    key_id: keyId,
    repository: { organization_id: identity.organization_id, repository_id: identity.repository_id },
    nonce,
    created_at: new Date(createdAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    entries,
    entries_hash: memoryDigest(entries)
  };
  return { ...payload, integrity: { algorithm: "HMAC-SHA256", signature: hmac(payload, secret) } };
}

export function verifyMemoryPack(pack, options = {}) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack) || pack.protocol !== PACK_PROTOCOL) throw new Error("memory pack protocol is invalid");
  if (Object.keys(pack).some((key) => !PACK_KEYS.has(key))) throw new Error("memory pack contains unsupported top-level fields");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(pack.key_id ?? "") || typeof pack.nonce !== "string" || pack.nonce.length < 16 || pack.nonce.length > 256) throw new Error("memory pack identity fields are invalid");
  if (!pack.repository || typeof pack.repository !== "object" || Array.isArray(pack.repository) || Object.keys(pack.repository).sort().join(",") !== "organization_id,repository_id") throw new Error("memory pack repository binding is invalid");
  if (!pack.integrity || typeof pack.integrity !== "object" || Array.isArray(pack.integrity) || Object.keys(pack.integrity).sort().join(",") !== "algorithm,signature") throw new Error("memory pack integrity envelope is invalid");
  if (pack.integrity?.algorithm !== "HMAC-SHA256" || !/^[a-f0-9]{64}$/.test(pack.integrity?.signature ?? "")) throw new Error("memory pack is unsigned or uses an unsupported integrity proof");
  const secret = boundedSecret(options.signingSecret);
  const payload = { ...pack }; delete payload.integrity;
  const expected = hmac(payload, secret);
  const actualBuffer = Buffer.from(pack.integrity.signature, "hex"); const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error("memory pack signature verification failed");
  const now = Date.parse(options.now ?? new Date().toISOString());
  const created = Date.parse(pack.created_at); const expires = Date.parse(pack.expires_at);
  if (!Number.isFinite(now) || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= now || expires <= created || created > now + 5 * 60 * 1000 || expires - created > 24 * 60 * 60 * 1000) throw new Error("memory pack is expired or has an invalid timestamp");
  if (!Array.isArray(pack.entries) || pack.entries.length > MAX_PACK_ENTRIES || memoryDigest(pack.entries) !== pack.entries_hash) throw new Error("memory pack entry integrity check failed");
  pack.entries.forEach(validateMemoryEntry);
  if (pack.entries.some((entry) => entry.status !== "APPROVED")) throw new Error("memory packs may contain approved memory only");
  const identity = options.repositoryIdentity ?? resolveRepositoryIdentity(options);
  if (pack.repository?.organization_id !== identity.organization_id || pack.repository?.repository_id !== identity.repository_id) throw new Error("memory pack belongs to a foreign organization or repository");
  return { status: "VERIFIED", payload, replay_key: memoryDigest({ repository: pack.repository, nonce: pack.nonce, key_id: pack.key_id }) };
}

export function importMemoryPack(store, pack, options = {}) {
  const verification = verifyMemoryPack(pack, options);
  const preview = store.importEntries(pack.entries, { apply: false });
  if (!options.apply) return { status: "PREVIEW", verification, preview: preview.preview };
  try {
    const imported = store.importPack(pack.entries, verification.replay_key, { expiresAt: pack.expires_at, actor: options.actor, reasonCode: "SIGNED_PACK_IMPORT" });
    return { status: "APPLIED", verification, preview: imported.preview, receipt: imported.receipt };
  } catch (error) {
    throw new Error(`verified memory pack import failed closed: ${error.message}`);
  }
}
