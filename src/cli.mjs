import { bootstrap } from "./bootstrap.mjs";
import { ADAPTER_IDS, resolveAdapterIds } from "./adapters.mjs";
import { capabilityMatrix, evaluateAdapterConformance, loadAdapterRegistry } from "./adapter-sdk.mjs";
import { evaluateStandardsConformance } from "./standards-conformance.mjs";
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
import { evaluateSkillRouting, loadSkillRoutingConfig, loadSkillRoutingFixture, routeSkill, verifySkillRouting } from "./skill-routing.mjs";
import { applyToolPlan, inspectToolPlan, renderToolInstall, renderToolPlan } from "./tool-lifecycle.mjs";
import { getPackageVersion } from "./version.mjs";
import { applyUpdate, planUpdate, renderUpdatePlan } from "./update.mjs";
import { compileContext, inspectContextPack } from "./context-compiler.mjs";
import {
  authorizeMcpRequest,
  authorizeMcpStart,
  executeMcpRequest,
  inspectMcpTrust
} from "./mcp-broker.mjs";
import {
  addContext,
  approveMemory,
  authorizeAction,
  createTask,
  evaluateAction,
  executeAuthorizedAction,
  exportEvidence,
  inspectTask,
  proposeMemory,
  queryMemory,
  revokeMemory,
  supersedeMemory,
  inspectMemoryHealth,
  recordActionVerification,
  revisePlan,
  scoreTask,
  simulateAction,
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
import { generatePolicyKey, initializePolicyBundle, loadRepositoryPolicyOverlays, signPolicyFile, verifyPolicyFile } from "./policy-overlays.mjs";
import { compareOutcomes, recordOutcome, summarizeOutcomes } from "./outcome-analytics.mjs";
import { buildProofReplay, demoProof, writeProofArtifacts } from "./proof-replay.mjs";
import { planFailureLab, runFailureLab, writeFailureReport } from "./failure-lab.mjs";
import { generatePassportKey, issueChangePassport, verifyChangePassport } from "./change-passport.mjs";
import {
  buildArchitectureArtifact,
  buildBenchmarkPlan,
  buildQuickArchitectureRequest,
  calculateSystemDesignModel,
  diffArchitectureArtifacts,
  evaluateSystemDesignFixture,
  importBenchmarkResult,
  inspectArchitectureWorkspace,
  lookupArchitecturePricing,
  applyPricingSnapshot,
  readSystemDesignJson,
  validateSystemDesignRequest,
  verifyArchitectureArtifact,
  writeArchitecturePack,
  writeArchitectureRequest
} from "./system-design.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { evaluateTeamCases, inspectTeam, planTeam, recordTeamResult, reportTeam, startTeam } from "./team-orchestrator.mjs";
import { claimTeamWork, decideTeamConflict, listTeamMemoryCandidates, publishTeamHandoff, recordTeamConflict, reviewTeamMemoryCandidate, teamContextSummary } from "./team-context.mjs";
import { listExecutionAdapters } from "./execution-adapters.mjs";
import { approveTeamRun, cancelTeamRun, dispatchTeamAssignment, heartbeatTeamAssignment, ingestTeamResult, nextTeamWave, recoverTeamRun, resumeTeamRun } from "./team-executor.mjs";
import { buildTeamTimeline, writeTeamTimeline } from "./team-events.mjs";
import { buildTeamConformanceTemplate, verifyTeamConformance } from "./team-conformance.mjs";
import { buildTeamBenchmarkTemplate, evaluateTeamBenchmark } from "./team-benchmark.mjs";
import { runTeamDemo } from "./team-demo.mjs";
import {
  buildOtelTrace,
  buildRecoveryPlan,
  explainWhy,
  exportRunBundle,
  inspectDecisionChronicle,
  inspectRun,
  inspectRunBundle,
  proposeCapabilityImprovement,
  recordDecision,
  recordRunEvent,
  resumeRun,
  resolveDecision
} from "./traceability.mjs";
import {
  applyPluginLifecycle,
  authorizePluginInvocation,
  inspectPluginManifest,
  initializePlugin,
  planPluginLifecycle,
  pluginTrustCenter
} from "./plugin-runtime.mjs";
import { evaluateReliabilityBenchmark, listTraceLabScenarios, writeTraceLab } from "./trace-lab.mjs";
import { writeOperatorView } from "./operator-view.mjs";
import { promoteTeamMemoryCandidate } from "./memory-promotion.mjs";
import { migrateLegacyMemory, rollbackMemoryMigration } from "./memory-migration.mjs";
import { createMemoryPack, importMemoryPack } from "./memory-pack.mjs";
import { resolveRepositoryIdentity, validateMemoryEntry } from "./memory-contract.mjs";
import { withMemoryStore } from "./memory-store.mjs";
import { evaluateMemoryFixture } from "./memory-eval.mjs";
import { hasSymlinkComponent } from "./paths.mjs";
import {
  analyzeArchitecturePulse,
  architecturePulseDoctor,
  checkArchitecturePulse,
  createArchitecturePulseBaseline,
  diffArchitecturePulse,
  inspectArchitecturePulseBaseline,
  migrateArchitecturePulseBaseline,
  readPulseTrend,
  readPulseConfig,
  readPulseDocument,
  recordPulseTrend,
  renderPulseSummary,
  validateArchitecturePulsePolicy,
  verifyArchitecturePulseBaseline,
  writeArchitecturePulseSarif,
  writePulseDocument,
  writePulseResult
} from "./pulse.mjs";
import { pulseExitCode } from "./pulse-policy.mjs";

const FORBIDDEN_BOOTSTRAP_OPTIONS = new Set(["--commit", "--push", "--create-mr", "--git-mode"]);
const SUPPORTED_PRESETS = new Set(["governed", "full"]);

function resolveMemoryArtifactPath(options, requested, label, { mustExist = false } = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const artifact = path.resolve(root, requested);
  const relative = path.relative(root, artifact);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error(`${label} must remain inside a non-symlinked repository path`);
  if (mustExist) {
    const stat = fs.lstatSync(artifact);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 16 * 1024 * 1024) throw new Error(`${label} must be a bounded non-linked regular file`);
  } else if (fs.existsSync(artifact)) {
    const stat = fs.lstatSync(artifact);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`${label} must be a non-linked regular file`);
  }
  return { artifact, relative };
}

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
  ai-agent-kit adapter list|matrix
  ai-agent-kit adapter inspect --adapter <id>
  ai-agent-kit adapter conformance --adapter <id> [--target <path>]
  ai-agent-kit standards verify [--target <path>]
  ai-agent-kit skills route --config <file> --hint <task>
  ai-agent-kit skills verify --config <file> --skills-root <directory> [--fixture <file>]
  ai-agent-kit skills eval --config <file> --skills-root <directory> --fixture <file>
  ai-agent-kit eval replay --fixture <file>
  ai-agent-kit eval compare|gate --baseline <file> --candidate <file>
  ai-agent-kit eval review-score|review-baseline --fixture <file>
  ai-agent-kit eval review-compare --baseline <file> --candidate <file>
  ai-agent-kit evidence pr-package --id <task-id> [--base-ref <ref>] [--format json|markdown]
  ai-agent-kit policy init|keygen|sign|verify|resolve|diff|simulate [options]
  ai-agent-kit failure plan|run --manifest <file> [--output <file>] [--apply]
  ai-agent-kit passport keygen|issue|verify [options]
  ai-agent-kit proof --id <task-id> [--output <directory>] [--otlp]
  ai-agent-kit demo [--output <directory>] [--otlp]
  ai-agent-kit tracelab list|run [--scenario <id>] [--output <directory>]
  ai-agent-kit why <file:line|decision-id> [--decision <id>] [--target <path>]
  ai-agent-kit decision record|transition|inspect|list [options]
  ai-agent-kit run record|inspect|recovery|resume|export|verify|otel [options]
  ai-agent-kit plugin init|inspect|plan|apply|authorize|trust [options]
  ai-agent-kit benchmark reliability --fixture <file>
  ai-agent-kit learning propose --candidate-id <id> --kind skill --run-id <id> [--run-id <id>]
  ai-agent-kit control view [--output <directory>]
  ai-agent-kit analytics record --id <task-id> --event <file> [--target <path>]
  ai-agent-kit analytics summary [--target <path>]
  ai-agent-kit analytics compare --baseline <file> --current <file>
  ai-agent-kit architecture quick|start --goal <description> [constraint options]
  ai-agent-kit architecture status
  ai-agent-kit architecture validate|model|benchmark-plan --file <request.json>
  ai-agent-kit architecture benchmark-import --file <result.json> --request <request.json>
  ai-agent-kit architecture pricing --provider <name> --region <id> --service <id> [--refresh]
  ai-agent-kit architecture build --file <design.json> [--output <directory>]
  ai-agent-kit architecture verify --file <architecture.json>
  ai-agent-kit architecture diff --before <architecture.json> --after <architecture.json>
  ai-agent-kit architecture eval --fixture <fixture.json>
  ai-agent-kit pulse scan [--config <pulse.json>] [--output <result.json>] [--format text|json]
  ai-agent-kit pulse baseline create [--name <name>] [--config <pulse.json>] [--output <baseline.json>]
  ai-agent-kit pulse baseline verify [--baseline <baseline.json>] [--config <pulse.json>]
  ai-agent-kit pulse baseline inspect [--baseline <baseline.json>]
  ai-agent-kit pulse baseline migrate [--baseline <v1-baseline.json>] --dry-run
  ai-agent-kit pulse check [--baseline <baseline.json>] [--config <pulse.json>] [--output <comparison.json>]
  ai-agent-kit pulse diff --base <sha> [--head <sha|working-tree>] [--config <pulse.json>]
  ai-agent-kit pulse doctor [--config <pulse.json>]
  ai-agent-kit pulse policy validate [--config <pulse.json>]
  ai-agent-kit pulse sarif --file <pulse-result-or-comparison.json> [--output <result.sarif>]
  ai-agent-kit pulse trend record --file <pulse-result-or-comparison.json> [--history <history.jsonl>]
  ai-agent-kit pulse trend show [--history <history.jsonl>]
  ai-agent-kit pulse explain --file <pulse-result-or-comparison.json>
  ai-agent-kit team plan --id <task-id> [--shape <type>] [--path <scope>]
  ai-agent-kit team start --id <task-id> --adapter <id> [--capabilities-file <json>]
  ai-agent-kit team next --id <task-id>
  ai-agent-kit team dispatch --id <task-id> --assignment <id> --agent <id>
  ai-agent-kit team heartbeat --id <task-id> --assignment <id>
  ai-agent-kit team ingest --id <task-id> --assignment <id> --result-file <result.json>
  ai-agent-kit team approve --id <task-id> --approval-hash <sha256>
  ai-agent-kit team cancel --id <task-id> [--reason <text>]
  ai-agent-kit team resume --id <task-id> [--reviewed-orphaned-writer <assignment-id>]
  ai-agent-kit team recover --id <task-id>
  ai-agent-kit team watch --id <task-id> [--output <directory>]
  ai-agent-kit team demo [--output <directory>]
  ai-agent-kit team conformance-template --adapter codex|claude
  ai-agent-kit team conformance --file <live-attestation.json>
  ai-agent-kit team benchmark-template
  ai-agent-kit team benchmark --fixture <three-mode-fixture.json>
  ai-agent-kit team capabilities
  ai-agent-kit team status|report --id <task-id>
  ai-agent-kit team context --id <task-id>
  ai-agent-kit team claim --id <task-id> --assignment <id> --agent <id> --expected-revision <n>
  ai-agent-kit team handoff --id <task-id> --claim <id> --agent <id> --expected-revision <n> --file <handoff.json>
  ai-agent-kit team conflict --id <task-id> --handoff-hash <sha256> --handoff-hash <sha256> --summary <text> --expected-revision <n>
  ai-agent-kit team decide --id <task-id> --conflict <id> --selected-handoff <sha256> --reason <text> --decided-by <id> --expected-revision <n>
  ai-agent-kit team record --id <task-id> --assignment <id> --status <status> --tokens <n> --actions <n> --duration-seconds <n> --handoff-hash <sha256> [--evidence-hash <sha256>]
  ai-agent-kit team eval --fixture <file>
  ai-agent-kit runtime task create|status|transition|report [options]
  ai-agent-kit runtime criterion record [options]
  ai-agent-kit runtime check record [options]
  ai-agent-kit runtime review record --id <task-id> --file <review.json>
  ai-agent-kit runtime usage record|summary [options]
  ai-agent-kit runtime context add [options]
  ai-agent-kit runtime plan revise [options]
  ai-agent-kit runtime gateway authorize|execute|verify [options]
  ai-agent-kit runtime mcp authorize|execute [options]
  ai-agent-kit runtime mcp inspect|start|authorize [options]
  ai-agent-kit runtime policy evaluate [options]
  ai-agent-kit runtime evidence verify|export [options]
  ai-agent-kit runtime memory propose|approve|query|revoke|supersede|health [options]
  ai-agent-kit runtime memory candidates|candidate-review|promote [options]
  ai-agent-kit runtime memory migrate|rollback|export|import|pack-export|pack-import [options]
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
  prepare-handoff, build-seo-geo-website, design-website,
  animate-interface, design-system

