const DEFINITIONS = [
  {
    id: "claude",
    label: "Claude Code",
    exactPaths: ["CLAUDE.md"],
    pathPrefixes: [".claude/"],
    skillRoots: [".claude/skills"]
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [".codex/"],
    skillRoots: [".agents/skills"],
    sharedSkillRoots: [".agents/skills"]
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    exactPaths: ["AGENTS.md", ".github/copilot-instructions.md"],
    pathPrefixes: [],
    skillRoots: [".agents/skills"],
    sharedSkillRoots: [".agents/skills"]
  },
  {
    id: "cursor",
    label: "Cursor",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [".cursor/"],
    skillRoots: [".cursor/skills"]
  },
  {
    id: "windsurf",
    label: "Windsurf / Cascade",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [".windsurf/"],
    skillRoots: [".windsurf/skills"]
  },
  {
    id: "gemini",
    label: "Google Gemini CLI",
    exactPaths: ["GEMINI.md"],
    pathPrefixes: [],
    skillRoots: []
  },
  {
    id: "amazonq",
    label: "Amazon Q Developer",
    exactPaths: [],
    pathPrefixes: [".amazonq/"],
    skillRoots: []
  },
  {
    id: "junie",
    label: "JetBrains Junie",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [".junie/"],
    skillRoots: []
  },
  {
    id: "cline",
    label: "Cline",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [".cline/", ".clinerules/"],
    skillRoots: [".cline/skills"]
  },
  {
    id: "devin",
    label: "Devin",
    exactPaths: ["AGENTS.md"],
    pathPrefixes: [],
    skillRoots: [".agents/skills"],
    sharedSkillRoots: [".agents/skills"]
  },
  {
    id: "aider",
    label: "Aider",
    exactPaths: ["CONVENTIONS.md", ".aider.conf.yml"],
    pathPrefixes: [],
    skillRoots: []
  },
  {
    id: "continue",
    label: "Continue",
    exactPaths: [],
    pathPrefixes: [".continue/"],
    skillRoots: []
  }
];

export const ADAPTERS = Object.freeze(
  Object.fromEntries(DEFINITIONS.map((definition) => [
    definition.id,
    Object.freeze({
      ...definition,
      exactPaths: Object.freeze(definition.exactPaths),
      pathPrefixes: Object.freeze(definition.pathPrefixes),
      skillRoots: Object.freeze(definition.skillRoots),
      sharedSkillRoots: Object.freeze(definition.sharedSkillRoots ?? [])
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
