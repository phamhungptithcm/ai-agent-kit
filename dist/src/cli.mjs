import { bootstrap } from "./bootstrap.mjs";
import {
  inspectInstallation,
  renderDoctor,
  renderManagedDiff,
  renderStatus,
  renderUninstallPreview,
  renderUpdatePreview
} from "./inspection.mjs";
import { renderNamedPrompt, renderPromptCatalog, renderPromptList } from "./prompt-catalog.mjs";
import { applyToolPlan, inspectToolPlan, renderToolInstall, renderToolPlan } from "./tool-lifecycle.mjs";
import { getPackageVersion } from "./version.mjs";

const FORBIDDEN_BOOTSTRAP_OPTIONS = new Set(["--commit", "--push", "--create-mr", "--git-mode"]);
const SUPPORTED_PRESETS = new Set(["governed", "full"]);

function helpText() {
  return `AI Agent Kit

Usage:
  ai-agent-kit bootstrap [options]
  ai-agent-kit status [--target <path>]
  ai-agent-kit doctor [--target <path>]
  ai-agent-kit diff [--target <path>]
  ai-agent-kit update --dry-run [--target <path>]
  ai-agent-kit uninstall --dry-run [--target <path>]
  ai-agent-kit tools plan [--target <path>]
  ai-agent-kit tools install --apply [--target <path>]
  ai-agent-kit prompts
  ai-agent-kit prompt <name>

Options:
  --target <path>          Repository to bootstrap. Defaults to the current directory.
  --preset <name>          Installation contract: governed or full. Defaults to governed.
  --profile <name|auto>    Force a profile or use auto detection. Defaults to auto.
  --dry-run                Show planned files without writing, installing, or indexing.
  --install-tools          Disabled. Use tools install --apply after reviewing tools plan.
  --no-install-tools       Keep bootstrap policy-only and skip tool installation.
  --refresh-indexes        Refresh CodeGraph/CocoIndex indexes during bootstrap.
  --no-refresh-indexes     Skip index refresh during bootstrap.
  --deep                   Refresh ready indexes; never installs global tools.
  --claude-only            Install Claude Code adapter files only.
  --codex-only             Install Codex adapter files only.
  --yes                    Reserved for non-interactive automation.
  --verbose                Reserved for detailed diagnostics.
  -h, --help               Show this help.
  -v, --version            Show CLI version.

Prompt names:
  start-task, plan-change, implement-approved, fix-bug,
  code-quality-review, review-pr, investigate-incident,
  prepare-handoff

Safety:
  bootstrap is local only. It never stages, commits, pushes, creates branches,
  creates merge requests, updates Jira, deploys, or edits application source code.
  By default it is fast and policy-only: it does not install tools or refresh indexes.`;
}

export function parseToolArgs(argv) {
  const subcommand = argv[0];
  if (subcommand !== "plan" && subcommand !== "install") {
    throw new Error("Tools command requires one of: plan, install");
  }
  const options = { target: process.cwd(), apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = argv[++index];
      if (!options.target) throw new Error("--target requires a path");
    } else if (arg === "--apply") {
      options.apply = true;
    } else {
      throw new Error(`Unknown tools option: ${arg}`);
    }
  }
  if (subcommand === "plan" && options.apply) {
    throw new Error("tools plan is read-only and does not accept --apply");
  }
  if (subcommand === "install" && !options.apply) {
    throw new Error("Tool installation changes the user environment. Re-run with tools install --apply.");
  }
  return { subcommand, options };
}

export function parseTargetArgs(argv, { requireDryRun = false } = {}) {
  const options = { target: process.cwd(), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = argv[++index];
      if (!options.target) throw new Error("--target requires a path");
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (requireDryRun && !options.dryRun) {
    throw new Error("This lifecycle command is preview-only. Re-run it with --dry-run.");
  }
  return options;
}

export function parseBootstrapArgs(argv) {
  const options = {
    target: process.cwd(),
    preset: "governed",
    profile: "auto",
    nonInteractive: false,
    yes: false,
    installTools: false,
    refreshIndexes: false,
    claudeOnly: false,
    codexOnly: false,
    dryRun: false,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (FORBIDDEN_BOOTSTRAP_OPTIONS.has(arg)) {
      throw new Error("Remote Git operations are disabled for bootstrap.\nReview and perform Git operations manually.");
    }
    switch (arg) {
      case "--target":
        options.target = argv[++index];
        if (!options.target) throw new Error("--target requires a path");
        break;
      case "--profile":
        options.profile = argv[++index];
        if (!options.profile) throw new Error("--profile requires a value");
        break;
      case "--preset":
        options.preset = argv[++index];
        if (!options.preset) throw new Error("--preset requires a value");
        if (!SUPPORTED_PRESETS.has(options.preset)) {
          throw new Error(`Unsupported preset: ${options.preset}. Available presets: governed, full`);
        }
        break;
      case "--non-interactive":
        options.nonInteractive = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--install-tools":
        throw new Error("--install-tools is disabled. Review `tools plan`, then run `tools install --apply`.");
      case "--no-install-tools":
        options.installTools = false;
        break;
      case "--refresh-indexes":
      case "--index":
        options.refreshIndexes = true;
        break;
      case "--no-refresh-indexes":
      case "--no-index":
        options.refreshIndexes = false;
        break;
      case "--deep":
        options.installTools = false;
        options.refreshIndexes = true;
        break;
      case "--claude-only":
        options.claudeOnly = true;
        break;
      case "--codex-only":
        options.codexOnly = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        options.installTools = false;
        options.refreshIndexes = false;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown bootstrap option: ${arg}`);
    }
  }

  if (options.claudeOnly && options.codexOnly) {
    throw new Error("--claude-only and --codex-only cannot be used together");
  }
  return options;
}

export async function main(argv = process.argv.slice(2), io = console, deps = {}) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    io.log(helpText());
    return 0;
  }
  if (command === "--version" || command === "-v") {
    io.log(getPackageVersion());
    return 0;
  }
  if (command === "prompts") {
    io.log(renderPromptCatalog());
    return 0;
  }
  if (command === "prompt") {
    const name = argv[1];
    if (!name || name === "--help" || name === "-h") {
      io.log(renderPromptList());
      return 0;
    }
    io.log(renderNamedPrompt(name));
    return 0;
  }
  if (command === "status") {
    const options = parseTargetArgs(argv.slice(1));
    io.log(renderStatus(inspectInstallation(options, deps)));
    return 0;
  }
  if (command === "doctor") {
    const options = parseTargetArgs(argv.slice(1));
    io.log(renderDoctor(inspectInstallation(options, deps)));
    return 0;
  }
  if (command === "diff") {
    const options = parseTargetArgs(argv.slice(1));
    io.log(renderManagedDiff(options, deps));
    return 0;
  }
  if (command === "update") {
    const options = parseTargetArgs(argv.slice(1), { requireDryRun: true });
    io.log(renderUpdatePreview(options, deps));
    return 0;
  }
  if (command === "uninstall") {
    const options = parseTargetArgs(argv.slice(1), { requireDryRun: true });
    io.log(renderUninstallPreview(options, deps));
    return 0;
  }
  if (command === "tools") {
    const { subcommand, options } = parseToolArgs(argv.slice(1));
    if (subcommand === "plan") {
      io.log(renderToolPlan(inspectToolPlan(options, deps)));
    } else {
      io.log(renderToolInstall(applyToolPlan(options, deps)));
    }
    return 0;
  }
  if (command !== "bootstrap") {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = parseBootstrapArgs(argv.slice(1));
  return bootstrap(options, { io, ...deps });
}
