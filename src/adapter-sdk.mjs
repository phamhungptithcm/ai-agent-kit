import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_CANDIDATES = [
  path.resolve(MODULE_DIR, "..", "assets", "enterprise-ai-agent-os", ".ai", "adapters", "registry.json"),
  path.resolve(MODULE_DIR, "..", "..", "assets", "enterprise-ai-agent-os", ".ai", "adapters", "registry.json")
];

export const ADAPTER_REGISTRY_PATH = REGISTRY_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? REGISTRY_CANDIDATES[0];
export const CAPABILITY_STATES = Object.freeze(["native", "generated", "bridged", "advisory", "preview", "unsupported"]);
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/;

function assertStringArray(value, field, adapterId, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`Adapter ${adapterId} field ${field} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) throw new Error(`Adapter ${adapterId} field ${field} contains an invalid value`);
    if (seen.has(entry)) throw new Error(`Adapter ${adapterId} field ${field} contains duplicate value: ${entry}`);
    seen.add(entry);
  }
}

function assertSafePaths(values, field, adapterId) {
  assertStringArray(values, field, adapterId);
  for (const value of values) {
    if (!SAFE_RELATIVE_PATH.test(value)) throw new Error(`Adapter ${adapterId} field ${field} contains unsafe path: ${value}`);
  }
}

export function validateAdapterRegistry(registry) {
  if (!registry || registry.schema_version !== 1) throw new Error("Adapter registry schema_version must be 1");
  if (!/^\d+\.\d+\.\d+$/.test(registry.sdk_version ?? "")) throw new Error("Adapter registry sdk_version must be semantic");
  if (typeof registry.owner !== "string" || !registry.owner.trim()) throw new Error("Adapter registry requires an owner");
  for (const field of ["source_of_truth", "generated_surfaces", "updates", "removal"]) {
    if (typeof registry.lifecycle?.[field] !== "string" || !registry.lifecycle[field].trim()) throw new Error(`Adapter registry lifecycle requires ${field}`);
  }
  assertStringArray(registry.capability_states, "capability_states", "registry", { allowEmpty: false });
  if (registry.capability_states.join("|") !== CAPABILITY_STATES.join("|")) throw new Error("Adapter registry capability states do not match the SDK contract");
  if (!Array.isArray(registry.adapters) || registry.adapters.length === 0) throw new Error("Adapter registry must define adapters");
  const ids = new Set();
  for (const adapter of registry.adapters) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(adapter?.id ?? "")) throw new Error("Adapter id must use lowercase letters, digits, and hyphens");
    if (ids.has(adapter.id)) throw new Error(`Duplicate adapter id: ${adapter.id}`);
    ids.add(adapter.id);
    if (typeof adapter.label !== "string" || adapter.label.length === 0) throw new Error(`Adapter ${adapter.id} requires a label`);
    for (const field of ["exact_paths", "path_prefixes", "skill_roots", "shared_skill_roots"]) assertSafePaths(adapter[field], field, adapter.id);
    assertStringArray(adapter.required_capabilities, "required_capabilities", adapter.id, { allowEmpty: false });
    assertStringArray(adapter.limitations, "limitations", adapter.id);
    if (!adapter.capabilities || typeof adapter.capabilities !== "object" || Array.isArray(adapter.capabilities)) throw new Error(`Adapter ${adapter.id} requires capabilities`);
    for (const [capability, state] of Object.entries(adapter.capabilities)) {
      if (!capability || !CAPABILITY_STATES.includes(state)) throw new Error(`Adapter ${adapter.id} has invalid capability state: ${capability}=${state}`);
    }
    for (const capability of adapter.required_capabilities) {
      const state = adapter.capabilities[capability];
      if (!state) throw new Error(`Adapter ${adapter.id} omits required capability: ${capability}`);
      if (state === "unsupported") throw new Error(`Adapter ${adapter.id} cannot require unsupported capability: ${capability}`);
    }
    const owned = [...adapter.exact_paths, ...adapter.path_prefixes, ...adapter.skill_roots];
    if (owned.length === 0) throw new Error(`Adapter ${adapter.id} must own at least one surface`);
  }
  return registry;
}

export function loadAdapterRegistry(file = ADAPTER_REGISTRY_PATH) {
  return validateAdapterRegistry(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function adapterMap(registry = loadAdapterRegistry()) {
  return Object.fromEntries(registry.adapters.map((adapter) => [adapter.id, adapter]));
}

function pathExists(root, relPath) {
  return fs.existsSync(path.join(root, relPath));
}

export function evaluateAdapterConformance({ adapterId, root, registry = loadAdapterRegistry() }) {
  const adapter = registry.adapters.find((candidate) => candidate.id === adapterId);
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`);
  const checks = [];
  for (const relPath of adapter.exact_paths) {
    checks.push({ id: `surface:${relPath}`, status: pathExists(root, relPath) ? "PASSED" : "FAILED", path: relPath });
  }
  for (const prefix of adapter.path_prefixes) {
    const relPath = prefix.replace(/\/$/, "");
    checks.push({ id: `surface:${prefix}`, status: pathExists(root, relPath) ? "PASSED" : "FAILED", path: relPath });
  }
  for (const skillRoot of adapter.skill_roots) {
    const skillPath = path.join(root, skillRoot);
    const hasSkills = pathExists(root, skillRoot) && fs.readdirSync(skillPath, { withFileTypes: true }).some((entry) => entry.isDirectory() && fs.existsSync(path.join(skillPath, entry.name, "SKILL.md")));
    checks.push({ id: `skills:${skillRoot}`, status: hasSkills ? "PASSED" : "FAILED", path: skillRoot });
  }
  for (const capability of adapter.required_capabilities) {
    const state = adapter.capabilities[capability];
    checks.push({ id: `capability:${capability}`, status: state === "unsupported" ? "FAILED" : "PASSED", state });
  }
  return {
    schema_version: 1,
    sdk_version: registry.sdk_version,
    adapter: adapter.id,
    status: checks.every((check) => check.status === "PASSED") ? "PASSED" : "FAILED",
    checks,
    capabilities: adapter.capabilities,
    limitations: adapter.limitations
  };
}

export function capabilityMatrix(registry = loadAdapterRegistry()) {
  const capabilityNames = [...new Set(registry.adapters.flatMap((adapter) => Object.keys(adapter.capabilities)))].sort();
  return {
    schema_version: 1,
    sdk_version: registry.sdk_version,
    capabilities: capabilityNames,
    adapters: registry.adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      capabilities: Object.fromEntries(capabilityNames.map((name) => [name, adapter.capabilities[name] ?? "unsupported"])),
      limitations: adapter.limitations
    }))
  };
}
