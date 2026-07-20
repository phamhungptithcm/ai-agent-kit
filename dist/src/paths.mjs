export const APPROVED_CONFIG_PATHS = [
  ".ai/",
  ".agents/",
  ".claude/",
  ".codex/",
  ".ai-agent-kit/",
  "AGENTS.md",
  "CLAUDE.md",
  "AI_AGENT_TEAM_GUIDE.md",
  ".mcp.json",
  ".gitignore"
];

export const PROTECTED_PATH_HINTS = [
  "src/",
  "app/",
  "services/",
  "modules/",
  "database/",
  "migrations/",
  "terraform/",
  "kubernetes/",
  "helm/"
];

export function normalizeRelPath(relPath) {
  return relPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isApprovedConfigPath(relPath) {
  const normalized = normalizeRelPath(relPath);
  return APPROVED_CONFIG_PATHS.some((allowed) => {
    if (allowed.endsWith("/")) return normalized.startsWith(allowed);
    return normalized === allowed;
  });
}

export function isProtectedApplicationPath(relPath, detectedProtectedPaths = []) {
  const normalized = normalizeRelPath(relPath);
  return [...PROTECTED_PATH_HINTS, ...detectedProtectedPaths].some((prefix) => normalized.startsWith(prefix));
}
