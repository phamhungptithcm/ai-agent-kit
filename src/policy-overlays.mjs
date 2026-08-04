import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";

const LAYERS = ["kit", "organization", "team", "repository", "task"];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ""));
  if (!match) throw new Error(`invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersion(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

export function matchesCompatibility(version, range) {
  if (!range || range === "*") return true;
  return String(range).trim().split(/\s+/).every((part) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!match) throw new Error(`unsupported compatibility range: ${range}`);
    const operator = match[1] ?? "=";
    const target = match[2];
    const comparison = compareVersion(version, target);
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    if (operator === "^") return parseVersion(version)[0] === parseVersion(target)[0] && comparison >= 0;
    if (operator === "~") return parseVersion(version).slice(0, 2).join(".") === parseVersion(target).slice(0, 2).join(".") && comparison >= 0;
    return comparison === 0;
  });
}

export function signableBundle(bundle) {
  const copy = structuredClone(bundle);
  delete copy.signature;
  return canonical(copy);
}

export function verifyPolicyBundle(bundle, { kitVersion, source = "inline", trustedKeys } = {}) {
  if (!bundle || bundle.schema_version !== 1) throw new Error(`${source}: unsupported policy bundle schema`);
  if (!LAYERS.includes(bundle.layer)) throw new Error(`${source}: invalid policy layer`);
  if (!bundle.id || !bundle.version || !bundle.rules || typeof bundle.rules !== "object" || Array.isArray(bundle.rules)) {
    throw new Error(`${source}: policy bundle requires id, version, and object rules`);
  }
  parseVersion(bundle.version);
  if (!matchesCompatibility(kitVersion, bundle.compatibility?.kit)) {
    throw new Error(`${source}: kit ${kitVersion} is outside compatibility range ${bundle.compatibility?.kit}`);
  }
  if (!bundle.signer?.public_key || !bundle.signature) throw new Error(`${source}: signed policy bundle required`);
  if (bundle.deprecated_after && new Date(bundle.deprecated_after) <= new Date()) throw new Error(`${source}: policy bundle is deprecated`);
  if (trustedKeys) {
    const trusted = trustedKeys.find((key) => key.key_id === bundle.signer.key_id && key.public_key === bundle.signer.public_key && key.revoked !== true);
    if (!trusted || (trusted.allowed_layers && !trusted.allowed_layers.includes(bundle.layer))) throw new Error(`${source}: signer is not trusted for ${bundle.layer} policy`);
  }
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(signableBundle(bundle)), bundle.signer.public_key, Buffer.from(bundle.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) throw new Error(`${source}: policy signature verification failed`);
  return bundle;
}

export function readPolicyBundle(file, options) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${file}: policy source must be a regular file`);
  return verifyPolicyBundle(JSON.parse(fs.readFileSync(absolute, "utf8")), { ...options, source: file });
}

function flatten(value, prefix = "", result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, current, result);
    else result.set(current, child);
  }
  return result;
}

function assign(target, dotted, value) {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = structuredClone(value);
}

export function resolvePolicyOverlays({ bundles, kitVersion }) {
  const verified = bundles.map((item) => verifyPolicyBundle(item.bundle ?? item, { kitVersion, source: item.source ?? item.id }));
  const duplicate = verified.find((bundle, index) => verified.findIndex((candidate) => candidate.layer === bundle.layer) !== index);
  if (duplicate) throw new Error(`conflicting overlays: multiple bundles declare layer ${duplicate.layer}`);
  verified.sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer));
  const effective = {};
  const provenance = {};
  const locks = new Map();
  const changes = [];
  for (const bundle of verified) {
    for (const [key, value] of flatten(bundle.rules)) {
      const lock = [...locks.entries()].find(([locked]) => key === locked || key.startsWith(`${locked}.`));
      if (lock && canonical(provenance[key]?.value) !== canonical(value)) {
        throw new Error(`policy conflict at ${key}: locked by ${lock[1]} and overridden by ${bundle.id}`);
      }
      const previous = provenance[key] ?? null;
      assign(effective, key, value);
      provenance[key] = { layer: bundle.layer, bundle_id: bundle.id, version: bundle.version, value };
      changes.push({ key, previous: previous?.value ?? null, value, source: provenance[key] });
    }
    for (const key of bundle.locks ?? []) locks.set(key, `${bundle.layer}:${bundle.id}`);
  }
  return { schema_version: 1, kit_version: kitVersion, precedence: LAYERS, effective, provenance, changes };
}

