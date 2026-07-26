import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadScaffoldFiles } from "../src/assets.mjs";
import { bootstrap } from "../src/bootstrap.mjs";
import { main, parseBootstrapArgs, parseRuntimeArgs, parseTargetArgs, parseToolArgs } from "../src/cli.mjs";
import { parseContractManifest } from "../src/contract.mjs";
import { detectProfile } from "../src/detect.mjs";
import { verifyOwnership } from "../src/ownership.mjs";
import { assertAllowedCommand } from "../src/runner.mjs";
import { installMissingTools, TOOL_SPECS } from "../src/tools.mjs";
import { getPackageVersion } from "../src/version.mjs";
import {
  addContext, approveMemory, createTask, evaluateAction, proposeMemory, queryMemory,
  revisePlan, scoreTask, transitionTask, verifyEvidence
} from "../src/governed-runtime.mjs";
import { generateSbom } from "../scripts/generate-sbom.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function makeRepo(name = "fixture") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ai-agent-kit-${name}-`));
  run("git", ["init"], root);
  run("git", ["config", "user.email", "test@example.com"], root);
  run("git", ["config", "user.name", "Test User"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  run("git", ["add", "README.md"], root);
  run("git", ["commit", "-m", "initial"], root);
  return root;
}

function createMockRunner() {
  const calls = [];
  return {
    calls,
    run(command, args = [], options = {}) {
      assertAllowedCommand(command, args);
      calls.push({ command, args: [...args] });
      if (command === "git") {
        const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
        return { code: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      }
      if (command === "codegraph") {
        if (args[0] === "--version") return { code: 0, stdout: "1.4.1\n", stderr: "" };
        return { code: 0, stdout: "CodeGraph OK\n", stderr: "" };
      }
      if (command === "ccc") {
        if (args[0] === "--help") return { code: 0, stdout: "CocoIndex CLI help\n", stderr: "" };
        return { code: 0, stdout: "CocoIndex OK\n", stderr: "" };
      }
      if (command === "npm" || command === "uv") return { code: 0, stdout: "", stderr: "" };
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
  };
}

function status(root) {
  return run("git", ["status", "--porcelain=v1", "--untracked-files=all"], root);
}

function snapshotFiles(root, relPaths) {
  return Object.fromEntries(relPaths.map((relPath) => [relPath, fs.readFileSync(path.join(root, relPath), "utf8")]));
}

async function runBootstrap(root, extra = {}) {
  const logs = [];
  const runner = createMockRunner();
  const result = await bootstrap(
    {
      target: root,
      profile: "auto",
      nonInteractive: true,
      yes: true,
      installTools: false,
      claudeOnly: false,
      codexOnly: false,
      dryRun: false,
      verbose: false,
      ...extra.options
    },
    {
      runner,
      transactionId: extra.transactionId ?? "20260715T000000Z-test",
      packageVersion: "0.1.0-test",
      io: { log: (message = "") => logs.push(String(message)) },
      failStep: extra.failStep
    }
  );
  return { result, runner, logs: logs.join("\n") };
}

test("bootstrap creates local AI-agent files without staging, branch, commit, push, or MR", async () => {
  const root = makeRepo("clean");
  const branchBefore = run("git", ["branch", "--show-current"], root);
  const headBefore = run("git", ["rev-parse", "HEAD"], root);
  const { runner, logs } = await runBootstrap(root);

  assert.equal(run("git", ["branch", "--show-current"], root), branchBefore);
  assert.equal(run("git", ["rev-parse", "HEAD"], root), headBefore);
  assert.equal(run("git", ["diff", "--cached", "--name-only"], root), "");
  assert.ok(fs.existsSync(path.join(root, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(root, "CLAUDE.md")));
  assert.ok(fs.existsSync(path.join(root, "AI_AGENT_TEAM_GUIDE.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "PROMPTS.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "manifest.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "core", "quality-gates.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "core", "code-quality-intelligence.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "core", "memory-policy.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "guards", "code-quality-profile-gate.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "guards", "memory-governance.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "scripts", "enforce_command_policy.py")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "scripts", "evaluate_agent_behavior.py")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "scripts", "validate_implementation_approval.py")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "evals", "behavioral-cases.json")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "code-quality-review.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "memory-entry.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "go.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "java.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "python.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "typescript-javascript.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "web-app.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "seo-geo.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "visual-design.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "animation-motion.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "mobile-app.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "desktop-app.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "infrastructure.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "quality-profiles", "devops.yaml")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "rules", "seo-geo.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "rules", "visual-design-integrity.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "rules", "animation-integrity.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "seo-geo-review.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "design-brief.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "design-direction.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "visual-design-review.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "ui-state-inventory.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "motion-brief.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "motion-contract.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "animation-inventory.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai", "templates", "animation-review.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "seo-geo-website", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "skills", "seo-geo-website", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "design-taste-website", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "skills", "design-taste-website", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "animation-design-engineering", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "skills", "animation-design-engineering", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".mcp.json")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "settings.json")));
  assert.ok(fs.existsSync(path.join(root, ".codex", "config.toml")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "repository-intelligence", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "code-quality-review", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "architecture-review", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "release-readiness", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".agents", "skills", "security-review", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(root, ".codex", "agents", "solution-architect.toml")));
  assert.ok(fs.existsSync(path.join(root, ".codex", "agents", "senior-backend-engineer.toml")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "agents", "release-manager.md")));
  assert.ok(fs.existsSync(path.join(root, ".codex", "agents", "web-growth-engineer.toml")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "agents", "web-growth-engineer.md")));
  assert.match(
    fs.readFileSync(path.join(root, ".agents", "skills", "repository-intelligence", "SKILL.md"), "utf8"),
    /GENERATED by \.ai\/scripts\/sync_agent_assets\.py from \.ai\/skills-src\/repository-intelligence\/SKILL\.md/
  );
  assert.ok(fs.existsSync(path.join(root, ".ai-agent-kit", "output", "merge-request-description.md")));
  assert.ok(fs.existsSync(path.join(root, ".ai-agent-kit", "output", "jira-update.md")));
  const installation = JSON.parse(fs.readFileSync(path.join(root, ".ai-agent-kit", "installation.json"), "utf8"));
  assert.equal(installation.preset, "governed");
  assert.equal(installation.contractVersion, 2);
  assert.deepEqual(installation.adapters, { claude: true, codex: true });
  assert.ok(installation.managedFiles.some((entry) => entry.path === ".ai/core/quality-gates.md"));
  assert.ok(installation.managedFiles.some((entry) => entry.path === "AGENTS.md" && entry.mode === "managed-section"));
  assert.ok(installation.managedFiles.every((entry) => /^[a-f0-9]{64}$/.test(entry.installedSha256)));
  assert.ok(installation.managedFiles.every((entry) => typeof entry.generatedFrom === "string"));
  assert.match(logs, /No files were staged/);
  assert.match(logs, /No branch was created/);
  assert.match(logs, /No merge request was created/);
  assert.match(logs, /Prompt quick start/);
  assert.match(logs, /\.ai\/PROMPTS\.md/);

  const forbidden = runner.calls.filter((call) => call.command === "git" && ["add", "commit", "push", "worktree", "checkout", "switch"].includes(call.args[0]));
  assert.deepEqual(forbidden, []);
  assert.equal(runner.calls.some((call) => call.command === "codegraph" && call.args[0] === "sync"), false);
  assert.equal(runner.calls.some((call) => call.command === "ccc" && call.args[0] === "index"), false);
});

