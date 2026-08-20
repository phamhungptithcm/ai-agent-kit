import fs from "node:fs";
import path from "node:path";

export const APPROVED_CONFIG_PATHS = [
  ".ai/",
  ".agents/",
  ".claude/",
  ".codex/",
  ".github/",
  ".cursor/",
  ".windsurf/",
  ".amazonq/",
  ".junie/",
  ".cline/",
  ".clinerules/",
  ".continue/",
  ".ai-agent-kit/",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CONVENTIONS.md",
  ".aider.conf.yml",
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
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.includes("\0")) {
    throw new Error("Managed path must be a non-empty relative path");
  }
  const slashPath = relPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (slashPath.startsWith("/") || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error(`Managed path must remain inside the repository: ${relPath}`);
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Managed path must remain inside the repository: ${relPath}`);
  }
  return normalized;
}

export function hasSymlinkComponent(root, relPath) {
  const normalized = normalizeRelPath(relPath);
  let current = path.resolve(root);
  for (const part of normalized.split("/")) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return false;
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

export function sameFilesystemPath(left, right, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalize = (value) => pathApi.normalize(pathApi.resolve(String(value)));
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
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