export function loadRepositoryPolicyOverlays({ target, kitVersion, taskBundle }) {
  const root = path.resolve(target ?? process.cwd());
  const trustFile = path.join(root, ".ai/policies/trusted-keys.json");
  let trustedKeys = [];
  if (fs.existsSync(trustFile)) {
    if (hasSymlinkComponent(root, ".ai/policies/trusted-keys.json")) throw new Error("refusing policy trust through a symbolic link");
    const trust = JSON.parse(fs.readFileSync(trustFile, "utf8"));
    if (trust.schema_version !== 1 || !Array.isArray(trust.keys)) throw new Error(".ai/policies/trusted-keys.json: invalid trust store");
    trustedKeys = trust.keys;
  }
  const locations = [
    ["kit", ".ai/policies/kit.json"],
    ["organization", ".ai/policies/organization.json"],
    ["team", ".ai/policies/team.json"],
    ["repository", ".ai/policies/repository.json"]
  ];
  const bundles = [];
  for (const [layer, rel] of locations) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    if (hasSymlinkComponent(root, rel)) throw new Error(`refusing policy access through a symbolic link: ${rel}`);
    const bundle = readPolicyBundle(file, { kitVersion, trustedKeys });
    if (bundle.layer !== layer) throw new Error(`${rel}: expected ${layer} layer, received ${bundle.layer}`);
    bundles.push({ bundle, source: rel });
  }
  if (taskBundle) bundles.push({ bundle: readPolicyBundle(taskBundle, { kitVersion, trustedKeys }), source: taskBundle });
  return resolvePolicyOverlays({ bundles, kitVersion });
}

function safeName(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value ?? "")) throw new Error(`${label} must be 1-64 safe characters`);
  return value;
}

function inside(root, rel) {
  const absolute = path.resolve(root, rel);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("policy output must remain inside the repository");
  if (hasSymlinkComponent(root, relative)) throw new Error(`refusing policy access through a symbolic link: ${relative}`);
  return absolute;
}

function protectLocalArtifacts(root) {
  const directory = inside(root, ".ai-agent-kit");
  fs.mkdirSync(directory, { recursive: true });
  const ignoreFile = path.join(directory, ".gitignore");
  const required = ["local/", "proof/", "demo/", "runtime/"];
  const existing = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8").split(/\r?\n/).filter(Boolean) : [];
  const content = [...new Set([...existing, ...required])].join("\n");
  fs.writeFileSync(ignoreFile, `${content}\n`, { mode: 0o644 });
}