test("bootstrap is idempotent and does not duplicate managed sections or skills", async () => {
  const root = makeRepo("idempotent");
  await runBootstrap(root, { transactionId: "20260715T000001Z-first" });
  const firstStatus = status(root);
  const firstAgents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const firstCodex = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  await runBootstrap(root, { transactionId: "20260715T000002Z-second" });
  const secondStatus = status(root);
  const secondAgents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const secondCodex = fs.readFileSync(path.join(root, ".codex", "config.toml"), "utf8");

  assert.equal(secondStatus, firstStatus);
  assert.equal((secondAgents.match(/BEGIN @hunpeolabs\/ai-agent-kit managed/g) ?? []).length, 1);
  assert.equal((secondAgents.match(/Repository Intelligence/g) ?? []).length, (firstAgents.match(/Repository Intelligence/g) ?? []).length);
  assert.equal(secondCodex, firstCodex);
});

test("dirty developer application changes remain untouched", async () => {
  const root = makeRepo("dirty");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.js"), "console.log('original');\n");
  run("git", ["add", "src/app.js"], root);
  run("git", ["commit", "-m", "add app"], root);
  fs.writeFileSync(path.join(root, "src", "app.js"), "console.log('developer change');\n");

  await runBootstrap(root);

  assert.equal(fs.readFileSync(path.join(root, "src", "app.js"), "utf8"), "console.log('developer change');\n");
  assert.match(status(root), /src\/app\.js/);
});

