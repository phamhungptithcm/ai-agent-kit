import fs from "node:fs";
import path from "node:path";
import { verifyContract } from "./contract.mjs";
import { getManagedDiff, getStatus, requireGitRoot } from "./git.mjs";
import { hasSymlinkComponent, isApprovedConfigPath } from "./paths.mjs";
import { verifyOwnership } from "./ownership.mjs";
import { createRunner } from "./runner.mjs";
import { checkCodeGraph, checkCocoIndex } from "./tools.mjs";
import { getPackageVersion } from "./version.mjs";

function exists(root, relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function readInstallation(root) {
  const installationPath = path.join(root, ".ai-agent-kit", "installation.json");
  if (!fs.existsSync(installationPath)) return null;
  if (hasSymlinkComponent(root, ".ai-agent-kit/installation.json")) {
    throw new Error("Refusing to read AI Agent Kit installation metadata through a symbolic link");
  }
  try {
    return JSON.parse(fs.readFileSync(installationPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid AI Agent Kit installation metadata: ${error.message}`);
  }
}

function legacyAdapterStatus(root) {
  return {
    claude: exists(root, "CLAUDE.md") && exists(root, ".claude/settings.json") ? "READY" : "NOT_INSTALLED",
    codex: exists(root, "AGENTS.md") && exists(root, ".codex/config.toml") ? "READY" : "NOT_INSTALLED"
  };
}

function selectedAdapterStatus(ownership, enabled, predicate) {
  if (!enabled) return "NOT_INSTALLED";
  const entries = ownership.entries.filter((entry) => predicate(entry.path));
  if (
    entries.length === 0 ||
    entries.some((entry) =>
      ["MISSING", "INVALID_MANAGED_SECTION", "INVALID_PATH", "TOO_LARGE", "SYMLINK"].includes(entry.state)
    )
  ) {
    return "INCOMPLETE";
  }
  if (entries.some((entry) => entry.state === "MODIFIED")) return "DRIFTED";
  if (entries.some((entry) => entry.state === "UNVERIFIED")) return "UNVERIFIED";
  return "READY";
}

function adapterStatus(root, installation, ownership) {
  if (!installation?.adapters) return legacyAdapterStatus(root);
  return {
    claude: selectedAdapterStatus(
      ownership,
      installation.adapters.claude,
      (relPath) => relPath === "CLAUDE.md" || relPath.startsWith(".claude/")
    ),
    codex: selectedAdapterStatus(
      ownership,
      installation.adapters.codex,
      (relPath) => relPath === "AGENTS.md" || relPath.startsWith(".agents/") || relPath.startsWith(".codex/")
    )
  };
}

function intelligenceStatus(codegraph, cocoindex) {
  if (codegraph.status === "READY" && cocoindex.status === "READY") return "READY";
  if (codegraph.status === "MISSING" || cocoindex.status === "MISSING") return "NOT_CONFIGURED";
  return "BLOCKED";
}

function ownershipStatus(ownership) {
  if (ownership.entries.length === 0) return "LEGACY_UNVERIFIED";
  if (
    ownership.entries.some((entry) =>
      ["MISSING", "INVALID_MANAGED_SECTION", "INVALID_PATH", "TOO_LARGE", "SYMLINK", "MODIFIED"].includes(entry.state)
    )
  ) {
    return "DRIFTED";
  }
  if (ownership.entries.some((entry) => entry.state === "UNVERIFIED")) return "UNVERIFIED";
  return "VERIFIED";
}

function ownershipSummary(ownership) {
  const order = [
    "UNCHANGED",
    "MODIFIED",
    "MISSING",
    "INVALID_MANAGED_SECTION",
    "INVALID_PATH",
    "TOO_LARGE",
    "SYMLINK",
    "UNVERIFIED"
  ];
  return order
    .filter((state) => ownership.counts[state])
    .map((state) => `${state}=${ownership.counts[state]}`)
    .join(", ") || "none";
}

function ownershipConflicts(ownership) {
  return ownership.entries.filter((entry) => entry.state !== "UNCHANGED");
}

export function inspectInstallation(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const installation = readInstallation(root);
  const ownership = verifyOwnership(root, installation?.managedFiles ?? []);
  const contract = installation
    ? verifyContract(root, ownership)
    : { state: "INCOMPLETE", requiredPaths: [".ai/manifest.yaml"], missingPaths: [".ai/manifest.yaml"], driftedPaths: [] };
  const core = contract.state;
  const adapters = adapterStatus(root, installation, ownership);
  const codegraph = checkCodeGraph(runner, root);
  const cocoindex = checkCocoIndex(runner, root);
  const repositoryIntelligence = intelligenceStatus(codegraph, cocoindex);
  const installedAdapters = Object.values(adapters).filter((state) => state !== "NOT_INSTALLED");
  const adaptersReady = installedAdapters.length > 0 && installedAdapters.every((state) => state === "READY");
  const governedImplementation = core === "CORE_READY" && adaptersReady && repositoryIntelligence === "READY"
    ? "READY"
    : "BLOCKED";

  return {
    root,
    installation,
    installedVersion: installation?.version ?? "not-installed",
    currentVersion: deps.packageVersion ?? getPackageVersion(),
    preset: installation?.preset ?? (installation ? "governed-v0.1" : "not-installed"),
    core,
    contract,
    ownership,
    ownershipStatus: ownershipStatus(ownership),
    adapters,
    codegraph,
    cocoindex,
    repositoryIntelligence,
    governedImplementation,
    missingCoreFiles: contract.missingPaths,
    driftedCoreFiles: contract.driftedPaths
  };
}

export function renderStatus(status) {
  return `AI Agent Kit Status

Repository: ${status.root}
Installed version: ${status.installedVersion}
Current CLI version: ${status.currentVersion}
Preset: ${status.preset}

Core policy: ${status.core}
Ownership: ${status.ownershipStatus} (${ownershipSummary(status.ownership)})
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
  } else if (status.missingCoreFiles.length > 0 || status.driftedCoreFiles.length > 0) {
    actions.push("Preview repair: npx --yes @hunpeolabs/ai-agent-kit@latest update --dry-run");
  }
  if (status.repositoryIntelligence === "NOT_CONFIGURED") {
    actions.push("Review tool changes: npx --yes @hunpeolabs/ai-agent-kit@latest tools plan");
    actions.push("After review: npx --yes @hunpeolabs/ai-agent-kit@latest tools install --apply");
  } else if (status.repositoryIntelligence !== "READY") {
    actions.push("Refresh ready indexes: npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --refresh-indexes");
  }
  if (actions.length === 0) actions.push("No blocking issue found.");

  const missing = status.missingCoreFiles.length > 0
    ? `\n\nMissing core files:\n${status.missingCoreFiles.map((file) => `- ${file}`).join("\n")}`
    : "";
  const drifted = status.driftedCoreFiles.length > 0
    ? `\n\nDrifted core files:\n${status.driftedCoreFiles.map((file) => `- ${file}`).join("\n")}`
    : "";

  return `${renderStatus(status)}

Diagnosis:
- Installation and operational readiness are reported separately.
- CORE_READY does not permit governed implementation while Repository Intelligence is not READY.
- Doctor is read-only and did not modify repository files.

Next actions:
${actions.map((action) => `- ${action}`).join("\n")}${missing}${drifted}`;
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
  const ownership = verifyOwnership(root, installation.managedFiles ?? []);
  const conflicts = ownershipConflicts(ownership);

  return `AI Agent Kit Update: DRY RUN

Repository: ${root}
Installed version: ${installation.version ?? "unknown"}
Current CLI version: ${currentVersion}
Preset: ${installation.preset ?? "governed-v0.1"}
Managed entries recorded: ${managedCount || "legacy installation - ownership manifest unavailable"}
Ownership verification: ${ownershipStatus(ownership)} (${ownershipSummary(ownership)})
Entries requiring review:
${conflicts.map((entry) => `- ${entry.state}: ${entry.mode}: ${entry.path}`).join("\n") || "- None"}

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
  const ownership = verifyOwnership(root, managedFiles);

  return `AI Agent Kit Uninstall: DRY RUN

Repository: ${root}
Installed version: ${installation.version ?? "unknown"}
Preset: ${installation.preset ?? "governed"}
Ownership verification: ${ownershipStatus(ownership)} (${ownershipSummary(ownership)})

Managed entries that would require transactional review:
${ownership.entries.map((entry) => `- ${entry.state}: ${entry.mode}: ${entry.path}`).join("\n")}

Managed sections would be removed without deleting surrounding human content.
Only UNCHANGED generated files could be considered safe for a future removal.
MODIFIED, MISSING, INVALID_MANAGED_SECTION, INVALID_PATH, TOO_LARGE, SYMLINK, and UNVERIFIED entries require human review and would be preserved.
No files were modified.
No Git operations were performed.`;
}
