import { loadAdapterRegistry } from "./adapter-sdk.mjs";

const REGISTRY = loadAdapterRegistry();
const DEFINITIONS = REGISTRY.adapters.map((adapter) => ({
  id: adapter.id,
  label: adapter.label,
  exactPaths: adapter.exact_paths,
  pathPrefixes: adapter.path_prefixes,
  skillRoots: adapter.skill_roots,
  sharedSkillRoots: adapter.shared_skill_roots,
  capabilities: adapter.capabilities,
  requiredCapabilities: adapter.required_capabilities,
  limitations: adapter.limitations
}));

export const ADAPTERS = Object.freeze(
  Object.fromEntries(DEFINITIONS.map((definition) => [
    definition.id,
    Object.freeze({
      ...definition,
      exactPaths: Object.freeze(definition.exactPaths),
      pathPrefixes: Object.freeze(definition.pathPrefixes),
      skillRoots: Object.freeze(definition.skillRoots),
      sharedSkillRoots: Object.freeze(definition.sharedSkillRoots ?? []),
      capabilities: Object.freeze(definition.capabilities),
      requiredCapabilities: Object.freeze(definition.requiredCapabilities),
      limitations: Object.freeze(definition.limitations)
    })
  ]))
);

export const ADAPTER_IDS = Object.freeze(DEFINITIONS.map(({ id }) => id));

export const ALL_SKILL_ROOTS = Object.freeze(
  [...new Set(DEFINITIONS.flatMap(({ skillRoots }) => skillRoots))].sort()
);

function matchesPath(definition, relPath) {
  return definition.exactPaths.includes(relPath) ||
    definition.pathPrefixes.some((prefix) => relPath.startsWith(prefix));
}

export function adapterOwnsPath(adapterId, relPath) {
  const definition = ADAPTERS[adapterId];
  if (!definition) return false;
  return matchesPath(definition, relPath) ||
    definition.skillRoots.some((root) => relPath.startsWith(`${root}/`));
}

export function adapterFlags(selectedIds) {
  const selected = new Set(selectedIds);
  return Object.fromEntries(ADAPTER_IDS.map((id) => [id, selected.has(id)]));
}

export function adapterLabels(selectedIds) {
  return selectedIds.map((id) => ADAPTERS[id].label);
}

export function resolveAdapterIds(options = {}) {
  if (options.claudeOnly) return ["claude"];
  if (options.codexOnly) return ["codex"];

  const requested = options.agents;
  if (requested == null || requested === "all") return [...ADAPTER_IDS];
  const values = Array.isArray(requested) ? requested : String(requested).split(",");
  const normalized = values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.includes("all")) {
    if (normalized.length > 1) throw new Error('Adapter selection "all" cannot be combined with named adapters');
    return [...ADAPTER_IDS];
  }
  const unknown = normalized.filter((id) => !ADAPTERS[id]);
  if (unknown.length > 0) {
    throw new Error(`Unsupported AI agent adapter: ${unknown.join(", ")}. Available adapters: ${ADAPTER_IDS.join(", ")}`);
  }
  if (normalized.length === 0) throw new Error("At least one AI agent adapter must be selected");
  const selected = new Set(normalized);
  return ADAPTER_IDS.filter((id) => selected.has(id));
}

export function selectedSkillRoots(selectedIds) {
  return [...new Set(selectedIds.flatMap((id) => ADAPTERS[id].skillRoots))].sort();
}

export function shouldIncludeScaffoldPath(relPath, selectedIds) {
  const claimingAdapters = DEFINITIONS.filter((definition) => matchesPath(definition, relPath));
  if (claimingAdapters.length === 0) return true;
  const selected = new Set(selectedIds);
  return claimingAdapters.some(({ id }) => selected.has(id));
}