Safety:
  bootstrap is local only. It never stages, commits, pushes, creates branches,
  creates merge requests, updates Jira, deploys, or edits application source code.
  By default it is fast and policy-only: it does not install tools or refresh indexes.`;
}

function parseGovernedFeatureArgs(argv, actions, valueFlags, booleanFlags = []) {
  const action = argv[0];
  if (!actions.includes(action)) throw new Error(`expected one of: ${actions.join(", ")}`);
  const options = { target: process.cwd() };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.includes(flag)) { options[flag.slice(2).replaceAll("-", "_")] = true; continue; }
    if (!valueFlags.includes(flag)) throw new Error(`Unknown ${action} option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    const key = flag.slice(2).replaceAll("-", "_");
    if (["alternative", "assumption", "artifact", "decision-id", "context-hash", "plugin-receipt-hash", "check-ref", "finding-ref", "blocker", "failed-attempt", "not-tried"].includes(flag.slice(2))) (options[key] ??= []).push(value);
    else options[key] = value;
  }
  return { action, options };
}

export function parseDecisionArgs(argv) {
  return parseGovernedFeatureArgs(argv, ["record", "transition", "inspect", "list"], ["--target", "--decision-id", "--event-id", "--action", "--actor", "--task-id", "--run-id", "--question", "--choice", "--alternative", "--rationale", "--assumption", "--approval-ref", "--artifact", "--superseded-by", "--timestamp"]);
}