test("existing AGENTS.md content is preserved with a managed section", async () => {
  const root = makeRepo("existing-agents");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Existing Instructions\n\nKeep this.\n");
  await runBootstrap(root);
  const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.match(text, /Existing Instructions/);
  assert.match(text, /BEGIN @hunpeolabs\/ai-agent-kit managed/);
});

test("dry run modifies nothing and performs no installs or indexing", async () => {
  const root = makeRepo("dry-run");
  const before = status(root);
  const { runner, logs } = await runBootstrap(root, { options: { dryRun: true, installTools: false } });
  assert.equal(status(root), before);
  assert.equal(fs.existsSync(path.join(root, ".ai-agent-kit")), false);
  assert.match(logs, /DRY RUN/);
  assert.equal(runner.calls.some((call) => call.command === "codegraph" || call.command === "ccc" || call.command === "npm" || call.command === "uv"), false);
});

test("forbidden bootstrap options fail before any work", () => {
  assert.throws(() => parseBootstrapArgs(["--commit"]), /Remote Git operations are disabled/);
  assert.throws(() => parseBootstrapArgs(["--push"]), /Remote Git operations are disabled/);
  assert.throws(() => parseBootstrapArgs(["--create-mr"]), /Remote Git operations are disabled/);
  assert.throws(() => parseBootstrapArgs(["--git-mode", "branch"]), /Remote Git operations are disabled/);
});

test("bootstrap defaults to fast policy-only mode unless deep setup is requested", () => {
  const defaults = parseBootstrapArgs([]);
  assert.equal(defaults.preset, "governed");
  assert.equal(defaults.installTools, false);
  assert.equal(defaults.refreshIndexes, false);

  const deep = parseBootstrapArgs(["--deep"]);
  assert.equal(deep.installTools, false);
  assert.equal(deep.refreshIndexes, true);

  const refreshOnly = parseBootstrapArgs(["--refresh-indexes"]);
  assert.equal(refreshOnly.installTools, false);
  assert.equal(refreshOnly.refreshIndexes, true);
  assert.throws(() => parseBootstrapArgs(["--install-tools"]), /tools install --apply/);
});

test("governed and full presets preserve the same quality contract", async () => {
  const governedRoot = makeRepo("governed-contract");
  const fullRoot = makeRepo("full-contract");
  await runBootstrap(governedRoot, { options: { preset: "governed" } });
  await runBootstrap(fullRoot, { options: { preset: "full" } });
  const contractFiles = [
    ".ai/core/required-workflow.md",
    ".ai/core/risk-model.md",
    ".ai/core/quality-gates.md",
    ".ai/core/output-contract.md",
    ".ai/core/memory-policy.md",
    ".ai/guards/repository-intelligence-gate.yaml",
    ".ai/guards/implementation-approval-gate.yaml",
    ".ai/guards/code-quality-profile-gate.yaml",
    ".ai/guards/memory-governance.yaml",
    ".ai/quality-profiles/universal.yaml",
    ".ai/quality-profiles/typescript-javascript.yaml",
    ".ai/quality-profiles/web-app.yaml",
    ".ai/quality-profiles/seo-geo.yaml",
    ".ai/quality-profiles/visual-design.yaml",
    ".ai/quality-profiles/animation-motion.yaml"
  ];

  assert.deepEqual(snapshotFiles(fullRoot, contractFiles), snapshotFiles(governedRoot, contractFiles));
});

