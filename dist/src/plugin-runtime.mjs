import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const STATES = new Set(["discovered", "verified", "installed", "disabled", "active", "incompatible", "quarantined", "removed"]);
const PERMISSION_KEYS = ["filesystem_read", "filesystem_write", "process", "network", "domains", "mcp_servers", "hooks", "external_actions", "data_classes"];
const TRUSTED_SIGNERS = ".ai/plugins/trusted-signers.json";
const TRUSTED_CAPABILITY_ISSUERS = ".ai/plugins/trusted-capability-issuers.json";

function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function rootOf(target) { return path.resolve(target ?? process.cwd()); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function assertId(id) { if (!SAFE_ID.test(id ?? "")) throw new Error("plugin id must use lowercase safe characters"); return id; }
function directory(root) { const rel = ".ai-agent-kit/plugins"; if (hasSymlinkComponent(root, rel)) throw new Error("plugin state path crosses a symbolic link"); const local = path.join(root, ".ai-agent-kit"); fs.mkdirSync(local, { recursive: true, mode: 0o700 }); const ignore = path.join(local, ".gitignore"); if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n!.gitignore\n", { mode: 0o600 }); return path.join(root, rel); }
function guardedPluginPath(root, suffix) { const rel = `.ai-agent-kit/plugins/${suffix}`; directory(root); if (hasSymlinkComponent(root, rel)) throw new Error(`plugin path crosses a symbolic link: ${rel}`); return path.join(root, rel); }
function manifestFile(root, id) { return guardedPluginPath(root, `manifests/${assertId(id)}.json`); }
function stateFile(root, id) { return guardedPluginPath(root, `state/${assertId(id)}.json`); }
function ledgerFile(root) { return guardedPluginPath(root, "receipts.jsonl"); }
function read(file, label) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error(`${label} must be a bounded regular file`); return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = `${file}.${crypto.randomUUID()}.tmp`; try { fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); } }
function inputFile(root, file) { const absolute = path.resolve(root, file ?? ""); const relative = path.relative(root, absolute); if (!file || relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("plugin manifest must remain in a non-symlinked repository path"); return absolute; }
function trustedFile(root, relative, label) { if (hasSymlinkComponent(root, relative)) throw new Error(`${label} crosses a symbolic link`); const file = path.join(root, relative); if (!fs.existsSync(file)) return { schema_version: 1, keys: [] }; const value = read(file, label); if (value.schema_version !== 1 || !Array.isArray(value.keys)) throw new Error(`${label} is invalid`); return value; }
function publicKeyFingerprint(pem) {
  const der = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  return `sha256:${crypto.createHash("sha256").update(der).digest("hex")}`;
}

export function initializePlugin(options = {}) {
  const root = rootOf(options.target);
  const id = assertId(options.pluginId);
  const relativeDirectory = options.output ?? `plugins/${id}`;
  const absoluteDirectory = path.resolve(root, relativeDirectory);
  const relative = path.relative(root, absoluteDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("plugin output must remain in a non-symlinked repository path");
  const files = ["plugin.json", "SKILL.md", "test/fixtures/denied-permission.json"];
  const result = { schema_version: 1, status: options.apply ? "CREATED" : "PREVIEW", mutates: Boolean(options.apply), plugin_id: id, output: relative, files, private_key_generated: false, next: "Review permissions, add tests, then sign immutable release content outside this scaffold." };
  if (!options.apply) return result;
  if (fs.existsSync(absoluteDirectory)) throw new Error("plugin output already exists");
  const manifest = {
    schema_version: 1, id, name: id, version: "0.1.0", publisher: "replace-with-publisher",
    description: "Replace with one bounded plugin capability.", surfaces: ["skills"],
    permissions: Object.fromEntries(PERMISSION_KEYS.map((key) => [key, []])),
    hosts: { codex: "generated", claude: "generated" }, dependencies: [], conflicts: [],
    provenance: { source: null, commit: null, checksum: null, signature: null, key_id: null, public_key_pem: null, sbom: null }
  };
  fs.mkdirSync(path.join(absoluteDirectory, "test", "fixtures"), { recursive: true });
  fs.writeFileSync(path.join(absoluteDirectory, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(absoluteDirectory, "SKILL.md"), `---\nname: ${id}\ndescription: Replace with what this plugin does and the exact situations that should trigger it.\n---\n\n# ${id}\n\nDefine the bounded workflow, safety checks, and evidence output.\n`, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(absoluteDirectory, "test", "fixtures", "denied-permission.json"), `${JSON.stringify({ requested: { filesystem_write: ["outside/**"] }, expect: "DENIED" }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return result;
}

function normalizedPermissions(input = {}) {
  const result = {};
  for (const key of PERMISSION_KEYS) result[key] = [...new Set((input[key] ?? []).map(String))].sort();
  for (const key of ["filesystem_read", "filesystem_write"]) {
    if (result[key].some((value) => path.isAbsolute(value) || value.split(/[\\/]/).includes("..") || value.includes("\0"))) throw new Error(`${key} contains an unsafe path`);
  }
  if (result.domains.some((value) => !/^(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(value))) throw new Error("domains contains an invalid host pattern");
  return result;
}

export function validatePluginManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("plugin manifest must be an object");
  const id = assertId(manifest.id);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) throw new Error("plugin version must be semantic");
  if (!manifest.publisher || typeof manifest.publisher !== "string") throw new Error("plugin publisher is required but does not imply trust");
  const surfaces = [...new Set((manifest.surfaces ?? []).map(String))].sort();
  const allowedSurfaces = new Set(["skills", "rules", "profiles", "hooks", "commands", "adapters", "templates", "schemas", "ui"]);
  if (!surfaces.length || surfaces.some((surface) => !allowedSurfaces.has(surface))) throw new Error("plugin surfaces are missing or unsupported");
  const permissions = normalizedPermissions(manifest.permissions);
  const hosts = Object.fromEntries(Object.entries(manifest.hosts ?? {}).map(([host, state]) => {
    if (!new Set(["native", "generated", "bridged", "advisory", "preview", "unsupported"]).has(state)) throw new Error(`unsupported host capability state for ${host}`);
    return [host, state];
  }));
  if (!Object.keys(hosts).length) throw new Error("plugin must declare host compatibility");
  const dependencies = [...new Set((manifest.dependencies ?? []).map((item) => assertId(String(item))))].sort();
  const conflicts = [...new Set((manifest.conflicts ?? []).map((item) => assertId(String(item))))].sort();
  if (dependencies.includes(id) || conflicts.includes(id)) throw new Error("plugin cannot depend on or conflict with itself");
  const normalized = { schema_version: 1, id, name: String(manifest.name ?? id), version: manifest.version, publisher: manifest.publisher, description: String(manifest.description ?? ""), surfaces, permissions, hosts, dependencies, conflicts, provenance: { source: manifest.provenance?.source ?? null, commit: manifest.provenance?.commit ?? null, checksum: manifest.provenance?.checksum ?? null, signature: manifest.provenance?.signature ?? null, key_id: manifest.provenance?.key_id ?? null, public_key_pem: manifest.provenance?.public_key_pem ?? null, sbom: manifest.provenance?.sbom ?? null } };
  return { ...normalized, manifest_hash: hash(canonical(normalized)) };
}

function verifyProvenance(root, manifest) {
  const provenance = manifest.provenance;
  const missing = ["source", "commit", "checksum", "signature", "key_id", "public_key_pem", "sbom"].filter((key) => !provenance[key]);
  if (missing.length) return { status: "UNVERIFIED", missing, reason: "provenance fields are incomplete" };
  if (typeof provenance.public_key_pem !== "string" || provenance.public_key_pem.length > 8192 || !provenance.public_key_pem.includes("BEGIN PUBLIC KEY")) return { status: "REJECTED", missing: [], reason: "public key is invalid" };
  const payload = { ...manifest, manifest_hash: undefined, provenance: { ...provenance, checksum: null, signature: null } };
  delete payload.manifest_hash;
  const payloadHash = hash(canonical(payload));
  if (provenance.checksum !== `sha256:${payloadHash}`) return { status: "REJECTED", missing: [], reason: "provenance checksum does not match the manifest payload" };
  try {
    const valid = crypto.verify(null, Buffer.from(payloadHash), provenance.public_key_pem, Buffer.from(provenance.signature, "base64"));
    if (!valid) return { status: "REJECTED", missing: [], reason: "signature verification failed" };
    const fingerprint = publicKeyFingerprint(provenance.public_key_pem);
    const trusted = trustedFile(root, TRUSTED_SIGNERS, "plugin signer trust store").keys.find((key) => key.key_id === provenance.key_id && key.public_key === provenance.public_key_pem && key.revoked !== true && (key.plugin_ids ?? []).includes(manifest.id) && (key.publishers ?? []).includes(manifest.publisher) && manifest.surfaces.every((surface) => (key.surfaces ?? []).includes(surface)));
    if (!trusted) return { status: "UNTRUSTED_SIGNER", missing: [], reason: "signature is valid but signer is not trusted for this plugin identity and surfaces", payload_hash: payloadHash, signer_fingerprint: fingerprint };
    return { status: "VERIFIED", missing: [], reason: "checksum, signature, and repository signer scope verified", payload_hash: payloadHash, signer_fingerprint: fingerprint, key_id: provenance.key_id };
  } catch { return { status: "REJECTED", missing: [], reason: "signature verification failed" }; }
}

function readState(root, id) {
  const file = stateFile(root, id);
  return fs.existsSync(file) ? read(file, "plugin state") : null;
}

function appendReceipt(root, event) {
  const file = ledgerFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let descriptor;
  try { descriptor = fs.openSync(lock, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") throw new Error("plugin receipt ledger is locked by another writer"); throw error; }
  try {
    const records = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    let previous = null;
    records.forEach((record, index) => { const { receipt_hash: receiptHash, ...base } = record; if (record.offset !== index + 1 || record.previous_hash !== previous || hash(canonical(base)) !== receiptHash) throw new Error("plugin receipt ledger failed integrity verification"); previous = receiptHash; });
    const replayDenied = event.type === "plugin.invocation" && event.status === "ALLOWED" && event.capability_token_hash && records.some((record) => record.event.type === "plugin.invocation" && record.event.status === "ALLOWED" && record.event.capability_token_hash === event.capability_token_hash);
    const { timestamp, ...eventData } = replayDenied ? { ...event, status: "DENIED", replay_denied: true } : event;
    const base = { schema_version: 1, offset: records.length + 1, timestamp: timestamp ?? new Date().toISOString(), previous_hash: previous, event: eventData };
    const receipt = { ...base, receipt_hash: hash(canonical(base)) };
    fs.appendFileSync(file, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    return receipt;
  } finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
}

function readVerifiedReceipts(root) {
  const file = ledgerFile(root);
  if (!fs.existsSync(file)) return { records: [], head_hash: null };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("plugin receipt ledger must be a bounded regular file");
  const records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  let previous = null;
  records.forEach((record, index) => { const { receipt_hash: receiptHash, ...base } = record; if (record.offset !== index + 1 || record.previous_hash !== previous || hash(canonical(base)) !== receiptHash) throw new Error("plugin receipt ledger failed integrity verification"); previous = receiptHash; });
  return { records, head_hash: previous };
}

export function inspectPluginManifest(options) {
  const root = rootOf(options.target);
  const manifest = options.manifest ?? read(inputFile(root, options.file), "plugin manifest");
  const normalized = validatePluginManifest(manifest);
  const current = readState(root, normalized.id);
  const provenance = verifyProvenance(root, normalized);
  const missingProvenance = provenance.missing;
  const risks = [];
  if (normalized.permissions.filesystem_write.length) risks.push("filesystem-write");
  if (normalized.permissions.process.length) risks.push("process-execution");
  if (normalized.permissions.network.length || normalized.permissions.domains.length) risks.push("network-access");
  if (normalized.permissions.external_actions.length) risks.push("external-actions");
  return { schema_version: 1, status: provenance.status, manifest: normalized, current_state: current?.state ?? "discovered", missing_provenance: missingProvenance, provenance_verification: provenance, risks, authority_note: "Publisher identity and popularity are metadata, not proof of safety." };
}

export function planPluginLifecycle(options) {
  const inspection = inspectPluginManifest(options);
  const targetState = options.state ?? "installed";
  if (!STATES.has(targetState)) throw new Error("unsupported plugin lifecycle state");
  const blockers = [];
  if (["verified", "installed", "active"].includes(targetState) && inspection.status !== "VERIFIED") blockers.push("complete provenance is required");
  if (targetState === "active" && inspection.manifest.hosts[options.adapter ?? "codex"] === "unsupported") blockers.push("selected adapter is unsupported");
  if (targetState === "active") {
    for (const dependency of inspection.manifest.dependencies) {
      const state = readState(rootOf(options.target), dependency);
      if (!state || state.state !== "active") blockers.push(`dependency ${dependency} is not active`);
    }
    for (const conflict of inspection.manifest.conflicts) {
      const state = readState(rootOf(options.target), conflict);
      if (state && !["disabled", "removed"].includes(state.state)) blockers.push(`conflicting plugin ${conflict} is ${state.state}`);
    }
  }
  return { schema_version: 1, status: blockers.length ? "BLOCKED" : "PREVIEW", mutates: false, plugin_id: inspection.manifest.id, from: inspection.current_state, to: targetState, manifest_hash: inspection.manifest.manifest_hash, permissions: inspection.manifest.permissions, risks: inspection.risks, blockers, requires_approval: ["installed", "active", "removed"].includes(targetState), rollback: inspection.current_state };
}

export function applyPluginLifecycle(options) {
  if (!options.apply) throw new Error("plugin lifecycle mutation requires --apply");
  const plan = planPluginLifecycle(options);
  if (plan.status === "BLOCKED") return plan;
  if (plan.requires_approval && !options.approvalRef) throw new Error("plugin lifecycle mutation requires an approval reference");
  const root = rootOf(options.target);
  const inspection = inspectPluginManifest(options);
  const state = { schema_version: 1, plugin_id: plan.plugin_id, state: plan.to, manifest_hash: plan.manifest_hash, approval_ref: options.approvalRef ?? null, updated_at: options.timestamp ?? new Date().toISOString(), previous_state: plan.from };
  write(manifestFile(root, plan.plugin_id), inspection.manifest);
  write(stateFile(root, plan.plugin_id), state);
  const receipt = appendReceipt(root, { type: "plugin.lifecycle", plugin_id: plan.plugin_id, from: plan.from, to: plan.to, manifest_hash: plan.manifest_hash, approval_ref: state.approval_ref });
  return { ...plan, status: "APPLIED", mutates: true, receipt_hash: receipt.receipt_hash };
}

function intersection(values, ceiling) { const allowed = new Set(ceiling ?? []); return (values ?? []).filter((value) => allowed.has(value)); }

function decodeCapability(root, token, expected) {
  if (typeof token !== "string" || !token) return { status: "DENIED", reason: "a signed capability token is required" };
  let envelope;
  try { envelope = JSON.parse(Buffer.from(token, "base64url").toString("utf8")); } catch { return { status: "DENIED", reason: "capability token is malformed" }; }
  const body = envelope?.body;
  if (!body || body.schema_version !== 1 || typeof envelope.signature !== "string" || typeof body.key_id !== "string" || typeof body.nonce !== "string" || !body.nonce || !body.expires_at || !body.policy_hash) return { status: "DENIED", reason: "capability token contract is invalid" };
  const trusted = trustedFile(root, TRUSTED_CAPABILITY_ISSUERS, "capability issuer trust store").keys.find((key) => key.key_id === body.key_id && key.revoked !== true);
  if (!trusted) return { status: "DENIED", reason: "capability issuer is not trusted" };
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(canonical(body)), trusted.public_key, Buffer.from(envelope.signature, "base64")); } catch { valid = false; }
  if (!valid) return { status: "DENIED", reason: "capability signature is invalid" };
  if (Date.parse(body.expires_at) <= Date.now()) return { status: "DENIED", reason: "capability token is expired" };
  for (const [key, value] of Object.entries(expected)) if (body[key] !== value) return { status: "DENIED", reason: `capability ${key} binding does not match` };
  return { status: "VERIFIED", body, token_hash: hash(token), permissions: normalizedPermissions(body.permissions) };
}

export function authorizePluginInvocation(options) {
  const root = rootOf(options.target);
  const id = assertId(options.pluginId);
  const manifest = read(manifestFile(root, id), "installed plugin manifest");
  const inspection = inspectPluginManifest({ target: root, manifest });
  const state = readState(root, id);
  const drifted = inspection.manifest.manifest_hash !== state?.manifest_hash;
  const receipts = readVerifiedReceipts(root);
  const lifecycle = receipts.records.filter((receipt) => receipt.event.type === "plugin.lifecycle" && receipt.event.plugin_id === id).at(-1);
  const stateBound = Boolean(lifecycle && lifecycle.event.to === state?.state && lifecycle.event.manifest_hash === state?.manifest_hash && lifecycle.event.approval_ref === state?.approval_ref);
  if (Object.keys(options.ceiling ?? {}).length) throw new Error("caller-provided capability ceiling is not authoritative; use a signed capability token");
  const requested = normalizedPermissions(options.requested);
  const capability = decodeCapability(root, options.capabilityToken, { plugin_id: id, task_id: options.taskId ?? null, run_id: options.runId ?? null, approval_ref: state?.approval_ref ?? null });
  const replayed = capability.token_hash ? receipts.records.some((receipt) => receipt.event.type === "plugin.invocation" && receipt.event.status === "ALLOWED" && receipt.event.capability_token_hash === capability.token_hash) : false;
  const ceiling = capability.status === "VERIFIED" ? capability.permissions : normalizedPermissions({});
  const effective = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, intersection(requested[key], intersection(manifest.permissions[key], ceiling[key]))]));
  const denied = PERMISSION_KEYS.flatMap((key) => requested[key].filter((value) => !effective[key].includes(value)).map((value) => `${key}:${value}`));
  const status = state?.state !== "active" ? "DENIED" : drifted || inspection.status !== "VERIFIED" || !stateBound ? "QUARANTINED" : capability.status !== "VERIFIED" || replayed || denied.length ? "DENIED" : "ALLOWED";
  const receipt = appendReceipt(root, { type: "plugin.invocation", plugin_id: id, state: state?.state ?? "missing", manifest_hash: state?.manifest_hash ?? null, task_id: options.taskId ?? null, run_id: options.runId ?? null, capability_token_hash: options.capabilityToken ? hash(options.capabilityToken) : null, approval_ref: state?.approval_ref ?? null, requested, effective, denied, status });
  const finalStatus = receipt.event.status;
  return { schema_version: 1, status: finalStatus, plugin_id: id, effective_permissions: effective, denied, receipt_hash: receipt.receipt_hash, reason: state?.state !== "active" ? "plugin is not active" : drifted ? "plugin manifest drifted after activation" : inspection.status !== "VERIFIED" ? "plugin provenance no longer verifies" : !stateBound ? "plugin state is not bound to its lifecycle receipt" : capability.status !== "VERIFIED" ? capability.reason : replayed || receipt.event.replay_denied ? "capability token replay was denied" : denied.length ? "requested authority exceeds the effective permission intersection" : "trusted policy capability and least-privilege authority verified" };
}

export function pluginTrustCenter(options = {}) {
  const root = rootOf(options.target);
  const receipts = readVerifiedReceipts(root);
  const manifestDirectory = path.join(directory(root), "manifests");
  const plugins = fs.existsSync(manifestDirectory) ? fs.readdirSync(manifestDirectory).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const manifest = read(path.join(manifestDirectory, name), "plugin manifest");
    const inspection = inspectPluginManifest({ target: root, manifest });
    const state = readState(root, manifest.id);
    const lifecycle = receipts.records.filter((receipt) => receipt.event.type === "plugin.lifecycle" && receipt.event.plugin_id === manifest.id).at(-1);
    const stateBound = !state || Boolean(lifecycle && lifecycle.event.to === state.state && lifecycle.event.manifest_hash === state.manifest_hash && lifecycle.event.approval_ref === state.approval_ref);
    const drifted = state ? state.manifest_hash !== inspection.manifest.manifest_hash : false;
    const quarantined = drifted || ["REJECTED", "UNTRUSTED_SIGNER"].includes(inspection.status) || !stateBound;
    return { id: manifest.id, version: manifest.version, state: quarantined ? "quarantined" : state?.state ?? "discovered", trust: drifted || !stateBound ? "TAMPERED" : inspection.status, manifest_hash: inspection.manifest.manifest_hash, permissions: inspection.manifest.permissions, hosts: inspection.manifest.hosts, risks: inspection.risks, missing_provenance: inspection.missing_provenance };
  }) : [];
  const counts = { total: plugins.length, active: plugins.filter((plugin) => plugin.state === "active").length, quarantined: plugins.filter((plugin) => plugin.state === "quarantined").length, unverified: plugins.filter((plugin) => ["UNVERIFIED", "UNTRUSTED_SIGNER"].includes(plugin.trust)).length };
  return { schema_version: 1, status: counts.quarantined || counts.unverified || plugins.some((plugin) => plugin.trust === "TAMPERED") ? "ATTENTION" : "HEALTHY", local_first: true, registry_required: false, plugins, counts };
}
