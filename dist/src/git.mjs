import path from "node:path";

export function git(runner, cwd, args) {
  return runner.run("git", args, { cwd, timeout: 120000 });
}

export function requireGitRoot(runner, target) {
  const result = git(runner, target, ["rev-parse", "--show-toplevel"]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(`Target is not inside a Git repository: ${target}`);
  }
  return path.resolve(result.stdout.trim());
}

export function getBranch(runner, root) {
  const result = git(runner, root, ["branch", "--show-current"]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : "detached-or-unknown";
}

export function getCommit(runner, root) {
  const result = git(runner, root, ["rev-parse", "HEAD"]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : "unknown";
}

export function getStatus(runner, root) {
  const result = git(runner, root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "Unable to read git status");
  }
  return parsePorcelain(result.stdout);
}

export function parsePorcelain(output) {
  const entries = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let file = line.slice(3);
    if (file.includes(" -> ")) file = file.split(" -> ").pop();
    file = file.replace(/^"|"$/g, "").replaceAll("\\", "/");
    entries.set(file, line.slice(0, 2));
  }
  return entries;
}

export function statusToObject(status) {
  return Object.fromEntries([...status.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function getManagedDiff(runner, root) {
  return git(runner, root, ["diff", "--", "AGENTS.md", "CLAUDE.md", "AI_AGENT_TEAM_GUIDE.md", ".ai", ".agents", ".claude", ".codex", ".ai-agent-kit", ".gitignore"]);
}