test("minimal preset is not exposed until its quality contract is validated", () => {
  assert.throws(
    () => parseBootstrapArgs(["--preset", "minimal"]),
    /Unsupported preset: minimal/
  );
  assert.equal(parseBootstrapArgs(["--preset", "full"]).preset, "full");
});

test("single-adapter bootstrap does not generate the excluded adapter skills", async () => {
  const codexRoot = makeRepo("codex-only");
  await runBootstrap(codexRoot, { options: { codexOnly: true } });
  assert.equal(fs.existsSync(path.join(codexRoot, ".claude")), false);
  assert.ok(fs.existsSync(path.join(codexRoot, ".agents", "skills", "start-task", "SKILL.md")));

  const claudeRoot = makeRepo("claude-only");
  await runBootstrap(claudeRoot, { options: { claudeOnly: true } });
  assert.equal(fs.existsSync(path.join(claudeRoot, ".codex")), false);
  assert.equal(fs.existsSync(path.join(claudeRoot, ".agents")), false);
  assert.ok(fs.existsSync(path.join(claudeRoot, ".claude", "skills", "start-task", "SKILL.md")));
});

test("status, doctor, and diff are read-only", async () => {
  const root = makeRepo("inspection");
  await runBootstrap(root);
  const before = status(root);
  const runner = createMockRunner();
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };
  const deps = { runner, packageVersion: "0.2.0-test" };

  await main(["status", "--target", root], io, deps);
  await main(["doctor", "--target", root], io, deps);
  await main(["diff", "--target", root], io, deps);

  assert.equal(status(root), before);
  assert.match(logs.join("\n"), /Core policy: CORE_READY/);
  assert.match(logs.join("\n"), /Ownership: VERIFIED/);
  assert.match(logs.join("\n"), /Repository Intelligence: READY/);
  assert.match(logs.join("\n"), /Governed implementation: READY/);
  assert.match(logs.join("\n"), /No files were modified/);
});

test("update and uninstall lifecycle commands require dry-run and modify nothing", async () => {
  const root = makeRepo("lifecycle-preview");
  await runBootstrap(root);
  const before = status(root);
  const runner = createMockRunner();
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };
  const deps = { runner, packageVersion: "0.2.0-test" };

  await assert.rejects(() => main(["update", "--target", root], io, deps), /preview-only/);
  await assert.rejects(() => main(["uninstall", "--target", root], io, deps), /preview-only/);
  await main(["update", "--dry-run", "--target", root], io, deps);
  await main(["uninstall", "--dry-run", "--target", root], io, deps);

  assert.equal(status(root), before);
  assert.match(logs.join("\n"), /Update: DRY RUN/);
  assert.match(logs.join("\n"), /Uninstall: DRY RUN/);
  assert.match(logs.join("\n"), /managed-section: AGENTS\.md/);
});

test("manifest drives contract completeness and detects drift outside the old core subset", async () => {
  const root = makeRepo("contract-drift");
  await runBootstrap(root);
  const runner = createMockRunner();
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };

  fs.appendFileSync(path.join(root, ".ai", "rules", "security.md"), "\nHuman drift.\n");
  await main(["status", "--target", root], io, { runner });
  assert.match(logs.join("\n"), /Core policy: DRIFTED/);
  assert.match(logs.join("\n"), /Ownership: DRIFTED/);
  assert.match(logs.join("\n"), /Governed implementation: BLOCKED/);

  logs.length = 0;
  fs.rmSync(path.join(root, ".ai", "rules", "security.md"));
  await main(["doctor", "--target", root], io, { runner });
  assert.match(logs.join("\n"), /Core policy: INCOMPLETE/);
  assert.match(logs.join("\n"), /Missing core files:\n- \.ai\/rules\/security\.md/);
});