export function parseRunArgs(argv) {
  return parseGovernedFeatureArgs(argv, ["record", "inspect", "recovery", "resume", "export", "verify", "otel"], ["--target", "--run-id", "--event-id", "--phase", "--task-id", "--actor", "--goal", "--approval-ref", "--decision-id", "--context-hash", "--plugin-receipt-hash", "--check-ref", "--finding-ref", "--blocker", "--next-action", "--failed-attempt", "--not-tried", "--timestamp", "--output", "--profile", "--file"], ["--apply"]);
}

export function parsePluginArgs(argv) {
  return parseGovernedFeatureArgs(argv, ["init", "inspect", "plan", "apply", "authorize", "trust"], ["--target", "--file", "--state", "--adapter", "--approval-ref", "--timestamp", "--plugin-id", "--task-id", "--run-id", "--capability-token", "--requested", "--output"], ["--apply"]);
}

function permissionObject(value, label) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

export function parseAdapterArgs(argv) {
  const action = argv[0];
  if (!new Set(["list", "matrix", "inspect", "conformance"]).has(action)) throw new Error("adapter requires list, matrix, inspect, or conformance");
  const options = { target: process.cwd() };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!new Set(["--adapter", "--target"]).has(flag)) throw new Error(`Unknown adapter option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  if (["inspect", "conformance"].includes(action) && !options.adapter) throw new Error(`adapter ${action} requires --adapter`);
  if (options.adapter && !ADAPTER_IDS.includes(options.adapter)) throw new Error(`Unknown adapter: ${options.adapter}. Available: ${ADAPTER_IDS.join(", ")}`);
  if (["list", "matrix"].includes(action) && argv.length > 1) throw new Error(`adapter ${action} does not accept options`);
  return { action, options };
}

export function parseStandardsArgs(argv) {
  if (argv[0] !== "verify") throw new Error("standards requires verify");
  const options = { root: undefined };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--target") throw new Error(`Unknown standards option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error("--target requires a value");
    options.root = path.resolve(value);
  }
  return options;
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

export function parseSkillRoutingArgs(argv) {
  const action = argv[0];
  if (!new Set(["route", "verify", "eval"]).has(action)) throw new Error("skills requires route, verify, or eval");
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--config", "--hint", "--fixture", "--skills-root"].includes(flag)) throw new Error(`Unknown skills option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.config) throw new Error(`${action} requires --config`);
  if (action === "route" && !options.hint) throw new Error("route requires --hint");
  if (["verify", "eval"].includes(action) && !options.skillsRoot) throw new Error(`${action} requires --skills-root`);
  if (action === "eval" && !options.fixture) throw new Error("eval requires --fixture");
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
    requiredGates: [],
    modules: [],
    actorRoles: [],
    references: []
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
    "--output-tokens", "--reasoning-tokens", "--file", "--reason", "--replacement-id", "--limit", "--trust-tier",
    "--routing-config", "--skills-root", "--database", "--organization-id", "--repository-id",
    "--actor-id", "--actor-role", "--module", "--run-id", "--session-id", "--created-by",
    "--source-type", "--reference", "--idempotency-key", "--visibility", "--token-budget",
    "--expected-revision", "--candidate-hash", "--handoff-hash", "--reviewed-by", "--decision",
    "--migration-id", "--output", "--input", "--signing-secret-env", "--key-id", "--expires-at"
  ]);
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply" || flag === "--with-receipt") {
      options[flag === "--apply" ? "apply" : "withReceipt"] = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown runtime option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--tool") options.tools.push(value);
    else if (flag === "--path") options.paths.push(value);
    else if (flag === "--domain") options.domains.push(value);
    else if (flag === "--acceptance") options.acceptanceCriteria.push(value);
    else if (flag === "--step") options.steps.push(value);
    else if (flag === "--required-gate") options.requiredGates.push(value);
    else if (flag === "--module") options.modules.push(value);
    else if (flag === "--actor-role") options.actorRoles.push(value);
    else if (flag === "--reference") options.references.push(value);
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
  if (!((area === "memory" && ["approve", "query", "revoke", "supersede", "health", "migrate", "rollback", "export", "import", "pack-export", "pack-import", "capabilities", "eval"].includes(action)) || (area === "mcp" && action === "inspect")) && !options.id) {
    throw new Error("runtime command requires --id");
  }
  if (options.format && !["text", "compact", "json"].includes(options.format)) {
    throw new Error("--format must be text, compact, or json");
  }
  return { area, action, options };
}

