import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspace = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-packed-"));
const packageData = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function execute(command, args, cwd) {
  const spawnArgs = process.platform === "win32"
    ? args.map((argument) => `"${argument.replaceAll('"', '\\"')}"`)
    : args;
  const result = spawnSync(command, spawnArgs, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32"
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
  const packedPaths = packResult[0].files.map((item) => item.path);
  assert.equal(packedPaths.some((file) => file.includes("/__pycache__/") || /\.py[cod]$/i.test(file)), false, "packed tarball contains Python bytecode or cache files");
  const tarball = path.join(temporaryRoot, packResult[0].filename);
  const fixture = path.join(temporaryRoot, "fixture");
  fs.mkdirSync(fixture);
  execute("git", ["init"], fixture);

  const packageOption = `--package=${tarball}`;
  const versionResult = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "--version"], fixture);
  const versionOutput = `${versionResult.stdout}${versionResult.stderr}`;
  assert.match(versionOutput, new RegExp(packageData.version.replaceAll(".", "\\.")));

  const activationResult = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit"], fixture);
  const activationOutput = `${activationResult.stdout}${activationResult.stderr}`;
  assert.match(activationOutput, /Choose how to import the kit into this project/);
  assert.match(activationOutput, /Interactive input is unavailable/);
  assert.equal(fs.existsSync(path.join(fixture, ".ai-agent-kit")), false);

  const dryRunResult = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "bootstrap", "--dry-run"],
    fixture
  );
  const dryRunOutput = `${dryRunResult.stdout}${dryRunResult.stderr}`;
  assert.match(dryRunOutput, /AI Agent Kit Bootstrap: DRY RUN/);
  assert.equal(fs.existsSync(path.join(fixture, ".ai-agent-kit")), false);

  const runtimeCreate = execute(
    npxCommand,
    [
      "--yes", packageOption, "ai-agent-kit", "runtime", "task", "create",
      "--id", "SMOKE-001", "--goal", "Verify packaged runtime",
      "--acceptance", "Task state persists", "--approval-hash", "smoke-approval",
      "--tool", "read", "--path", "src/**"
    ],
    fixture
  );
  assert.match(runtimeCreate.stdout, /"state": "DISCOVER"/);
  const runtimeStatus = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "runtime", "task", "status", "--id", "SMOKE-001"],
    fixture
  );
  assert.match(runtimeStatus.stdout, /"goal": "Verify packaged runtime"/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit", "runtime", "tasks", "SMOKE-001.json")));
  fs.writeFileSync(path.join(fixture, ".ai-agent-kit", "runtime", "smoke-evidence.txt"), "packed runtime evidence\n");

  const teamPlan = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "plan", "--id", "SMOKE-001"], fixture);
  assert.match(teamPlan.stdout, /"team_type": "SOLO"/);
  const teamStart = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "start", "--id", "SMOKE-001", "--adapter", "other"], fixture);
  assert.match(teamStart.stdout, /"execution_mode": "SERIAL_PERSONAS"/);
  const completeAssignment = (assignment, agent, evidenceHash) => {
    const context = JSON.parse(execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "context", "--id", "SMOKE-001"], fixture).stdout);
    const claim = JSON.parse(execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "claim", "--id", "SMOKE-001", "--assignment", assignment, "--agent", agent, "--expected-revision", String(context.revision)], fixture).stdout);
    const handoffFile = `.ai-agent-kit/runtime/${assignment}-handoff-input.json`;
    fs.writeFileSync(path.join(fixture, handoffFile), `${JSON.stringify({ brief_hash: context.brief_hash, facts: [`${assignment} completed`], evidence: [{ path: ".ai-agent-kit/runtime/smoke-evidence.txt", line_start: 1, line_end: 1 }], status: "COMPLETED" })}\n`);
    const handoff = JSON.parse(execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "handoff", "--id", "SMOKE-001", "--claim", claim.claim.claim_id, "--agent", agent, "--expected-revision", String(claim.revision), "--file", handoffFile], fixture).stdout);
    execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "record", "--id", "SMOKE-001", "--assignment", assignment, "--status", "COMPLETED", "--handoff-hash", handoff.handoff_hash, "--evidence-hash", evidenceHash, "--tokens", "100", "--actions", "1", "--duration-seconds", "10"], fixture);
  };
  completeAssignment("implementation-engineer", "smoke-implementer", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  completeAssignment("independent-reviewer", "smoke-reviewer", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const teamReport = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "team", "report", "--id", "SMOKE-001"], fixture);
  assert.match(teamReport.stdout, /"status": "READY"/);

  const simulation = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "policy", "simulate", "--id", "SMOKE-001", "--tool", "read", "--path", "src/example.mjs"],
    fixture
  );
  assert.match(simulation.stdout, /"mode": "SIMULATION"/);
  assert.match(simulation.stdout, /"executed": false/);

  const evalResult = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "eval", "replay", "--fixture", path.join(workspace, "test/fixtures/v070/eval-pass.json")],
    fixture
  );
  assert.match(evalResult.stdout, /"status": "PASSED"/);

  const systemDesignPrompt = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "prompt", "design-system"],
    fixture
  );
  assert.match(systemDesignPrompt.stdout, /design-scalable-systems/);
  assert.match(systemDesignPrompt.stdout, /READY_FOR_REVIEW/);

  const demoResult = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "demo", "--otlp"],
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
  const prTask = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "runtime", "task", "create", "--id", "PR-SMOKE", "--goal", "Verify PR evidence", "--acceptance", "Scoped source changes", "--tool", "edit", "--path", "src/**"],
    fixture
  );
  assert.match(prTask.stdout, /"id": "PR-SMOKE"/);
  fs.writeFileSync(path.join(fixture, "src/smoke.mjs"), "export const smoke = 2;\n");
  const prEvidence = execute(
    npxCommand,
    ["--yes", packageOption, "ai-agent-kit", "evidence", "pr-package", "--id", "PR-SMOKE", "--format", "json"],
    fixture
  );
  assert.match(prEvidence.stdout, /"approval_to_diff"/);
  assert.match(prEvidence.stdout, /"status": "PASSED"/);

  const failureManifest = path.join(fixture, "failure-lab.json");
  fs.writeFileSync(failureManifest, JSON.stringify({ schema_version: 1, cases: [{ id: "network-timeout", command: ["npm", "test"], env: { FAILURE_MODE: "network_timeout" } }] }));
  const failurePlan = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "failure", "plan", "--manifest", "failure-lab.json"], fixture);
  assert.match(failurePlan.stdout, /"status": "PREVIEW"/);

  const passportKey = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "passport", "keygen", "--key-id", "smoke-maintainer"], fixture);
  assert.match(passportKey.stdout, /"status": "CREATED"/);
  assert.ok(fs.existsSync(path.join(fixture, ".ai-agent-kit/local/passport-keys/smoke-maintainer.private.pem")));

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
    ".ai/evals/system-design-cases.yaml"
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
  console.log("packed npx smoke test passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
