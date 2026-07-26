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
  const tarball = path.join(temporaryRoot, packResult[0].filename);
  const fixture = path.join(temporaryRoot, "fixture");
  fs.mkdirSync(fixture);
  execute("git", ["init"], fixture);

  const packageOption = `--package=${tarball}`;
  const versionResult = execute(npxCommand, ["--yes", packageOption, "ai-agent-kit", "--version"], fixture);
  const versionOutput = `${versionResult.stdout}${versionResult.stderr}`;
  assert.match(versionOutput, new RegExp(packageData.version.replaceAll(".", "\\.")));

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
  console.log("packed npx smoke test passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
