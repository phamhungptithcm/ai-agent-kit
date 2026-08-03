import { bootstrap } from "./bootstrap.mjs";
import { ADAPTER_IDS, resolveAdapterIds } from "./adapters.mjs";
import {
  findInstalledDependency,
  renderActivationMenu,
  renderDependencyCleanup,
  renderNonInteractiveActivationHelp,
  selectActivationAction
} from "./activation.mjs";
import {
  inspectInstallation,
  renderDoctor,
  renderManagedDiff,
  renderStatus,
  renderUninstallPreview
} from "./inspection.mjs";
import { renderNamedPrompt, renderPromptCatalog, renderPromptList } from "./prompt-catalog.mjs";
import { applyToolPlan, inspectToolPlan, renderToolInstall, renderToolPlan } from "./tool-lifecycle.mjs";
import { getPackageVersion } from "./version.mjs";
import { applyUpdate, planUpdate, renderUpdatePlan } from "./update.mjs";
import { compileContext, inspectContextPack } from "./context-compiler.mjs";
import {
  authorizeMcpRequest,
  authorizeMcpStart,
  inspectMcpTrust
} from "./mcp-broker.mjs";
import {
  addContext,
  approveMemory,
  authorizeAction,
  createTask,
  evaluateAction,
  exportEvidence,
  inspectTask,
  proposeMemory,
  queryMemory,
  recordActionVerification,
  revisePlan,
  scoreTask,
  transitionTask,
  verifyEvidence
} from "./governed-runtime.mjs";
import {
  buildFinalTaskReport,
  recordCriterionStatus,
  recordQualityCheck,
  renderFinalTaskReport
} from "./task-report.mjs";
import { recordUsage, renderUsageSummary, summarizeUsage } from "./usage-ledger.mjs";
import { compareEvalResults, gateEvalResults, replayEvalFixture } from "./eval-harness.mjs";
import { compareReviewQuality, scoreReviewQuality } from "./review-quality.mjs";
import { assertPrEvidenceScope, buildPrEvidencePackage, renderPrEvidenceMarkdown } from "./pr-evidence.mjs";
import { recordFinalReview } from "./final-review.mjs";

const FORBIDDEN_BOOTSTRAP_OPTIONS = new Set(["--commit", "--push", "--create-mr", "--git-mode"]);
const SUPPORTED_PRESETS = new Set(["governed", "full"]);

function helpText() {
  return `AI Agent Kit

Usage:
  ai-agent-kit activate
  ai-agent-kit bootstrap [options]
  ai-agent-kit status [--target <path>]
  ai-agent-kit doctor [--target <path>]
  ai-agent-kit diff [--target <path>]
  ai-agent-kit update (--dry-run | --apply) [--target <path>]
  ai-agent-kit context compile|inspect --id <task-id> [--budget <tokens>] [--target <path>]
  ai-agent-kit uninstall --dry-run [--target <path>]
  ai-agent-kit tools plan [--target <path>]
  ai-agent-kit tools install --apply [--target <path>]
  ai-agent-kit prompts
  ai-agent-kit prompt <name>
  ai-agent-kit eval replay --fixture <file>
  ai-agent-kit eval compare|gate --baseline <file> --candidate <file>
  ai-agent-kit eval review-score|review-baseline --fixture <file>
  ai-agent-kit eval review-compare --baseline <file> --candidate <file>
  ai-agent-kit evidence pr-package --id <task-id> [--base-ref <ref>] [--format json|markdown]
  ai-agent-kit runtime task create|status|transition|report [options]
  ai-agent-kit runtime criterion record [options]
  ai-agent-kit runtime check record [options]
  ai-agent-kit runtime review record --id <task-id> --file <review.json>
  ai-agent-kit runtime usage record|summary [options]
  ai-agent-kit runtime context add [options]
  ai-agent-kit runtime plan revise [options]
  ai-agent-kit runtime gateway authorize|verify [options]
  ai-agent-kit runtime mcp inspect|start|authorize [options]
  ai-agent-kit runtime policy evaluate [options]
  ai-agent-kit runtime evidence verify|export [options]
  ai-agent-kit runtime memory propose|approve|query [options]
  ai-agent-kit runtime eval score [options]

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
  --agents <list|all>      Install comma-separated adapters. Defaults to all.
                           Available: ${ADAPTER_IDS.join(", ")}.
  --claude-only            Legacy alias for --agents claude.
  --codex-only             Legacy alias for --agents codex.
  --yes                    Reserved for non-interactive automation.
  --verbose                Reserved for detailed diagnostics.
  -h, --help               Show this help.
  -v, --version            Show CLI version.

Governed runtime:
  task create requires --id and accepts --approval-hash, --risk, --tool,
  --path, --domain, --expires-at, --max-actions, and --target.
  task transition requires --id, --to, and transition evidence as --evidence key=value.
  gateway authorize requires --id and --tool; every decision records a receipt.
  mcp start|authorize requires --id and an exact JSON --server identity.
  task report combines completion, quality, Git, production-readiness, token,
  and API-equivalent cost evidence. Use --format text, compact, or json.
  Eval replay is offline and uses versioned recorded fixtures. Eval gate fails
  on material or statistically significant regressions.

Prompt names:
  start-task, plan-change, implement-approved, fix-bug,
  code-quality-review, review-pr, investigate-incident,
  prepare-handoff

Safety:
  bootstrap is local only. It never stages, commits, pushes, creates branches,
  creates merge requests, updates Jira, deploys, or edits application source code.
  By default it is fast and policy-only: it does not install tools or refresh indexes.`;
}