function runRuntime(argv, deps = {}, meta = {}) {
  const { area, action, options } = parseRuntimeArgs(argv);
  if (area === "task" && action === "create") {
    const root = path.resolve(options.target);
    const defaultConfig = path.join(root, ".ai", "config", "skill-routing.json");
    const routingFile = options.routingConfig ? path.resolve(root, options.routingConfig) : fs.existsSync(defaultConfig) ? defaultConfig : null;
    if (routingFile && (path.relative(root, routingFile).startsWith("..") || path.isAbsolute(path.relative(root, routingFile)))) throw new Error("skill routing config must remain inside the target repository");
    const skillsRoot = path.resolve(root, options.skillsRoot ?? ".ai/skills-src");
    if (path.relative(root, skillsRoot).startsWith("..") || path.isAbsolute(path.relative(root, skillsRoot))) throw new Error("skills root must remain inside the target repository");
    return createTask({ ...options, tools: options.tools, paths: options.paths, domains: options.domains, routingConfig: routingFile ? loadSkillRoutingConfig(routingFile) : null, skillsRoot });
  }
  if (area === "task" && action === "status") return inspectTask(options);
  if (area === "task" && action === "transition") return transitionTask({ ...options, deps });
  if (area === "task" && action === "report") {
    const report = buildFinalTaskReport(options, deps);
    meta.exitCode = report.production_readiness.status === "READY" || report.production_readiness.status === "NOT_APPLICABLE" ? 0 : 1;
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
  if (area === "gateway" && action === "execute") {
    if (typeof deps.actionExecutor !== "function") throw new Error("gateway execute requires an injected host action executor");
    return executeAuthorizedAction({ ...options, tool: options.tools[0], path: options.paths[0], domain: options.domains[0] }, deps.actionExecutor);
  }
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
  if (area === "mcp" && action === "execute") {
    if (typeof deps.mcpExecutor !== "function") throw new Error("mcp execute requires an injected host MCP executor");
    return executeMcpRequest({ ...options, path: options.paths[0], domain: options.domains[0], tool: options.tools[0], timeoutMs: options.timeoutMs }, deps.mcpExecutor, deps);
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
  if (area === "memory" && action === "revoke") return revokeMemory(options);
  if (area === "memory" && action === "supersede") return supersedeMemory(options);
  if (area === "memory" && action === "health") return inspectMemoryHealth(options);
  if (area === "memory" && action === "capabilities") return withMemoryStore(options, (store) => store.capabilities());
  if (area === "memory" && action === "eval") return evaluateMemoryFixture(options);
  if (area === "memory" && action === "candidates") return listTeamMemoryCandidates(options);
  if (area === "memory" && action === "candidate-review") return reviewTeamMemoryCandidate(options);
  if (area === "memory" && action === "promote") return promoteTeamMemoryCandidate(options);
  if (area === "memory" && action === "migrate") return migrateLegacyMemory(options);
  if (area === "memory" && action === "rollback") return rollbackMemoryMigration(options);
  if (area === "memory" && action === "export") {
    if (!options.output) throw new Error("memory export requires --output");
    const { artifact: output, relative } = resolveMemoryArtifactPath(options, options.output, "memory export output");
    const content = withMemoryStore(options, (store) => store.exportEntries(options));
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content, { mode: 0o600 });
    return { schema_version: 1, status: "EXPORTED", output: relative.replaceAll("\\", "/"), sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  if (area === "memory" && action === "import") {
    if (!options.input) throw new Error("memory import requires --input");
    const { artifact: input } = resolveMemoryArtifactPath(options, options.input, "memory import input", { mustExist: true });
    const entries = fs.readFileSync(input, "utf8").split("\n").filter(Boolean).map((line) => validateMemoryEntry(JSON.parse(line)));
    return withMemoryStore(options, (store) => store.importEntries(entries, { apply: options.apply, actor: options.actorId }));
  }
  if (area === "memory" && ["pack-export", "pack-import"].includes(action)) {
    const envName = options.signingSecretEnv; if (!envName || !process.env[envName]) throw new Error("signed memory packs require --signing-secret-env naming a populated environment variable");
    if (action === "pack-export") {
      if (!options.output) throw new Error("memory pack export requires --output");
      const pack = withMemoryStore(options, (store) => createMemoryPack(store, { ...options, signingSecret: process.env[envName], repositoryIdentity: resolveRepositoryIdentity(options) }));
      const { artifact: output, relative } = resolveMemoryArtifactPath(options, options.output, "memory pack output");
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(pack, null, 2)}\n`, { mode: 0o600 });
      return { schema_version: 1, status: "EXPORTED", output: relative.replaceAll("\\", "/"), entries_hash: pack.entries_hash, key_id: pack.key_id };
    }
    if (!options.input) throw new Error("memory pack import requires --input");
    const { artifact: input } = resolveMemoryArtifactPath(options, options.input, "memory pack input", { mustExist: true });
    const pack = JSON.parse(fs.readFileSync(input, "utf8"));
    return withMemoryStore(options, (store) => importMemoryPack(store, pack, { ...options, signingSecret: process.env[envName], repositoryIdentity: resolveRepositoryIdentity(options), actor: options.actorId }));
  }
  if (area === "eval" && action === "score") return scoreTask(options);
  throw new Error(`Unknown runtime command: ${area} ${action ?? ""}`.trim());
}

function resultExitCode(result) {
  if (!result || typeof result !== "object") return 0;
  if (result.decision && result.decision !== "allow") return 1;
  const rejected = new Set(["DENY", "ASK", "FAILED", "REJECTED", "STALE", "NOT_READY", "NOT_RUN", "BLOCKED", "DEGRADED", "UNAVAILABLE", "INSUFFICIENT_EVIDENCE", "PARTIAL"]);
  if (rejected.has(String(result.status ?? "").toUpperCase())) return 1;
  if (rejected.has(String(result.readiness?.status ?? "").toUpperCase())) return 1;
  if (rejected.has(String(result.production_readiness?.status ?? "").toUpperCase())) return 1;
  if (rejected.has(String(result.orchestration?.status ?? "").toUpperCase())) return 1;
  return 0;
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

export function parsePolicyArgs(argv) {
  const action = argv[0];
  if (!new Set(["init", "keygen", "sign", "verify", "resolve", "diff", "simulate"]).has(action)) throw new Error("policy requires init, keygen, sign, verify, resolve, diff, or simulate");
  const options = { target: process.cwd() };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") { options.apply = true; continue; }
    if (!new Set(["--target", "--task-bundle", "--layer", "--id", "--version", "--compatibility", "--output", "--key-id", "--bundle", "--private-key", "--tool", "--path", "--domain", "--command"]).has(flag)) throw new Error(`Unknown policy option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return { action, options };
}

export function parseFailureArgs(argv) {
  const action = argv[0];
  if (!new Set(["plan", "run"]).has(action)) throw new Error("failure requires plan or run");
  const options = { target: process.cwd(), apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") { options.apply = true; continue; }
    if (!new Set(["--target", "--manifest", "--output", "--timeout-ms"]).has(flag)) throw new Error(`Unknown failure option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = flag === "--timeout-ms" ? Number(value) : value;
  }
  if (!options.manifest) throw new Error("failure command requires --manifest");
  if (action === "plan" && options.apply) throw new Error("failure plan is read-only");
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 600000)) throw new Error("failure timeout must be 100-600000ms");
  return { action, options };
}

export function parsePassportArgs(argv) {
  const action = argv[0];
  if (!new Set(["keygen", "issue", "verify"]).has(action)) throw new Error("passport requires keygen, issue, or verify");
  const options = { target: process.cwd(), apply: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") { options.apply = true; continue; }
    if (!new Set(["--target", "--id", "--key-id", "--private-key", "--failure-report", "--pulse-result", "--output", "--file"]).has(flag)) throw new Error(`Unknown passport option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (action === "keygen" && !options.keyId) throw new Error("passport keygen requires --key-id");
  if (action === "issue" && (!options.id || !options.keyId || !options.privateKey)) throw new Error("passport issue requires --id, --key-id, and --private-key");
  if (action === "verify" && !options.file) throw new Error("passport verify requires --file");
  return { action, options };
}

export function parseProofArgs(argv, { demo = false } = {}) {
  const options = { target: process.cwd(), otlp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--otlp") { options.otlp = true; continue; }
    if (!new Set(["--target", "--id", "--output"]).has(flag)) throw new Error(`Unknown proof option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  if (!demo && !options.id) throw new Error("proof requires --id");
  return options;
}

export function parseAnalyticsArgs(argv) {
  const action = argv[0];
  if (!new Set(["record", "summary", "compare"]).has(action)) throw new Error("analytics requires record, summary, or compare");
  const options = { target: process.cwd() };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!new Set(["--target", "--id", "--event", "--baseline", "--current"]).has(flag)) throw new Error(`Unknown analytics option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (action === "record" && (!options.id || !options.event)) throw new Error("analytics record requires --id and --event");
  if (action === "compare" && (!options.baseline || !options.current)) throw new Error("analytics compare requires --baseline and --current");
  return { action, options };
}

export function parseArchitectureArgs(argv) {
  const action = argv[0];
  const actions = new Set(["quick", "start", "status", "validate", "model", "pricing", "benchmark-plan", "benchmark-import", "build", "verify", "diff", "eval"]);
  if (!actions.has(action)) throw new Error(`architecture requires one of: ${[...actions].join(", ")}`);
  const options = { target: process.cwd(), refresh: false };
  const valueFlags = new Set(["--target", "--file", "--request", "--output", "--before", "--after", "--fixture", "--goal", "--id", "--stage", "--provider", "--region", "--service", "--sku", "--currency", "--api-key-env", "--pricing-snapshot", "--pricing-item", "--monthly-quantity", "--timeout-ms", "--ttl-hours", "--tested-safe-rps", "--headroom-factor", "--zone-reserve-factor", "--retention-days", "--average-rps", "--peak-rps", "--concurrent-users", "--open-connections", "--service-time-ms", "--latency-ms", "--availability", "--budget"]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--refresh") { options.refresh = true; continue; }
    if (!valueFlags.has(flag)) throw new Error(`Unknown architecture option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }
  const required = { quick: ["goal"], start: ["goal"], status: [], validate: ["file"], model: ["file"], pricing: ["provider", "region", "service"], "benchmark-plan": ["file"], "benchmark-import": ["file", "request"], build: ["file"], verify: ["file"], diff: ["before", "after"], eval: ["fixture"] }[action];
  for (const key of required) if (!options[key]) throw new Error(`architecture ${action} requires --${key}`);
  for (const key of ["pricingItem", "monthlyQuantity", "timeoutMs", "ttlHours", "testedSafeRps", "headroomFactor", "zoneReserveFactor", "retentionDays", "averageRps", "peakRps", "concurrentUsers", "openConnections", "serviceTimeMs", "latencyMs", "availability", "budget"]) if (options[key] != null) { const value = Number(options[key]); if (!Number.isFinite(value) || value < 0) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be a finite non-negative number`); options[key] = value; }
  if (options.apiKeyEnv && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(options.apiKeyEnv)) throw new Error("--api-key-env must name a safe uppercase environment variable");
  return { action, options };
}

export function parsePulseArgs(argv) {
  const primary = argv[0];
  let action = primary;
  let start = 1;
  if (primary === "baseline") {
    const secondary = argv[1];
    if (!new Set(["create", "verify", "inspect", "migrate"]).has(secondary)) throw new Error("pulse baseline requires create, verify, inspect, or migrate");
    action = `baseline-${secondary}`;
    start = 2;
  } else if (primary === "policy") {
    if (argv[1] !== "validate") throw new Error("pulse policy requires validate");
    action = "policy-validate";
    start = 2;
  } else if (primary === "trend") {
    const secondary = argv[1];
    if (!new Set(["record", "show"]).has(secondary)) throw new Error("pulse trend requires record or show");
    action = `trend-${secondary}`;
    start = 2;
  }
  if (!new Set(["scan", "check", "diff", "doctor", "sarif", "explain", "policy-validate", "trend-record", "trend-show", "baseline-create", "baseline-verify", "baseline-inspect", "baseline-migrate"]).has(action)) throw new Error("pulse action is invalid");
  const options = { target: process.cwd(), format: "json", current: true };
  const valueFlags = new Set(["--target", "--config", "--output", "--baseline", "--name", "--format", "--file", "--history", "--base", "--head", "--task-id", "--plan-id", "--approval-reference"]);
  for (let index = start; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") { options.format = "json"; continue; }
    if (flag === "--no-current") { options.current = false; continue; }
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if (!valueFlags.has(flag)) throw new Error(`Unknown pulse option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!new Set(["json", "text"]).has(options.format)) throw new Error("pulse --format must be text or json");
  if (action === "explain" && !options.file) throw new Error("pulse explain requires --file");
  if (action === "diff" && !options.base) throw new Error("pulse diff requires --base");
  if (action === "sarif" && !options.file) throw new Error("pulse sarif requires --file");
  if (action === "trend-record" && !options.file) throw new Error("pulse trend record requires --file");
  if (action === "baseline-migrate" && !options.dryRun) throw new Error("pulse baseline migrate requires --dry-run");
  return { action, options };
}

export function parseTeamArgs(argv) {
  const action = argv[0];
  if (!new Set(["plan", "start", "next", "dispatch", "heartbeat", "ingest", "approve", "cancel", "resume", "recover", "watch", "demo", "conformance-template", "conformance", "benchmark-template", "benchmark", "capabilities", "status", "context", "claim", "handoff", "conflict", "decide", "record", "report", "eval"]).has(action)) throw new Error("team action is invalid");
  const options = { target: process.cwd(), paths: [], handoffHashes: [] };
  const flags = new Set(["--id", "--target", "--fixture", "--file", "--result-file", "--capabilities-file", "--output", "--approval-hash", "--goal", "--shape", "--risk", "--adapter", "--assignment", "--agent", "--external-run-id", "--reviewed-orphaned-writer", "--claim", "--conflict", "--selected-handoff", "--reason", "--decided-by", "--summary", "--expected-revision", "--lease-seconds", "--status", "--evidence-hash", "--handoff-hash", "--finding-count", "--tokens", "--actions", "--duration-seconds", "--max-agents", "--max-concurrency", "--token-budget", "--timeout-seconds", "--max-actions", "--path"]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]; if (!flags.has(flag)) throw new Error(`Unknown team option: ${flag}`);
    const value = argv[++index]; if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--path") options.paths.push(value);
    else if (flag === "--handoff-hash" && action === "conflict") options.handoffHashes.push(value);
    else if (flag === "--result-file") options.file = value;
    else options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (action === "eval" && !options.fixture) throw new Error("team eval requires --fixture");
  if (action === "benchmark" && !options.fixture) throw new Error("team benchmark requires --fixture");
  if (action === "conformance" && !options.file) throw new Error("team conformance requires --file");
  if (action === "conformance-template" && !options.adapter) throw new Error("team conformance-template requires --adapter");
  if (!["eval", "capabilities", "demo", "conformance-template", "conformance", "benchmark-template", "benchmark"].includes(action) && !options.id) throw new Error(`team ${action} requires --id`);
  if (action === "start" && !options.adapter) throw new Error("team start requires --adapter");
  if (action === "dispatch" && (!options.assignment || !options.agent)) throw new Error("team dispatch requires --assignment and --agent");
  if (action === "heartbeat" && !options.assignment) throw new Error("team heartbeat requires --assignment");
  if (action === "ingest" && (!options.assignment || !options.file)) throw new Error("team ingest requires --assignment and --result-file");
  if (action === "approve" && !options.approvalHash) throw new Error("team approve requires --approval-hash");
  if (action === "claim" && (!options.assignment || !options.agent || options.expectedRevision == null)) throw new Error("team claim requires --assignment, --agent, and --expected-revision");
  if (action === "handoff" && (!options.claim || !options.agent || !options.file || options.expectedRevision == null)) throw new Error("team handoff requires --claim, --agent, --file, and --expected-revision");
  if (action === "conflict" && (options.handoffHashes.length < 2 || !options.summary || options.expectedRevision == null)) throw new Error("team conflict requires two --handoff-hash values, --summary, and --expected-revision");
  if (action === "decide" && (!options.conflict || !options.selectedHandoff || !options.reason || !options.decidedBy || options.expectedRevision == null)) throw new Error("team decide requires --conflict, --selected-handoff, --reason, --decided-by, and --expected-revision");
  if (action === "record" && (!options.assignment || !options.status || options.tokens == null || options.actions == null || options.durationSeconds == null || (!["TIMED_OUT", "CANCELLED", "ORPHANED"].includes(options.status) && !options.handoffHash))) throw new Error("team record requires assignment, status, usage, and a handoff hash unless timed out, cancelled, or orphaned");
  for (const key of ["expectedRevision", "leaseSeconds", "findingCount", "tokens", "actions", "durationSeconds", "maxAgents", "maxConcurrency", "tokenBudget", "timeoutSeconds", "maxActions"]) if (options[key] != null) { const value = Number(options[key]); if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`); options[key] = value; }
  return { action, options };
}

function currentCommit(target, deps = {}) {
  const result = (deps.spawnSync ?? spawnSync)("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function runArchitecture(action, options, deps = {}) {
  const root = path.resolve(options.target);
  const read = (file, label) => readSystemDesignJson(root, file, label);
  if (["quick", "start"].includes(action)) { const result = buildQuickArchitectureRequest(options); return action === "start" ? writeArchitectureRequest({ result, target: root, output: options.output }) : result; }
  if (action === "status") return inspectArchitectureWorkspace({ target: root, repositoryCommit: currentCommit(root, deps) });
  if (action === "validate") return validateSystemDesignRequest(read(options.file, "system-design request"));
  if (action === "model") { let request = read(options.file, "system-design request"); if (options.pricingSnapshot) request = applyPricingSnapshot(request, read(options.pricingSnapshot, "pricing snapshot"), { itemIndex: options.pricingItem ?? 0, monthlyQuantity: options.monthlyQuantity }); return calculateSystemDesignModel(request, { tested_safe_rps_per_replica: options.testedSafeRps, headroom_factor: options.headroomFactor, zone_failure_reserve_factor: options.zoneReserveFactor, retention_days: options.retentionDays }); }
  if (action === "pricing") return lookupArchitecturePricing({ ...options, apiKey: options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined }, deps);
  if (action === "benchmark-plan") return buildBenchmarkPlan(read(options.file, "system-design request"));
  if (action === "benchmark-import") return importBenchmarkResult(read(options.file, "benchmark result"), read(options.request, "system-design request"));
  if (action === "build") { const artifact = buildArchitectureArtifact(read(options.file, "architecture design"), { repositoryCommit: currentCommit(root, deps) }); return writeArchitecturePack({ artifact, target: root, output: options.output }); }
  if (action === "verify") return verifyArchitectureArtifact(read(options.file, "architecture artifact"), { repositoryCommit: currentCommit(root, deps) });
  if (action === "diff") return diffArchitectureArtifacts(read(options.before, "before architecture"), read(options.after, "after architecture"));
  return evaluateSystemDesignFixture(read(options.fixture, "system-design fixture"));
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
  if (command === "adapter") {
    const { action, options } = parseAdapterArgs(argv.slice(1));
    const registry = loadAdapterRegistry();
    const result = action === "list"
      ? { schema_version: 1, sdk_version: registry.sdk_version, adapters: registry.adapters.map(({ id, label }) => ({ id, label })) }
      : action === "matrix"
        ? capabilityMatrix(registry)
        : action === "inspect"
          ? registry.adapters.find((adapter) => adapter.id === options.adapter)
          : evaluateAdapterConformance({ adapterId: options.adapter, root: path.resolve(options.target), registry });
    io.log(JSON.stringify(result, null, 2));
    return result.status === "FAILED" ? 1 : 0;
  }
  if (command === "standards") {
    const options = parseStandardsArgs(argv.slice(1));
    const result = evaluateStandardsConformance(options.root ? { root: options.root } : {});
    io.log(JSON.stringify(result, null, 2));
    return result.status === "FAILED" ? 1 : 0;
  }
  if (command === "skills") {
    const { action, options } = parseSkillRoutingArgs(argv.slice(1));
    const config = loadSkillRoutingConfig(options.config);
    const fixture = options.fixture ? loadSkillRoutingFixture(options.fixture) : null;
    const result = action === "route"
      ? routeSkill({ config, hint: options.hint })
      : action === "eval"
        ? evaluateSkillRouting({ config, fixture, skillsRoot: options.skillsRoot })
        : verifySkillRouting({ config, fixture, skillsRoot: options.skillsRoot });
    io.log(JSON.stringify(result, null, 2));
    return ["FAILED", "ABSTAIN"].includes(result.status) ? 1 : 0;
  }
  if (command === "eval") {
    const { action, options } = parseEvalArgs(argv.slice(1));
    const result = action === "replay" ? replayEvalFixture(options)
      : action === "compare" ? compareEvalResults(options)
        : action === "gate" ? gateEvalResults(options)
          : action === "review-compare" ? compareReviewQuality(options)
            : scoreReviewQuality(options);
    io.log(JSON.stringify(result, null, 2));
    return resultExitCode(result);
  }
  if (command === "evidence") {
    const options = parsePrEvidenceArgs(argv.slice(1));
    const pkg = assertPrEvidenceScope(buildPrEvidencePackage(options, deps));
    io.log(options.format === "json" ? JSON.stringify(pkg, null, 2) : renderPrEvidenceMarkdown(pkg));
    return 0;
  }
  if (command === "policy") {
    const { action, options } = parsePolicyArgs(argv.slice(1));
    const result = action === "simulate" ? simulateAction(options)
      : action === "init" ? initializePolicyBundle(options)
      : action === "keygen" ? generatePolicyKey(options)
        : action === "sign" ? signPolicyFile(options)
          : action === "verify" ? verifyPolicyFile({ ...options, kitVersion: getPackageVersion() })
            : loadRepositoryPolicyOverlays({ ...options, kitVersion: getPackageVersion() });
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (command === "failure") {
    const { action, options } = parseFailureArgs(argv.slice(1));
    const result = action === "plan" ? planFailureLab(options) : runFailureLab(options, deps);
    io.log(JSON.stringify(action === "run" && options.output ? writeFailureReport({ report: result, ...options }) : result, null, 2));
    return result.status === "FAILED" ? 1 : 0;
  }
  if (command === "passport") {
    const { action, options } = parsePassportArgs(argv.slice(1));
    const result = action === "keygen" ? generatePassportKey(options) : action === "issue" ? issueChangePassport(options, deps) : verifyChangePassport(options);
    io.log(JSON.stringify(result, null, 2));
    return result.status === "REJECTED" || result.status === "VALID_UNTRUSTED" || result.status === "STALE" ? 1 : 0;
  }
  if (command === "proof") {
    const options = parseProofArgs(argv.slice(1));
    const proof = buildProofReplay(options, deps);
    io.log(JSON.stringify(writeProofArtifacts({ ...options, proof }), null, 2));
    return proof.readiness.status === "READY" ? 0 : 1;
  }
  if (command === "demo") {
    const options = parseProofArgs(argv.slice(1), { demo: true });
    io.log(JSON.stringify(writeProofArtifacts({ ...options, proof: demoProof(), output: options.output ?? ".ai-agent-kit/demo" }), null, 2));
    return 0;
  }
  if (command === "tracelab") {
    const action = argv[1];
    if (!new Set(["list", "run"]).has(action)) throw new Error("tracelab requires list or run");
    if (action === "list") { io.log(JSON.stringify({ schema_version: 1, scenarios: listTraceLabScenarios() }, null, 2)); return 0; }
    const { options } = parseGovernedFeatureArgs(argv.slice(1), ["run"], ["--target", "--scenario", "--output"]);
    const result = writeTraceLab(options);
    io.log(JSON.stringify(result, null, 2));
    return result.status === "RECOVERED" ? 0 : 1;
  }
  if (command === "why") {
    const args = argv.slice(1);
    const options = { target: process.cwd(), query: null, decisionId: null };
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index];
      if (value === "--target") options.target = args[++index];
      else if (value === "--decision") options.decisionId = args[++index];
      else if (!value.startsWith("-") && !options.query) options.query = value;
      else throw new Error(`Unknown why option: ${value}`);
    }
    if (!options.query && !options.decisionId) throw new Error("why requires a file:line, artifact, or --decision id");
    const result = explainWhy(options);
    io.log(JSON.stringify(result, null, 2));
    return result.status === "EXPLAINED" ? 0 : 1;
  }
  if (command === "decision") {
    const { action, options: raw } = parseDecisionArgs(argv.slice(1));
    const decisionIds = raw.decision_id ?? [];
    if (decisionIds.length > 1) throw new Error("decision command accepts exactly one --decision-id");
    const options = { ...raw, decisionId: decisionIds[0], eventId: raw.event_id, taskId: raw.task_id, runId: raw.run_id, alternatives: raw.alternative, assumptions: raw.assumption, approvalRef: raw.approval_ref, artifacts: raw.artifact, supersededBy: raw.superseded_by };
    const result = action === "list" ? inspectDecisionChronicle(options)
      : action === "inspect" ? resolveDecision(options)
        : recordDecision({ ...options, action: action === "record" ? "propose" : raw.action });
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (command === "run") {
    const { action, options: raw } = parseRunArgs(argv.slice(1));
    const options = { ...raw, runId: raw.run_id, eventId: raw.event_id, taskId: raw.task_id, approvalRef: raw.approval_ref, decisionIds: raw.decision_id, contextHashes: raw.context_hash, pluginReceiptHashes: raw.plugin_receipt_hash, checkRefs: raw.check_ref, findingRefs: raw.finding_ref, blockers: raw.blocker, nextAction: raw.next_action, failedAttempts: raw.failed_attempt, notTried: raw.not_tried };
    const result = action === "record" ? recordRunEvent(options)
      : action === "inspect" ? inspectRun(options)
        : action === "recovery" ? buildRecoveryPlan(options)
          : action === "resume" ? resumeRun({ ...options, apply: raw.apply })
          : action === "export" ? exportRunBundle(options)
            : action === "verify" ? inspectRunBundle(options)
              : buildOtelTrace(options);
    io.log(JSON.stringify(result, null, 2));
    return ["BLOCKED", "REJECTED", "STALE"].includes(result.status) ? 1 : 0;
  }
  if (command === "plugin") {
    const { action, options: raw } = parsePluginArgs(argv.slice(1));
    const options = { ...raw, approvalRef: raw.approval_ref, pluginId: raw.plugin_id, taskId: raw.task_id, runId: raw.run_id, capabilityToken: raw.capability_token, requested: permissionObject(raw.requested, "--requested") };
    const result = action === "init" ? initializePlugin({ ...options, apply: raw.apply })
      : action === "inspect" ? inspectPluginManifest(options)
      : action === "plan" ? planPluginLifecycle(options)
        : action === "apply" ? applyPluginLifecycle({ ...options, apply: true })
          : action === "authorize" ? authorizePluginInvocation(options)
            : pluginTrustCenter(options);
    io.log(JSON.stringify(result, null, 2));
    return ["BLOCKED", "DENIED", "QUARANTINED", "ATTENTION"].includes(result.status) ? 1 : 0;
  }
  if (command === "benchmark") {
    const { action, options } = parseGovernedFeatureArgs(argv.slice(1), ["reliability"], ["--target", "--fixture"]);
    const fixturePath = path.resolve(options.target, options.fixture ?? "");
    const relative = path.relative(path.resolve(options.target), fixturePath);
    if (!options.fixture || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("benchmark fixture must remain inside the repository");
    const stat = fs.lstatSync(fixturePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error("benchmark fixture must be a bounded regular file");
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const result = evaluateReliabilityBenchmark(fixture);
    io.log(JSON.stringify(result, null, 2));
    return result.status === "MEASURED" ? 0 : 1;
  }
  if (command === "learning") {
    const { action, options: raw } = parseGovernedFeatureArgs(argv.slice(1), ["propose"], ["--target", "--candidate-id", "--kind", "--scope", "--reason", "--run-id", "--timestamp"]);
    const runIds = [];
    for (let index = 1; index < argv.length; index += 1) if (argv[index] === "--run-id") runIds.push(argv[index + 1]);
    const result = proposeCapabilityImprovement({ ...raw, candidateId: raw.candidate_id, runIds });
    io.log(JSON.stringify(result, null, 2));
    return result.status === "REVIEW_REQUIRED" ? 0 : 1;
  }
  if (command === "control") {
    const { action, options } = parseGovernedFeatureArgs(argv.slice(1), ["view"], ["--target", "--output"]);
    const result = writeOperatorView(options);
    io.log(JSON.stringify(result, null, 2));
    return result.status === "HEALTHY" ? 0 : 1;
  }
  if (command === "analytics") {
    const { action, options } = parseAnalyticsArgs(argv.slice(1));
    const result = action === "record"
      ? recordOutcome({ target: options.target, taskId: options.id, event: JSON.parse(fs.readFileSync(options.event, "utf8")) })
      : action === "summary"
        ? summarizeOutcomes(options)
        : compareOutcomes({ baseline: JSON.parse(fs.readFileSync(options.baseline, "utf8")), current: JSON.parse(fs.readFileSync(options.current, "utf8")) });
    io.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (command === "architecture") {
    const { action, options } = parseArchitectureArgs(argv.slice(1));
    const result = await runArchitecture(action, options, deps);
    io.log(JSON.stringify(result, null, 2));
    return ["FAILED", "REJECTED", "STALE", "CONSTRAINTS_CONFLICT"].includes(result.status) ? 1 : 0;
  }
  if (command === "pulse") {
    const { action, options } = parsePulseArgs(argv.slice(1));
    if (action === "explain") {
      io.log(renderPulseSummary(readPulseDocument(options)));
      return 0;
    }
    if (action === "doctor") {
      const result = architecturePulseDoctor(options);
      io.log(JSON.stringify(result, null, 2));
      return result.status === "READY" ? 0 : 3;
    }
    if (action === "policy-validate") {
      io.log(JSON.stringify(validateArchitecturePulsePolicy(options), null, 2));
      return 0;
    }
    if (action === "baseline-inspect") {
      const result = inspectArchitecturePulseBaseline(options);
      io.log(JSON.stringify(result, null, 2));
      return ["VERIFIED", "STALE"].includes(result.status) ? 0 : 3;
    }
    if (action === "baseline-migrate") {
      const result = migrateArchitecturePulseBaseline(options);
      io.log(JSON.stringify(result, null, 2));
      return result.status === "REBASELINE_REQUIRED" ? 3 : 0;
    }
    if (action === "sarif") {
      const result = writeArchitecturePulseSarif(readPulseDocument(options), options);
      io.log(JSON.stringify(result, null, 2));
      return 0;
    }
    if (action === "trend-record") {
      const result = recordPulseTrend(readPulseDocument(options), { ...options, file: options.history });
      io.log(JSON.stringify(result, null, 2));
      return 0;
    }
    if (action === "trend-show") {
      const result = readPulseTrend({ ...options, file: options.history });
      io.log(JSON.stringify(result, null, 2));
      return 0;
    }
    const configObject = readPulseConfig(options);
    if (action === "diff") {
      const result = diffArchitecturePulse({ ...options, configObject });
      const artifact = options.output ? writePulseDocument(result, options, ".ai-agent-kit/pulse/results/diff.json") : null;
      io.log(options.format === "text" ? `${renderPulseSummary(result)}${artifact ? `\nArtifact: ${artifact}` : ""}` : JSON.stringify(artifact ? { ...result, artifact } : result, null, 2));
      return result.confidence?.band === "LOW" ? 3 : 0;
    }
    if (action === "scan") {
      const result = analyzeArchitecturePulse({ ...options, configObject });
      const artifact = options.output || options.taskId ? writePulseResult(result, { ...options, output: options.output ?? `.ai-agent-kit/pulse/tasks/${options.taskId}.json` }) : null;
      io.log(options.format === "text" ? `${renderPulseSummary(result)}${artifact ? `\nArtifact: ${artifact}` : ""}` : JSON.stringify(artifact ? { ...result, artifact } : result, null, 2));
      return result.analysis_status === "DEGRADED" ? 3 : 0;
    }
    if (action === "baseline-create") {
      const created = createArchitecturePulseBaseline({ ...options, configObject });
      if (!created.artifact) {
        const result = { status: "DEGRADED", reason_codes: created.result.reason_codes, current_result_digest: created.result.result_digest, confidence: created.result.confidence };
        io.log(options.format === "text" ? `${renderPulseSummary(created.result)}\nBaseline was not created from degraded evidence.` : JSON.stringify(result, null, 2));
        return 3;
      }
      const result = { status: created.artifact.status, baseline: created.artifact.baseline, integrity: created.artifact.integrity, current_result_digest: created.result.result_digest, source_digest: created.result.inventory.source_digest, confidence: created.result.confidence };
      io.log(options.format === "text" ? `Architecture Pulse baseline created: ${result.baseline}\nEvidence: ${result.integrity.digest}` : JSON.stringify(result, null, 2));
      return created.result.analysis_status === "DEGRADED" ? 3 : 0;
    }
    if (action === "baseline-verify") {
      const result = verifyArchitecturePulseBaseline({ ...options, configObject });
      io.log(options.format === "text" ? `Architecture Pulse baseline: ${result.status}\n${result.reason}\nBaseline: ${result.baseline}` : JSON.stringify(result, null, 2));
      return result.status === "VERIFIED" ? 0 : 3;
    }
    const result = checkArchitecturePulse({ ...options, configObject });
    const artifact = options.output || options.taskId ? writePulseDocument(result, { ...options, output: options.output ?? `.ai-agent-kit/pulse/tasks/${options.taskId}.json` }, ".ai-agent-kit/pulse/results/comparison.json") : null;
    io.log(options.format === "text" ? `${renderPulseSummary(result)}${artifact ? `\nArtifact: ${artifact}` : ""}` : JSON.stringify(artifact ? { ...result, artifact } : result, null, 2));
    return pulseExitCode(result);
  }
  if (command === "team") {
    const { action, options } = parseTeamArgs(argv.slice(1));
    let result;
    if (action === "plan") result = planTeam(options);
    else if (action === "start") result = startTeam({ ...options, capabilities: options.capabilitiesFile ? readSystemDesignJson(options.target, options.capabilitiesFile, "team adapter capabilities") : null });
    else if (action === "next") result = nextTeamWave(options);
    else if (action === "dispatch") result = dispatchTeamAssignment(options, deps);
    else if (action === "heartbeat") result = heartbeatTeamAssignment(options);
    else if (action === "ingest") result = ingestTeamResult({ ...options, result: readSystemDesignJson(options.target, options.file, "team result") }, deps);
    else if (action === "approve") result = approveTeamRun(options);
    else if (action === "cancel") result = cancelTeamRun(options, deps);
    else if (action === "resume") result = resumeTeamRun(options);
    else if (action === "recover") result = recoverTeamRun(options);
    else if (action === "watch") result = options.output ? writeTeamTimeline({ ...options, timeline: buildTeamTimeline(options) }) : buildTeamTimeline(options);
    else if (action === "demo") result = runTeamDemo(options);
    else if (action === "conformance-template") result = buildTeamConformanceTemplate(options);
    else if (action === "conformance") result = verifyTeamConformance(readSystemDesignJson(options.target, options.file, "team conformance attestation"), options);
    else if (action === "benchmark-template") result = buildTeamBenchmarkTemplate();
    else if (action === "benchmark") result = evaluateTeamBenchmark(readSystemDesignJson(options.target, options.fixture, "team benchmark fixture"));
    else if (action === "capabilities") result = { schema_version: 1, adapters: listExecutionAdapters() };
    else if (action === "status") result = inspectTeam(options);
    else if (action === "context") result = teamContextSummary(options);
    else if (action === "claim") result = claimTeamWork(options);
    else if (action === "handoff") result = publishTeamHandoff({ ...options, payload: readSystemDesignJson(options.target, options.file, "team handoff") });
    else if (action === "conflict") result = recordTeamConflict(options);
    else if (action === "decide") result = decideTeamConflict(options);
    else if (action === "record") result = recordTeamResult(options);
    else if (action === "eval") result = evaluateTeamCases(readSystemDesignJson(options.target, options.fixture, "team eval fixture"));
    else result = reportTeam(options);
    io.log(JSON.stringify(result, null, 2));
    return ["NOT_READY", "FAILED", "NOT_RUN", "INSUFFICIENT_EVIDENCE", "PARTIAL"].includes(result.status) || result.state === "BLOCKED" ? 1 : 0;
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
    const meta = {};
    const result = runRuntime(argv.slice(1), deps, meta);
    io.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    return meta.exitCode ?? resultExitCode(result);
  }
  if (command !== "bootstrap") {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = parseBootstrapArgs(argv.slice(1));
  return bootstrap(options, { io, ...deps });
}
