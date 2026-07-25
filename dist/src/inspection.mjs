import fs from "node:fs";
import path from "node:path";
import { getManagedDiff, getStatus, requireGitRoot } from "./git.mjs";
import { isApprovedConfigPath } from "./paths.mjs";
import { createRunner } from "./runner.mjs";
import { checkCodeGraph, checkCocoIndex } from "./tools.mjs";
import { getPackageVersion } from "./version.mjs";

const REQUIRED_GOVERNED_FILES = [
  ".ai/PROMPTS.md",
  ".ai/core/required-workflow.md",
  ".ai/core/risk-model.md",
  ".ai/core/quality-gates.md",
  ".ai/core/output-contract.md",
  ".ai/core/memory-policy.md",
  ".ai/guards/repository-intelligence-gate.yaml",
  ".ai/guards/implementation-approval-gate.yaml",
  ".ai/guards/code-quality-profile-gate.yaml",
  ".ai/guards/memory-governance.yaml",
  ".ai/quality-profiles/universal.yaml"
];

function exists(root, relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function readInstallation(root) {
  const installationPath = path.join(root, ".ai-agent-kit", "installation.json");
  if (!fs.existsSync(installationPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(installationPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid AI Agent Kit installation metadata: ${error.message}`);
  }
}

function adapterStatus(root) {
  return {
    claude: exists(root, "CLAUDE.md") && exists(root, ".claude/settings.json") ? "READY" : "NOT_INSTALLED",
    codex: exists(root, "AGENTS.md") && exists(root, ".codex/config.toml") ? "READY" : "NOT_INSTALLED"
  };
}

function intelligenceStatus(codegraph, cocoindex) {
  if (codegraph.status === "READY" && cocoindex.status === "READY") return "READY";
  if (codegraph.status === "MISSING" || cocoindex.status === "MISSING") return "NOT_CONFIGURED";
  return "BLOCKED";
}

export function inspectInstallation(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const installation = readInstallation(root);
  const missingCoreFiles = REQUIRED_GOVERNED_FILES.filter((relPath) => !exists(root, relPath));
  const core = installation && missingCoreFiles.length === 0 ? "CORE_READY" : "INCOMPLETE";
  const adapters = adapterStatus(root);
  const codegraph = checkCodeGraph(runner, root);
  const cocoindex = checkCocoIndex(runner, root);
  const repositoryIntelligence = intelligenceStatus(codegraph, cocoindex);
  const governedImplementation = core === "CORE_READY" && repositoryIntelligence === "READY" ? "READY" : "BLOCKED";

  return {
    root,
    installation,
    installedVersion: installation?.version ?? "not-installed",
    currentVersion: deps.packageVersion ?? getPackageVersion(),
    preset: installation?.preset ?? (installation ? "governed-v0.1" : "not-installed"),
    core,
    adapters,
    codegraph,
    cocoindex,
    repositoryIntelligence,
    governedImplementation,
    missingCoreFiles
  };
}

export function renderStatus(status) {
  return `AI Agent Kit Status

Repository: ${status.root}
Installed version: ${status.installedVersion}
Current CLI version: ${status.currentVersion}
Preset: ${status.preset}

Core policy: ${status.core}
Claude adapter: ${status.adapters.claude}
Codex adapter: ${status.adapters.codex}
CodeGraph: ${status.codegraph.status}
CocoIndex: ${status.cocoindex.status}
Repository Intelligence: ${status.repositoryIntelligence}
Governed implementation: ${status.governedImplementation}`;
}

export function renderDoctor(status) {
  const actions = [];
  if (!status.installation) {
    actions.push("Run: npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --preset governed --dry-run");
  } else if (status.missingCoreFiles.length > 0) {
    actions.push("Preview repair: npx --yes @hunpeolabs/ai-agent-kit@latest update --dry-run");
  }
  if (status.repositoryIntelligence !== "READY") {
    actions.push("Configure repository intelligence: npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --deep");
  }
  if (actions.length === 0) actions.push("No blocking issue found.");

  const missing = status.missingCoreFiles.length > 0
    ? `\n\nMissing core files:\n${status.missingCoreFiles.map((file) => `- ${file}`).join("\n")}`
    : "";

  return `${renderStatus(status)}

Diagnosis:
- Installation and operational readiness are reported separately.
- CORE_READY does not permit governed implementation while Repository Intelligence is not READY.
- Doctor is read-only and did not modify repository files.

Next actions:
${actions.map((action) => `- ${action}`).join("\n")}${missing}`;
}

export function renderManagedDiff(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const managedStatus = [...getStatus(runner, root)]
    .filter(([relPath]) => isApprovedConfigPath(relPath))
    .map(([relPath, state]) => `${state} ${relPath}`);
  const diff = getManagedDiff(runner, root);
  const diffText = diff.stdout.trim() || "No tracked managed diff.";

  return `AI Agent Kit Managed Diff

Repository: ${root}

Managed Git status:
${managedStatus.map((line) => `- ${line}`).join("\n") || "- Clean"}

Tracked managed diff:
${diffText}

No files were modified.`;
}

export function renderUpdatePreview(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const installation = readInstallation(root);
  if (!installation) {
    throw new Error("AI Agent Kit is not installed in this repository. Run bootstrap --dry-run first.");
  }
  const currentVersion = deps.packageVersion ?? getPackageVersion();
  const managedCount = Array.isArray(installation.managedFiles) ? installation.managedFiles.length : 0;

  return `AI Agent Kit Update: DRY RUN

Repository: ${root}
Installed version: ${installation.version ?? "unknown"}
Current CLI version: ${currentVersion}
Preset: ${installation.preset ?? "governed-v0.1"}
Managed entries recorded: ${managedCount || "legacy installation - ownership manifest unavailable"}

An applied update would use the same transactional merge, backup, protected-path validation, and rollback controls as bootstrap.
No files were modified.
No tools were installed.
No indexes were refreshed.
No Git operations were performed.`;
}

export function renderUninstallPreview(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const installation = readInstallation(root);
  if (!installation) {
    throw new Error("AI Agent Kit is not installed in this repository.");
  }
  const managedFiles = Array.isArray(installation.managedFiles) ? installation.managedFiles : [];
  if (managedFiles.length === 0) {
    return `AI Agent Kit Uninstall: DRY RUN

Repository: ${root}
Installed version: ${installation.version ?? "unknown"}

This legacy installation has no ownership manifest. Refusing to infer removable files.
No files were modified.
Run update --dry-run with the current CLI before planning a future transactional uninstall.`;
  }

  return `AI Agent Kit Uninstall: DRY RUN

Repository: ${root}
Installed version: ${installation.version ?? "unknown"}
Preset: ${installation.preset ?? "governed"}

Managed entries that would require transactional review:
${managedFiles.map((entry) => `- ${entry.mode}: ${entry.path}`).join("\n")}

Managed sections would be removed without deleting surrounding human content.
Generated files would require ownership verification before removal.
No files were modified.
No Git operations were performed.`;
}
