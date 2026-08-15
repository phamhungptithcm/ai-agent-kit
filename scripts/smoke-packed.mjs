import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspace = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-packed-"));
const packageData = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function execute(command, args, cwd, options = {}) {
  const spawnArgs = process.platform === "win32"
    ? args.map((argument) => `"${argument.replaceAll('"', '\\"')}"`)
    : args;
  const result = spawnSync(command, spawnArgs, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      npm_config_cache: path.join(temporaryRoot, "npm-cache"),
      npm_config_logs_dir: path.join(temporaryRoot, "npm-logs"),
      ...(options.env ?? {})
    }
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error?.message || "unknown error"}`
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

try {
  const packOutput = execute(npmCommand, ["pack", "--json", "--pack-destination", temporaryRoot], workspace).stdout;
  const jsonStart = Math.max(0, packOutput.lastIndexOf("\n[") + 1);
  const packResult = JSON.parse(packOutput.slice(jsonStart));
  const packedPaths = packResult[0].files.map((entry) => entry.path);
  const forbiddenPackageState = packedPaths.filter((entry) =>
    entry.includes("/.ai/local/")
    || entry.includes("/.codegraph/")
    || entry.includes("/.cocoindex_code/")
    || entry.includes("/__pycache__/")
    || entry.startsWith(".ai-agent-kit/")
    || entry.startsWith("docs/approvals/")
    || /\.py[co]$/.test(entry)
  );
  assert.deepEqual(forbiddenPackageState, [], `package contains local or generated state: ${forbiddenPackageState.join(", ")}`);
  const tarball = path.join(temporaryRoot, packResult[0].filename);
  const packedCliRoot = path.join(temporaryRoot, "packed-cli");
  fs.mkdirSync(packedCliRoot);
  execute("git", ["init"], packedCliRoot);
  fs.writeFileSync(path.join(packedCliRoot, "package.json"), `${JSON.stringify({ name: "packed-cli-runner", private: true })}\n`);
  execute(npmCommand, ["install", tarball], packedCliRoot);
  const packedCli = path.join(packedCliRoot, "node_modules", "@hunpeolabs", "ai-agent-kit", "dist", "bin", "ai-agent-kit.mjs");
  const executePacked = (args, cwd, options) => execute(process.execPath, [packedCli, ...args], cwd, options);
  const fixture = path.join(temporaryRoot, "fixture");
  fs.mkdirSync(fixture);
  execute("git", ["init"], fixture);

  const versionResult = executePacked(["--version"], fixture);
  const versionOutput = `${versionResult.stdout}${versionResult.stderr}`;
  assert.match(versionOutput, new RegExp(packageData.version.replaceAll(".", "\\.")));

  const activationResult = executePacked([], fixture);
  const activationOutput = `${activationResult.stdout}${activationResult.stderr}`;
  assert.match(activationOutput, /Choose how to import the kit into this project/);
  assert.match(activationOutput, /Interactive input is unavailable/);
  assert.equal(fs.existsSync(path.join(fixture, ".ai-agent-kit")), false);

  const dryRunResult = executePacked(
    ["bootstrap", "--dry-run"],
    fixture
  );
  const dryRunOutput = `${dryRunResult.stdout}${dryRunResult.stderr}`;
  assert.match(dryRunOutput, /AI Agent Kit Bootstrap: DRY RUN/);
  assert.equal(fs.existsSync(path.join(fixture, ".ai-agent-kit")), false);

  const runtimeCreate = executePacked(
    [
      "runtime", "task", "create",
      "--id", "SMOKE-001", "--goal", "Verify packaged runtime",
      "--acceptance", "Task state persists", "--approval-hash", "smoke-approval",
      "--tool", "read", "--path", "src/**"
    ],
    fixture
  );
  assert.match(runtimeCreate.stdout, /"state": "DISCOVER"/);
  const runtimeStatus = executePacked(
    ["runtime", "task", "status", "--id", "SMOKE-001"],
    fixture
  );
  assert.match(runtimeStatus.stdout, /"goal": "Verify packaged runtime"/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit", "runtime", "tasks", "SMOKE-001.json")));
  fs.writeFileSync(path.join(fixture, ".ai-agent-kit", "runtime", "smoke-evidence.txt"), "packed runtime evidence\n");

  const teamPlan = executePacked(["team", "plan", "--id", "SMOKE-001"], fixture);
  assert.match(teamPlan.stdout, /"team_type": "SOLO"/);
  const teamStart = executePacked(["team", "start", "--id", "SMOKE-001", "--adapter", "other"], fixture);
  assert.match(teamStart.stdout, /"execution_mode": "SERIAL_PERSONAS"/);
  const completeAssignment = (assignment, agent, evidenceHash) => {
    const context = JSON.parse(executePacked(["team", "context", "--id", "SMOKE-001"], fixture).stdout);
    const claim = JSON.parse(executePacked(["team", "claim", "--id", "SMOKE-001", "--assignment", assignment, "--agent", agent, "--expected-revision", String(context.revision)], fixture).stdout);
    const handoffFile = `.ai-agent-kit/runtime/${assignment}-handoff-input.json`;
    fs.writeFileSync(path.join(fixture, handoffFile), `${JSON.stringify({ brief_hash: context.brief_hash, facts: [`${assignment} completed`], evidence: [{ path: ".ai-agent-kit/runtime/smoke-evidence.txt", line_start: 1, line_end: 1 }], status: "COMPLETED" })}\n`);
    const handoff = JSON.parse(executePacked(["team", "handoff", "--id", "SMOKE-001", "--claim", claim.claim.claim_id, "--agent", agent, "--expected-revision", String(claim.revision), "--file", handoffFile], fixture).stdout);
    executePacked(["team", "record", "--id", "SMOKE-001", "--assignment", assignment, "--status", "COMPLETED", "--handoff-hash", handoff.handoff_hash, "--evidence-hash", evidenceHash, "--tokens", "100", "--actions", "1", "--duration-seconds", "10"], fixture);
  };
  completeAssignment("implementation-engineer", "smoke-implementer", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  completeAssignment("independent-reviewer", "smoke-reviewer", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const teamReport = executePacked(["team", "report", "--id", "SMOKE-001"], fixture);
  assert.match(teamReport.stdout, /"status": "READY"/);

  const simulation = executePacked(
    ["policy", "simulate", "--id", "SMOKE-001", "--tool", "read", "--path", "src/example.mjs"],
    fixture
  );
  assert.match(simulation.stdout, /"mode": "SIMULATION"/);
  assert.match(simulation.stdout, /"executed": false/);

  const evalResult = executePacked(
    ["eval", "replay", "--fixture", path.join(workspace, "test/fixtures/v070/eval-pass.json")],
    fixture
  );
  assert.match(evalResult.stdout, /"status": "PASSED"/);

  const systemDesignPrompt = executePacked(
    ["prompt", "design-system"],
    fixture
  );
  assert.match(systemDesignPrompt.stdout, /design-scalable-systems/);
  assert.match(systemDesignPrompt.stdout, /READY_FOR_REVIEW/);

  const demoResult = executePacked(
    ["demo", "--otlp"],
    fixture
  );
  assert.match(demoResult.stdout, /"status": "GENERATED"/);
  for (const relPath of ["index.html", "proof.json", "proof-card.md", "trust-badge.svg", "proof.otlp.json"]) {
    assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit", "demo", relPath)), `packed demo missing ${relPath}`);
  }

  execute("git", ["config", "user.email", "smoke@example.invalid"], fixture);
  execute("git", ["config", "user.name", "Smoke"], fixture);
  fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "src/smoke.mjs"), "export const smoke = 1;\n");
  execute("git", ["add", "src/smoke.mjs"], fixture);
  execute("git", ["commit", "-m", "smoke base"], fixture);
  const traceLab = executePacked(["tracelab", "run", "--scenario", "production-bug"], fixture);
  assert.match(traceLab.stdout, /"status": "RECOVERED"/);
  const pluginPreview = executePacked(["plugin", "init", "--plugin-id", "packed-review"], fixture);
  assert.match(pluginPreview.stdout, /"status": "PREVIEW"/);
  assert.equal(fs.existsSync(path.join(fixture, "plugins/packed-review")), false);
  const pluginCreated = executePacked(["plugin", "init", "--plugin-id", "packed-review", "--apply"], fixture);
  assert.match(pluginCreated.stdout, /"status": "CREATED"/);
  assert.ok(fs.existsSync(path.join(fixture, "plugins/packed-review/plugin.json")));
  execute("git", ["add", "plugins/packed-review"], fixture);
  execute("git", ["commit", "-m", "add packed plugin fixture"], fixture);
  executePacked(["decision", "record", "--decision-id", "PACKED-DEC", "--event-id", "packed-dec-1", "--actor", "smoke", "--question", "Why trace?", "--choice", "recoverable", "--rationale", "portable evidence", "--artifact", "src/smoke.mjs"], fixture);
  executePacked(["decision", "transition", "--decision-id", "PACKED-DEC", "--event-id", "packed-dec-2", "--action", "approve", "--actor", "smoke", "--rationale", "fixture approval"], fixture);
  executePacked(["run", "record", "--run-id", "PACKED-RUN", "--event-id", "packed-run-1", "--phase", "start", "--actor", "smoke", "--decision-id", "PACKED-DEC"], fixture);
  const why = executePacked(["why", "src/smoke.mjs"], fixture);
  assert.match(why.stdout, /"status": "EXPLAINED"/);
  executePacked(["run", "export", "--run-id", "PACKED-RUN", "--output", ".ai-agent-kit/exports/PACKED-RUN.aakrun"], fixture);
  const bundle = executePacked(["run", "verify", "--file", ".ai-agent-kit/exports/PACKED-RUN.aakrun"], fixture);
  assert.match(bundle.stdout, /"status": "VERIFIED"/);
  const control = executePacked(["control", "view"], fixture);
  assert.match(control.stdout, /"status": "HEALTHY"/);
  const pulseScan = executePacked(["pulse", "scan", "--task-id", "PULSE-SMOKE", "--format", "text"], fixture);
  assert.match(pulseScan.stdout, /Architecture Pulse: COMPLETE/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit/pulse/tasks/PULSE-SMOKE.json")));
  const pulseDoctor = executePacked(["pulse", "doctor"], fixture);
  assert.match(pulseDoctor.stdout, /"status": "READY"/);
  const pulseDiff = executePacked(["pulse", "diff", "--base", "HEAD", "--head", "working-tree", "--format", "text"], fixture);
  assert.match(pulseDiff.stdout, /Architecture Pulse diff/);
  const pulseSarif = executePacked(["pulse", "sarif", "--file", ".ai-agent-kit/pulse/tasks/PULSE-SMOKE.json", "--output", ".ai-agent-kit/pulse/results/packed.sarif"], fixture);
  assert.match(pulseSarif.stdout, /"status": "CREATED"/);
  const pulseTrend = executePacked(["pulse", "trend", "record", "--file", ".ai-agent-kit/pulse/tasks/PULSE-SMOKE.json"], fixture);
  assert.match(pulseTrend.stdout, /"status": "RECORDED"/);
  const localEnvironment = { CI: "false", GITHUB_ACTIONS: "false", GITLAB_CI: "false", BUILDKITE: "false", CIRCLECI: "false", JENKINS_URL: "false", TF_BUILD: "false" };
  const pulseBaseline = executePacked(["pulse", "baseline", "create", "--name", "packed"], fixture, { env: localEnvironment });
  assert.match(pulseBaseline.stdout, /"status": "CREATED"/);
  const pulseInspect = executePacked(["pulse", "baseline", "inspect", "--baseline", ".ai-agent-kit/pulse/baselines/packed.json"], fixture);
  assert.match(pulseInspect.stdout, /"status": "VERIFIED"/);
  const pulseVerify = executePacked(["pulse", "baseline", "verify", "--baseline", ".ai-agent-kit/pulse/baselines/packed.json"], fixture);
  assert.match(pulseVerify.stdout, /"status": "VERIFIED"/);
  const pulseCheck = executePacked(["pulse", "check", "--baseline", ".ai-agent-kit/pulse/baselines/packed.json", "--format", "text"], fixture);
  assert.match(pulseCheck.stdout, /Architecture Pulse comparison: STABLE/);
  executePacked(
    ["runtime", "task", "create", "--id", "MEM-SMOKE", "--goal", "Verify packed shared memory"],
    fixture
  );
  const memoryProposal = JSON.parse(executePacked(
    ["runtime", "memory", "propose", "--id", "MEM-SMOKE", "--title", "Packed memory rule", "--content", "Packed shared memory uses a transactional local store.", "--source", "src/smoke.mjs", "--created-by", "smoke-agent"],
    fixture
  ).stdout);
  assert.equal(memoryProposal.schema_version, 3);
  const memoryApproval = JSON.parse(executePacked(
    ["runtime", "memory", "approve", "--memory-id", memoryProposal.id, "--approver", "smoke-memory-owner", "--review-date", "2099-01-01"],
    fixture
  ).stdout);
  assert.equal(memoryApproval.status, "APPROVED");
  const memoryQuery = JSON.parse(executePacked(
    ["runtime", "memory", "query", "--query", "transactional", "--with-receipt", "--limit", "5", "--token-budget", "500"],
    fixture
  ).stdout);
  assert.equal(memoryQuery.entries.length, 1);
  assert.match(memoryQuery.receipt.audit_receipt_hash, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit/runtime/memory/memory.sqlite3")));
  const prTask = executePacked(
    ["runtime", "task", "create", "--id", "PR-SMOKE", "--goal", "Verify PR evidence", "--acceptance", "Scoped source changes", "--tool", "edit", "--path", "src/**"],
    fixture
  );
  assert.match(prTask.stdout, /"id": "PR-SMOKE"/);
  fs.writeFileSync(path.join(fixture, "src/smoke.mjs"), "export const smoke = 2;\n");
  const prEvidence = executePacked(
    ["evidence", "pr-package", "--id", "PR-SMOKE", "--format", "json"],
    fixture
  );
  assert.match(prEvidence.stdout, /"approval_to_diff"/);
  assert.match(prEvidence.stdout, /"status": "PASSED"/);

  const failureManifest = path.join(fixture, "failure-lab.json");
  fs.writeFileSync(failureManifest, JSON.stringify({ schema_version: 1, cases: [{ id: "network-timeout", command: ["npm", "test"], env: { FAILURE_MODE: "network_timeout" } }] }));
  const failurePlan = executePacked(["failure", "plan", "--manifest", "failure-lab.json"], fixture);
  assert.match(failurePlan.stdout, /"status": "PREVIEW"/);

  const passportKey = executePacked(["passport", "keygen", "--key-id", "smoke-maintainer"], fixture);
  assert.match(passportKey.stdout, /"status": "CREATED"/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit/local/passport-keys/smoke-maintainer.private.pem")));

  // The second installation verifies postinstall and installed asset fidelity.
  // Release the first isolated install and its generated fixture before creating
  // another native dependency tree so packed smoke remains viable on bounded CI
  // disks without weakening either installation path.
  fs.rmSync(path.join(packedCliRoot, "node_modules"), { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });

  const installFixture = path.join(temporaryRoot, "install-fixture");
  fs.mkdirSync(installFixture);
  execute("git", ["init"], installFixture);
  fs.writeFileSync(path.join(installFixture, "package.json"), `${JSON.stringify({
    name: "ai-agent-kit-install-fixture",
    private: true
  }, null, 2)}\n`);
  const installResult = execute(
    npmCommand,
    ["install", tarball, "--foreground-scripts"],
    installFixture
  );
  assert.match(`${installResult.stdout}${installResult.stderr}`, /governed kit imported successfully/);
  const installedContract = JSON.parse(
    fs.readFileSync(path.join(installFixture, ".ai-agent-kit", "installation.json"), "utf8")
  );
  assert.equal(installedContract.preset, "governed");
  assert.equal(installedContract.contractVersion, 3);
  assert.equal(Object.keys(installedContract.adapters).length, 12);
  assert.ok(Object.values(installedContract.adapters).every(Boolean));
  for (const relPath of [
    ".github/copilot-instructions.md",
    ".cursor/rules/ai-agent-kit.mdc",
    ".cursor/skills/start-task/SKILL.md",
    ".windsurf/skills/start-task/SKILL.md",
    "GEMINI.md",
    ".amazonq/rules/ai-agent-kit.md",
    ".junie/AGENTS.md",
    ".clinerules/ai-agent-kit.md",
    ".cline/skills/start-task/SKILL.md",
    "CONVENTIONS.md",
    ".aider.conf.yml",
    ".continue/rules/ai-agent-kit.md"
  ]) {
    assert.ok(fs.existsSync(path.join(installFixture, relPath)), `packed bootstrap missing ${relPath}`);
  }
  for (const relPath of [
    ".agents/skills/design-scalable-systems/SKILL.md",
    ".agents/skills/design-scalable-systems/references/capacity-and-latency.md",
    ".agents/skills/design-scalable-systems/references/workload-patterns.md",
    ".agents/skills/design-scalable-systems/references/security-control-matrix.md",
    ".agents/skills/design-scalable-systems/scripts/capacity_cost_model.py",
    ".ai/quality-profiles/system-design.yaml",
    ".ai/evals/system-design-cases.yaml",
    ".ai/core/traceable-plugin-runtime.md",
    ".ai/rules/plugin-trust.md",
    ".ai/rules/decision-trace-integrity.md",
    ".ai/rules/run-continuity.md",
    ".ai/rules/portable-evidence-privacy.md",
    ".ai/rules/benchmark-claim-integrity.md",
    ".ai/quality-profiles/agent-runtime.yaml",
    ".ai/quality-profiles/plugin-development.yaml",
    ".ai/quality-profiles/agent-evaluation.yaml",
    ".ai/guards/trace-completeness-gate.yaml",
    ".ai/guards/plugin-activation-gate.yaml",
    ".ai/guards/resume-safety-gate.yaml",
    ".agents/skills/trace-decisions-and-runs/SKILL.md",
    ".agents/skills/resume-and-recover-run/SKILL.md",
    ".agents/skills/author-governed-plugin/SKILL.md",
    ".agents/skills/audit-plugin-trust/SKILL.md",
    ".agents/skills/benchmark-agent-reliability/SKILL.md",
    ".agents/skills/investigate-agent-runtime/SKILL.md",
    ".ai/workflows/trace-and-recover-run.md",
    ".ai/templates/decision-event.schema.json",
    ".ai/templates/run-envelope.schema.json",
    ".ai/templates/plugin-manifest.schema.json",
    ".ai/templates/aakrun.schema.json",
    ".ai/templates/reliability-benchmark.schema.json",
    ".ai/templates/reliability-benchmark.example.json",
    ".ai/core/architecture-pulse.md",
    ".ai/templates/architecture-pulse-config.schema.json",
    ".ai/templates/architecture-pulse-result.schema.json",
    ".ai/templates/architecture-pulse-baseline.schema.json",
    ".ai/templates/architecture-pulse-comparison.schema.json",
    ".ai/core/product-genesis.md",
    ".ai/config/capability-coverage.json",
    ".ai/config/external-skill-sources.lock.json",
    ".ai/guards/product-genesis-stage-gate.yaml",
    ".ai/templates/business-requirements.schema.json",
    ".ai/templates/product-specification.schema.json",
    ".agents/skills/start-product/SKILL.md",
    ".agents/skills/write-business-requirements/SKILL.md",
    ".agents/skills/write-product-specification/SKILL.md",
    ".agents/skills/approve-product-baseline/SKILL.md",
    ".agents/skills/plan-product-delivery/SKILL.md"
  ]) {
    assert.ok(fs.existsSync(path.join(installFixture, relPath)), `packed system-design capability missing ${relPath}`);
  }
  assert.ok(fs.existsSync(path.join(installFixture, "node_modules", "@hunpeolabs", "ai-agent-kit")));
  const installedKit = path.join(installFixture, "node_modules", "@hunpeolabs", "ai-agent-kit");
  const installedCli = path.join(installedKit, "dist/bin/ai-agent-kit.mjs");
  fs.copyFileSync(path.join(installedKit, "assets/enterprise-ai-agent-os/.ai/evals/e2e/team-orchestration-cases.json"), path.join(installFixture, "team-eval.json"));
  const teamEval = execute(process.execPath, [installedCli, "team", "eval", "--fixture", "team-eval.json"], installFixture);
  assert.match(teamEval.stdout, /"status": "PASSED"/);
  const architectureStart = execute(process.execPath, [installedCli, "architecture", "start", "--goal", "Design a measured API", "--peak-rps", "5000", "--latency-ms", "900", "--provider", "aws", "--region", "us-east-1", "--budget", "1000"], installFixture);
  assert.match(architectureStart.stdout, /"request_file"/);
  const architectureInput = path.join(installFixture, "architecture-design.json");
  fs.copyFileSync(path.join(installedKit, "assets/enterprise-ai-agent-os/.ai/templates/architecture-design.example.json"), architectureInput);
  const architectureBuild = execute(
    process.execPath,
    [installedCli, "architecture", "build", "--file", path.basename(architectureInput)],
    installFixture
  );
  assert.match(architectureBuild.stdout, /"status": "GENERATED"/);
  const architectureArtifact = path.join(installFixture, ".ai-agent-kit/architecture/designs/ARCH-DEMO/architecture.json");
  assert.ok(fs.existsSync(architectureArtifact));
  const architectureVerify = execute(process.execPath, [installedCli, "architecture", "verify", "--file", path.relative(installFixture, architectureArtifact)], installFixture);
  assert.match(architectureVerify.stdout, /"status": "VERIFIED"/);
  const architectureStatus = execute(process.execPath, [installedCli, "architecture", "status"], installFixture);
  assert.match(architectureStatus.stdout, /"status": "CURRENT"/);
  const installedPackage = JSON.parse(fs.readFileSync(path.join(installFixture, "package.json"), "utf8"));
  assert.ok(installedPackage.dependencies?.["@hunpeolabs/ai-agent-kit"]);
  console.log("packed install smoke test passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