export function parseEvalArgs(argv) {
  const action = argv[0];
  if (!new Set(["replay", "compare", "gate", "review-score", "review-baseline", "review-compare"]).has(action)) throw new Error("eval requires replay, compare, gate, review-score, review-baseline, or review-compare");
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--fixture", "--baseline", "--candidate", "--material-threshold"].includes(flag)) throw new Error(`Unknown eval option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (["replay", "review-score", "review-baseline"].includes(action) && !options.fixture) throw new Error(`${action} requires --fixture`);
  if (["compare", "gate", "review-compare"].includes(action) && (!options.baseline || !options.candidate)) throw new Error(`${action} requires --baseline and --candidate`);
  return { action, options };
}

export function parsePrEvidenceArgs(argv) {
  if (argv[0] !== "pr-package") throw new Error("evidence requires pr-package");
  const options = { target: process.cwd(), format: "markdown", requiredGates: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--id", "--target", "--base-ref", "--format", "--required-gate"].includes(flag)) throw new Error(`Unknown evidence option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--required-gate") options.requiredGates.push(value);
    else options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.id) throw new Error("pr-package requires --id");
  if (!["json", "markdown"].includes(options.format)) throw new Error("pr-package format must be json or markdown");
  return options;
}

export function parseRuntimeArgs(argv) {
  const area = argv[0];
  const action = argv[1];
  const options = {
    target: process.cwd(),
    tools: [],
    paths: [],
    domains: [],
    evidence: {},
    acceptanceCriteria: [],
    steps: [],
    requiredGates: []
  };
  const valueFlags = new Set([
    "--target", "--id", "--to", "--approval-hash", "--risk", "--tool", "--path",
    "--domain", "--expires-at", "--max-actions", "--command", "--evidence",
    "--repository-commit", "--policy-revision", "--adapter", "--goal", "--acceptance",
    "--kind", "--statement", "--source", "--confidence", "--trigger", "--step", "--title",
    "--content", "--category", "--scope", "--source-commit", "--memory-id", "--approver",
    "--review-date", "--query", "--decision-token", "--execution-receipt-hash", "--status",
    "--server", "--parameters", "--timeout-ms", "--registry", "--criterion", "--weight",
    "--gate", "--summary", "--required", "--exit-code", "--format", "--required-gate",
    "--production-target", "--provider", "--model", "--usage-source", "--aggregation-mode",
    "--session-id", "--event-id", "--observed-at", "--service-tier", "--inference-geo",
    "--batch", "--requests", "--input-tokens", "--cached-input-tokens",
    "--cache-read-input-tokens", "--cache-write-input-tokens",
    "--cache-write-5m-input-tokens", "--cache-write-1h-input-tokens",
    "--output-tokens", "--reasoning-tokens", "--file"
  ]);
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!valueFlags.has(flag)) throw new Error(`Unknown runtime option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--tool") options.tools.push(value);
    else if (flag === "--path") options.paths.push(value);
    else if (flag === "--domain") options.domains.push(value);
    else if (flag === "--acceptance") options.acceptanceCriteria.push(value);
    else if (flag === "--step") options.steps.push(value);
    else if (flag === "--required-gate") options.requiredGates.push(value);
    else if (flag === "--server" || flag === "--parameters") {
      const key = flag.slice(2);
      try {
        options[key] = JSON.parse(value);
      } catch {
        throw new Error(`${flag} requires valid JSON`);
      }
    }
    else if (flag === "--evidence") {
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("--evidence requires key=value");
      options.evidence[value.slice(0, separator)] = value.slice(separator + 1);
    } else {
      const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = value;
    }
  }
  if (!["task", "criterion", "check", "review", "usage", "context", "plan", "gateway", "mcp", "policy", "evidence", "memory", "eval"].includes(area)) {
    throw new Error("runtime area must be task, criterion, check, review, usage, context, plan, gateway, mcp, policy, evidence, memory, or eval");
  }
  if (!((area === "memory" && action === "query") || (area === "mcp" && action === "inspect")) && !options.id) {
    throw new Error("runtime command requires --id");
  }
  if (options.format && !["text", "compact", "json"].includes(options.format)) {
    throw new Error("--format must be text, compact, or json");
  }
  return { area, action, options };
}

function runRuntime(argv, deps = {}) {
  const { area, action, options } = parseRuntimeArgs(argv);
  if (area === "task" && action === "create") {
    return createTask({ ...options, tools: options.tools, paths: options.paths, domains: options.domains });
  }
  if (area === "task" && action === "status") return inspectTask(options);
  if (area === "task" && action === "transition") return transitionTask({ ...options, deps });
  if (area === "task" && action === "report") {
    const report = buildFinalTaskReport(options, deps);
    if (options.format === "json") return report;
    return renderFinalTaskReport(report, { compact: options.format === "compact" });
  }
  if (area === "criterion" && action === "record") return recordCriterionStatus(options);
  if (area === "check" && action === "record") return recordQualityCheck({ ...options, deps });
  if (area === "review" && action === "record") {
    if (!options.file) throw new Error("review record requires --file");
    return recordFinalReview(options, deps);
  }
  if (area === "usage" && action === "record") return recordUsage(options);
  if (area === "usage" && action === "summary") {
    const summary = summarizeUsage(options);
    if (options.format === "json") return summary;
    return renderUsageSummary(summary, { compact: options.format === "compact" });
  }
  if (area === "context" && action === "add") return addContext(options);
  if (area === "plan" && action === "revise") return revisePlan(options);
  if (area === "gateway" && action === "authorize") {
    return authorizeAction({
      ...options,
      tool: options.tools[0],
      path: options.paths[0],
      domain: options.domains[0]
    });
  }
  if (area === "gateway" && action === "verify") return recordActionVerification(options);
  if (area === "mcp" && action === "inspect") return inspectMcpTrust(options);
  if (area === "mcp" && action === "start") return authorizeMcpStart(options);
  if (area === "mcp" && action === "authorize") {
    return authorizeMcpRequest({
      ...options,
      path: options.paths[0],
      domain: options.domains[0],
      tool: options.tools[0],
      timeoutMs: options.timeoutMs
    });
  }
  if (area === "policy" && action === "evaluate") {
    return evaluateAction({
      ...options,
      tool: options.tools[0],
      path: options.paths[0],
      domain: options.domains[0]
    });
  }
  if (area === "evidence" && action === "verify") return verifyEvidence(options);
  if (area === "evidence" && action === "export") return exportEvidence(options);
  if (area === "memory" && action === "propose") return proposeMemory(options);
  if (area === "memory" && action === "approve") return approveMemory(options);
  if (area === "memory" && action === "query") return queryMemory(options);
  if (area === "eval" && action === "score") return scoreTask(options);
  throw new Error(`Unknown runtime command: ${area} ${action ?? ""}`.trim());
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

export function parseUpdateArgs(argv) {
  const options = { target: process.cwd(), dryRun: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      options.target = argv[++index];
      if (!options.target) throw new Error("--target requires a path");
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`Unknown update option: ${arg}`);
  }
  if (options.dryRun === options.apply) throw new Error("update requires exactly one of --dry-run or --apply");
  return options;
}

export function parseContextArgs(argv) {
  const action = argv[0];
  if (!["compile", "inspect"].includes(action)) throw new Error("context requires compile or inspect");
  const options = { target: process.cwd(), budget: 12_000 };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") options.target = argv[++index];
    else if (arg === "--id") options.id = argv[++index];
    else if (arg === "--budget") options.budget = Number(argv[++index]);
    else throw new Error(`Unknown context option: ${arg}`);
    if (options[arg.slice(2)] === undefined || options[arg.slice(2)] === "") throw new Error(`${arg} requires a value`);
  }
  if (!options.id) throw new Error("context command requires --id");
  return { action, options };
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
    agents: null,
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
      case "--agents":
        options.agents = argv[++index];
        if (!options.agents) throw new Error("--agents requires a comma-separated list or all");
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
  if (options.agents && (options.claudeOnly || options.codexOnly)) {
    throw new Error("--agents cannot be combined with --claude-only or --codex-only");
  }
  resolveAdapterIds(options);
  return options;
}

export async function main(argv = process.argv.slice(2), io = console, deps = {}) {
  const command = argv[0];
  if (!command || command === "activate") {
    io.log(renderActivationMenu());
    const action = deps.selectActivationAction
      ? await deps.selectActivationAction()
      : await selectActivationAction(deps.terminal);
    if (!action) {
      const nonInteractiveHelp = renderNonInteractiveActivationHelp();
      io.log(`\n${nonInteractiveHelp.slice(nonInteractiveHelp.indexOf("Interactive input"))}`);
      return 0;
    }
    if (action === "exit") return 0;

    const options = parseBootstrapArgs([
      ...(action === "preview" ? ["--dry-run"] : ["--preset", action])
    ]);
    const result = await bootstrap(options, { io, ...deps });
    if (action !== "preview") {
      const dependencyField = findInstalledDependency(options.target);
      if (dependencyField) io.log(`\n${renderDependencyCleanup(dependencyField)}`);
    }
    return result;
  }
  if (command === "--help" || command === "-h") {
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
  if (command === "eval") {
    const { action, options } = parseEvalArgs(argv.slice(1));
    const result = action === "replay" ? replayEvalFixture(options)
      : action === "compare" ? compareEvalResults(options)
        : action === "gate" ? gateEvalResults(options)
          : action === "review-compare" ? compareReviewQuality(options)
            : scoreReviewQuality(options);
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (command === "evidence") {
    const options = parsePrEvidenceArgs(argv.slice(1));
    const pkg = assertPrEvidenceScope(buildPrEvidencePackage(options, deps));
    io.log(options.format === "json" ? JSON.stringify(pkg, null, 2) : renderPrEvidenceMarkdown(pkg));
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
    const options = parseUpdateArgs(argv.slice(1));
    const result = options.apply ? applyUpdate(options, deps) : planUpdate(options, deps);
    io.log(renderUpdatePlan(result, options.apply ? result.status : "DRY RUN"));
    return 0;
  }
  if (command === "context") {
    const { action, options } = parseContextArgs(argv.slice(1));
    const result = action === "compile" ? compileContext(options, deps) : inspectContextPack(options);
    io.log(JSON.stringify(result, null, 2));
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
  if (command === "runtime") {
    const result = runRuntime(argv.slice(1), deps);
    io.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    return 0;
  }
  if (command !== "bootstrap") {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = parseBootstrapArgs(argv.slice(1));
  return bootstrap(options, { io, ...deps });
}