test("managed-section ownership ignores human content outside kit markers", async () => {
  const root = makeRepo("managed-section-ownership");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Human instructions\n\nKeep this.\n");
  await runBootstrap(root);
  fs.appendFileSync(path.join(root, "AGENTS.md"), "\n## More human instructions\n");

  const installation = JSON.parse(fs.readFileSync(path.join(root, ".ai-agent-kit", "installation.json"), "utf8"));
  const ownership = verifyOwnership(root, installation.managedFiles);
  const agents = ownership.entries.find((entry) => entry.path === "AGENTS.md");
  assert.equal(agents.state, "UNCHANGED");
});

test("lifecycle previews surface modified ownership instead of claiming safe removal", async () => {
  const root = makeRepo("ownership-conflict");
  await runBootstrap(root);
  fs.appendFileSync(path.join(root, ".ai", "core", "quality-gates.md"), "\nLocal customization.\n");
  const runner = createMockRunner();
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };

  await main(["update", "--dry-run", "--target", root], io, { runner });
  await main(["uninstall", "--dry-run", "--target", root], io, { runner });

  assert.match(logs.join("\n"), /Ownership verification: DRIFTED/);
  assert.match(logs.join("\n"), /MODIFIED: generated-file: \.ai\/core\/quality-gates\.md/);
  assert.match(logs.join("\n"), /would be preserved/);
});

test("canonical contract manifest covers every shipped .ai file", () => {
  const scaffold = loadScaffoldFiles();
  const manifest = scaffold.get(".ai/manifest.yaml");
  const requiredPaths = new Set(parseContractManifest(manifest));
  const uncovered = [...scaffold.keys()]
    .filter((relPath) => relPath.startsWith(".ai/") && !requiredPaths.has(relPath))
    .sort();
  assert.deepEqual(uncovered, []);
});

test("ownership and contract metadata cannot escape the repository root", () => {
  const root = makeRepo("ownership-path-safety");
  const ownership = verifyOwnership(root, [
    {
      path: "../outside.txt",
      mode: "generated-file",
      installedSha256: "0".repeat(64)
    }
  ]);
  assert.equal(ownership.entries[0].state, "INVALID_PATH");
  assert.throws(
    () => parseContractManifest('rules:\n  - ".ai/../../outside.txt"\n'),
    /must remain inside the repository/
  );
});

test("bootstrap refuses to write through repository symlinks", { skip: process.platform === "win32" }, async () => {
  const root = makeRepo("symlink-safety");
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-external-"));
  fs.symlinkSync(external, path.join(root, ".ai"), "dir");

  await assert.rejects(() => runBootstrap(root), /refuses to write through a symbolic link/);
  assert.deepEqual(fs.readdirSync(external), []);
});

test("detector reads dependency manifests and records framework versions", () => {
  const root = makeRepo("detector-manifests");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    engines: { node: ">=20" },
    dependencies: { react: "^19.1.0" },
    devDependencies: { typescript: "^5.9.0" }
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(root, "services", "api"), { recursive: true });
  fs.writeFileSync(path.join(root, "services", "api", "pom.xml"), "<dependency>org.springframework.boot</dependency>\n");

  const detection = detectProfile(root);
  assert.equal(detection.technologies.node, true);
  assert.equal(detection.technologies.react, true);
  assert.equal(detection.technologies.typescript, true);
  assert.equal(detection.technologies.springBoot, true);
  assert.equal(detection.versions.node, ">=20");
  assert.equal(detection.versions.react, "^19.1.0");
  assert.equal(detection.versions.typescript, "^5.9.0");
  assert.deepEqual(detection.manifests, ["package.json", "services/api/pom.xml"]);
});

