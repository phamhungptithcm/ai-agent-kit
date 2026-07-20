import { bootstrap } from "./bootstrap.mjs";
import { renderNamedPrompt, renderPromptCatalog, renderPromptList } from "./prompt-catalog.mjs";

const FORBIDDEN_BOOTSTRAP_OPTIONS = new Set(["--commit", "--push", "--create-mr", "--git-mode"]);
const CLI_VERSION = "0.1.0";

function helpText() {
  return `AI Agent Kit

Usage:
  ai-agent-kit bootstrap [options]
  ai-agent-kit prompts
  ai-agent-kit prompt <name>

Options:
  --target <path>          Repository to bootstrap. Defaults to the current directory.
  --profile <name|auto>    Force a profile or use auto detection. Defaults to auto.
  --dry-run                Show planned files without writing, installing, or indexing.
  --install-tools          Install missing CodeGraph/CocoIndex tooling.
  --no-install-tools       Keep bootstrap policy-only and skip tool installation.
  --refresh-indexes        Refresh CodeGraph/CocoIndex indexes during bootstrap.
  --no-refresh-indexes     Skip index refresh during bootstrap.
  --deep                   Install missing tools and refresh indexes.
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

export function parseBootstrapArgs(argv) {
  const options = {
    target: process.cwd(),
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
      case "--non-interactive":
        options.nonInteractive = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--install-tools":
        options.installTools = true;
        break;
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
        options.installTools = true;
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
    io.log(CLI_VERSION);
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
  if (command !== "bootstrap") {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = parseBootstrapArgs(argv.slice(1));
  return bootstrap(options, { io, ...deps });
}