export function generatePolicyKey(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const keyId = safeName(options.keyId ?? "local-policy", "key id");
  const layer = options.layer ?? "repository";
  if (!LAYERS.includes(layer) || layer === "kit") throw new Error("key layer must be organization, team, repository, or task");
  protectLocalArtifacts(root);
  const directory = inside(root, path.join(".ai-agent-kit", "local", "policy-keys"));
  fs.mkdirSync(directory, { recursive: true });
  fs.chmodSync(directory, 0o700);
  const privateFile = path.join(directory, `${keyId}.private.pem`);
  const publicFile = path.join(directory, `${keyId}.public.pem`);
  if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) throw new Error(`policy key already exists: ${keyId}`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(privateFile, privatePem, { mode: 0o600 });
  fs.writeFileSync(publicFile, publicPem, { mode: 0o644 });
  const trustFile = inside(root, path.join(".ai", "policies", "trusted-keys.json"));
  fs.mkdirSync(path.dirname(trustFile), { recursive: true });
  const trust = fs.existsSync(trustFile) ? JSON.parse(fs.readFileSync(trustFile, "utf8")) : { schema_version: 1, keys: [] };
  if (trust.schema_version !== 1 || !Array.isArray(trust.keys)) throw new Error("existing policy trust store is invalid");
  if (trust.keys.some((key) => key.key_id === keyId)) throw new Error(`trust store already contains key: ${keyId}`);
  trust.keys.push({ key_id: keyId, public_key: publicPem, allowed_layers: [layer], revoked: false });
  fs.writeFileSync(trustFile, `${JSON.stringify(trust, null, 2)}\n`, { mode: 0o644 });
  return { status: "CREATED", key_id: keyId, layer, private_key: path.relative(root, privateFile), public_key: path.relative(root, publicFile), trust_store: path.relative(root, trustFile) };
}

export function initializePolicyBundle(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const layer = options.layer ?? "repository";
  if (!LAYERS.includes(layer) || layer === "kit") throw new Error("policy layer must be organization, team, repository, or task");
  const id = safeName(options.id ?? `${layer}-policy`, "policy id");
  const file = inside(root, options.output ?? path.join(".ai", "policies", `${layer}.json`));
  if (fs.existsSync(file)) throw new Error(`policy bundle already exists: ${path.relative(root, file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bundle = { schema_version: 1, id, layer, version: options.version ?? "1.0.0", compatibility: { kit: options.compatibility ?? ">=0.8.0 <0.9.0" }, rules: {}, locks: [], deprecated_after: null, signer: { key_id: options.keyId ?? "TODO", public_key: "TODO" }, signature: "TODO" };
  fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o644 });
  return { status: "CREATED", file: path.relative(root, file), next: "Add rules, then run policy sign --apply." };
}

export function signPolicyFile(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  if (!options.bundle || !options.privateKey) throw new Error("policy sign requires bundle and private key");
  if (!options.apply) throw new Error("policy sign changes the bundle; review it and re-run with --apply");
  const bundleFile = inside(root, options.bundle);
  const keyFile = inside(root, options.privateKey);
  for (const [file, label] of [[bundleFile, "bundle"], [keyFile, "private key"]]) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  }
  const bundle = JSON.parse(fs.readFileSync(bundleFile, "utf8"));
  if (!bundle.id || !bundle.layer || !bundle.version || !bundle.compatibility?.kit || !bundle.rules) throw new Error("policy bundle is incomplete");
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile, "utf8"));
  const publicPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  bundle.signer = { key_id: options.keyId ?? bundle.signer?.key_id, public_key: publicPem };
  if (!bundle.signer.key_id || bundle.signer.key_id === "TODO") throw new Error("policy sign requires --key-id");
  bundle.signature = crypto.sign(null, Buffer.from(signableBundle(bundle)), privateKey).toString("base64");
  fs.writeFileSync(bundleFile, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o644 });
  return { status: "SIGNED", bundle: path.relative(root, bundleFile), key_id: bundle.signer.key_id, layer: bundle.layer, version: bundle.version };
}

export function verifyPolicyFile(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  if (!options.bundle) throw new Error("policy verify requires bundle");
  const trustFile = inside(root, path.join(".ai", "policies", "trusted-keys.json"));
  if (!fs.existsSync(trustFile)) throw new Error("policy trust store is missing");
  const trust = JSON.parse(fs.readFileSync(trustFile, "utf8"));
  const bundle = readPolicyBundle(inside(root, options.bundle), { kitVersion: options.kitVersion ?? "0.8.0", trustedKeys: trust.keys });
  return { status: "VERIFIED", id: bundle.id, layer: bundle.layer, version: bundle.version, signer: bundle.signer.key_id, compatibility: bundle.compatibility.kit };
}