test("tool installation is separate, pinned, and requires explicit apply", async () => {
  assert.deepEqual(parseToolArgs(["plan"]), {
    subcommand: "plan",
    options: { target: process.cwd(), apply: false }
  });
  assert.throws(() => parseToolArgs(["install"]), /tools install --apply/);
  assert.throws(() => parseToolArgs(["plan", "--apply"]), /read-only/);

  const root = makeRepo("tools-plan");
  const readyRunner = createMockRunner();
  const logs = [];
  await main(["tools", "plan", "--target", root], { log: (message = "") => logs.push(String(message)) }, { runner: readyRunner });
  assert.match(logs.join("\n"), new RegExp(TOOL_SPECS.codegraph.package.replaceAll(".", "\\.")));
  assert.match(logs.join("\n"), /No tools were installed/);
  assert.equal(readyRunner.calls.some((call) => call.command === "npm" || call.command === "uv"), false);
  assert.equal(readyRunner.calls.some((call) => call.command === "codegraph" && call.args[0] !== "--version"), false);
  assert.equal(readyRunner.calls.some((call) => call.command === "ccc" && call.args[0] !== "--help"), false);

  const installCalls = [];
  const installingRunner = {
    run(command, args) {
      installCalls.push([command, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    }
  };
  installMissingTools(
    installingRunner,
    root,
    { codegraph: { status: "MISSING" }, cocoindex: { status: "MISSING" } },
    true
  );
  assert.deepEqual(installCalls, [
    TOOL_SPECS.codegraph.installCommand,
    TOOL_SPECS.cocoindex.installCommand
  ]);
});

test("CLI version comes from package.json", async () => {
  const logs = [];
  await main(["--version"], { log: (message = "") => logs.push(String(message)) });
  assert.equal(logs.join("\n"), getPackageVersion());
});

test("target argument parser rejects state-changing lifecycle execution", () => {
  assert.throws(() => parseTargetArgs([], { requireDryRun: true }), /preview-only/);
  assert.equal(parseTargetArgs(["--dry-run", "--target", "/tmp/example"], { requireDryRun: true }).target, "/tmp/example");
});

test("prompt commands print the catalog and named prompts", async () => {
  const logs = [];
  const io = { log: (message = "") => logs.push(String(message)) };

  await main(["prompts"], io);
  assert.match(logs.join("\n"), /AI Agent Prompt Catalog/);
  assert.match(logs.join("\n"), /start-task/);
  assert.match(logs.join("\n"), /code-quality-review/);
  assert.match(logs.join("\n"), /prepare-handoff/);

  logs.length = 0;
  await main(["prompt", "bug"], io);
  assert.match(logs.join("\n"), /# fix-bug/);
  assert.match(logs.join("\n"), /first incorrect state/);

  logs.length = 0;
  await main(["prompt", "pr-review"], io);
  assert.match(logs.join("\n"), /# review-pr/);
  assert.match(logs.join("\n"), /Lead with findings by severity/);

  logs.length = 0;
  await main(["prompt", "quality"], io);
  assert.match(logs.join("\n"), /# code-quality-review/);
  assert.match(logs.join("\n"), /selected `\.ai\/quality-profiles\/`/);

  logs.length = 0;
  await main(["prompt", "seo"], io);
  assert.match(logs.join("\n"), /# build-seo-geo-website/);
  assert.match(logs.join("\n"), /Treat llms\.txt as optional and experimental/);

  logs.length = 0;
  await main(["prompt", "taste"], io);
  assert.match(logs.join("\n"), /# design-website/);
  assert.match(logs.join("\n"), /Redesign is audit-first/);

  logs.length = 0;
  await main(["prompt", "motion"], io);
  assert.match(logs.join("\n"), /# animate-interface/);
  assert.match(logs.join("\n"), /Do not add motion without a purpose/);
});

test("prompt command shows available names when no name is provided", async () => {
  const logs = [];
  await main(["prompt"], { log: (message = "") => logs.push(String(message)) });
  assert.match(logs.join("\n"), /Available prompts/);
  assert.match(logs.join("\n"), /implement-approved/);
  assert.match(logs.join("\n"), /code-quality-review/);
  assert.match(logs.join("\n"), /build-seo-geo-website/);
  assert.match(logs.join("\n"), /design-website/);
  assert.match(logs.join("\n"), /animate-interface/);
});

test("prompt command rejects unknown names with available prompts", async () => {
  await assert.rejects(
    () => main(["prompt", "unknown-workflow"], { log: () => {} }),
    /Unknown prompt: unknown-workflow/
  );
});

test("failure rolls back generated AI configuration and preserves diagnostics", async () => {
  const root = makeRepo("rollback");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Human file\n");
  await assert.rejects(() => runBootstrap(root, { failStep: "after-write" }), /Injected bootstrap failure/);

  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# Human file\n");
  assert.equal(fs.existsSync(path.join(root, ".ai", "README.md")), false);
  assert.equal(fs.existsSync(path.join(root, ".ai-agent-kit", "transactions")), true);
});

test("runner blocks forbidden Git and remote API operations", () => {
  assert.throws(() => assertAllowedCommand("git", ["add", "."]), /Forbidden Git operation/);
  assert.throws(() => assertAllowedCommand("git", ["commit", "-m", "x"]), /Forbidden Git operation/);
  assert.throws(() => assertAllowedCommand("git", ["push"]), /Forbidden Git operation/);
  assert.throws(() => assertAllowedCommand("curl", ["https://gitlab.com/api/v4/projects"]), /Forbidden remote API/);
  assert.throws(() => assertAllowedCommand("curl", ["https://example.atlassian.net/rest/api/3/issue"]), /Forbidden remote API/);
});

test("command policy classifies safe, review-required, and forbidden commands", () => {
  const script = path.resolve("assets/enterprise-ai-agent-os/.ai/scripts/enforce_command_policy.py");
  const safe = spawnSync("python3", [script, "--command", "npm test", "--json"], { encoding: "utf8" });
  assert.equal(safe.status, 0);
  assert.equal(JSON.parse(safe.stdout).decision, "allow");

  const review = spawnSync("python3", [script, "--command", "git push origin main", "--json"], { encoding: "utf8" });
  assert.equal(review.status, 1);
  assert.equal(JSON.parse(review.stdout).decision, "ask");

  const forbidden = spawnSync("python3", [script, "--command", "rm -rf build", "--json"], { encoding: "utf8" });
  assert.equal(forbidden.status, 2);
  assert.equal(JSON.parse(forbidden.stdout).decision, "deny");
});

test("approval validator binds approved paths to the actual diff", () => {
  const root = makeRepo("approval-diff");
  const script = path.resolve("assets/enterprise-ai-agent-os/.ai/scripts/validate_implementation_approval.py");
  const record = path.join(root, "approval.md");
  fs.writeFileSync(
    record,
    [
      "# Implementation Approval Record",
      "Plan ID/version: TEST-V1",
      "Repository intelligence gate status: READY",
      "Approval status: APPROVED",
      "Approver: Test Owner",
      "Approval timestamp or task reference: test",
      "Approved paths:",
      "- `README.md`",
      ""
    ].join("\n")
  );
  run("git", ["add", "approval.md"], root);
  run("git", ["commit", "-m", "track approval"], root);
  fs.appendFileSync(path.join(root, "README.md"), "approved change\n");
  const approved = spawnSync(
    "python3",
    [script, "--record", record, "--base-ref", "HEAD"],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(approved.status, 0, approved.stderr);

  fs.writeFileSync(path.join(root, "outside.txt"), "not approved\n");
  const rejected = spawnSync(
    "python3",
    [script, "--record", record, "--base-ref", "HEAD"],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /outside approved scope: outside\.txt/);
});

test("behavioral evaluation schema is executable without model credentials", () => {
  const script = path.resolve("assets/enterprise-ai-agent-os/.ai/scripts/evaluate_agent_behavior.py");
  const result = spawnSync("python3", [script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /10 cases, schema validation/);
});

test("governed runtime enforces state, capability, policy, and evidence integrity", () => {
  const root = makeRepo("governed-runtime");
  const task = createTask({
    target: root,
    id: "TASK-123",
    goal: "Implement and verify the approved runtime change",
    acceptanceCriteria: ["Policy decisions are recorded", "Evidence verifies"],
    approvalHash: "approved-hash",
    risk: "medium",
    tools: ["read", "edit", "shell"],
    paths: ["src/**"],
    maxActions: 10
  });
  assert.equal(task.state, "DISCOVER");
  assert.throws(() => transitionTask({ target: root, id: task.id, to: "APPROVED", evidence: {} }), /invalid transition/);
  transitionTask({ target: root, id: task.id, to: "ANALYZE", evidence: {} });
  addContext({ target: root, id: task.id, kind: "fact", statement: "Runtime source inspected", source: "codegraph://governed-runtime" });
  revisePlan({ target: root, id: task.id, trigger: "Repository evidence collected", steps: ["Implement runtime", "Run tests"] });
  transitionTask({ target: root, id: task.id, to: "PLAN_READY", evidence: { repository_intelligence: "READY" } });
  transitionTask({
    target: root,
    id: task.id,
    to: "APPROVED",
    evidence: { approval_hash: "approved-hash", approver: "Repository Owner" }
  });
  const approved = JSON.parse(fs.readFileSync(path.join(root, ".ai-agent-kit/runtime/tasks/TASK-123.json"), "utf8"));
  transitionTask({
    target: root,
    id: task.id,
    to: "IMPLEMENTING",
    evidence: { capability_hash: approved.capability_hash }
  });

  assert.equal(evaluateAction({ target: root, id: task.id, tool: "edit", path: "src/example.mjs" }).decision, "allow");
  assert.equal(evaluateAction({ target: root, id: task.id, tool: "edit", path: "docs/example.md" }).reason_code, "PATH_NOT_ALLOWED");
  assert.equal(
    evaluateAction({ target: root, id: task.id, tool: "shell", path: "src/example.mjs", command: "terraform destroy" }).reason_code,
    "CRITICAL_MUTATION_FORBIDDEN"
  );
  assert.equal(verifyEvidence({ target: root, id: task.id }).status, "VERIFIED");
  assert.equal(scoreTask({ target: root, id: task.id }).score, 1);

  const proposed = proposeMemory({
    target: root, id: task.id, title: "Runtime verification",
    content: "Verify the evidence ledger before completion.", source: "TASK-123", confidence: 0.9
  });
  assert.deepEqual(queryMemory({ target: root, query: "ledger" }), []);
  approveMemory({ target: root, memoryId: proposed.id, approver: "Repository Owner" });
  assert.equal(queryMemory({ target: root, query: "ledger" }).length, 1);

  const ledger = path.join(root, ".ai-agent-kit/runtime/evidence/TASK-123.jsonl");
  fs.appendFileSync(ledger, `${JSON.stringify({ receipt_hash: "tampered", previous_receipt_hash: null })}\n`);
  assert.equal(verifyEvidence({ target: root, id: task.id }).status, "REJECTED");
});

test("runtime CLI parser preserves repeated capabilities and evidence", () => {
  const parsed = parseRuntimeArgs([
    "task", "create", "--id", "TASK-7", "--tool", "read", "--tool", "edit",
    "--path", "src/**", "--goal", "Ship safely", "--acceptance", "Tests pass", "--evidence", "tests=passed"
  ]);
  assert.deepEqual(parsed.options.tools, ["read", "edit"]);
  assert.deepEqual(parsed.options.paths, ["src/**"]);
  assert.equal(parsed.options.evidence.tests, "passed");
  assert.equal(parsed.options.goal, "Ship safely");
  assert.deepEqual(parsed.options.acceptanceCriteria, ["Tests pass"]);
});

test("build SBOM is valid SPDX and contains the package version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-sbom-"));
  fs.copyFileSync("package.json", path.join(root, "package.json"));
  fs.copyFileSync("package-lock.json", path.join(root, "package-lock.json"));
  const target = generateSbom({ root });
  const sbom = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.match(sbom.name, /ai-agent-kit-0\.3\.0/);
  assert.ok(sbom.packages.length >= 1);
});
