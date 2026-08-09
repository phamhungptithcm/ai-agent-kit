import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ADAPTER_REGISTRY_PATH,
  capabilityMatrix,
  evaluateAdapterConformance,
  loadAdapterRegistry,
  validateAdapterRegistry
} from "../src/adapter-sdk.mjs";
import { parseAdapterArgs, parseStandardsArgs } from "../src/cli.mjs";
import { evaluateStandardsConformance, STANDARDS_SCAFFOLD_ROOT } from "../src/standards-conformance.mjs";

const SCAFFOLD = path.resolve("assets/enterprise-ai-agent-os");
const HOOK = path.join(SCAFFOLD, ".ai/scripts/copilot_action_hook.mjs");

test("adapter registry is a validated, explicit capability contract", () => {
  const registry = loadAdapterRegistry();
  assert.equal(registry.adapters.length, 12);
  assert.equal(registry.adapters.find((adapter) => adapter.id === "copilot").capabilities.hooks, "preview");
  assert.ok(capabilityMatrix(registry).adapters.every((adapter) => Object.values(adapter.capabilities).every(Boolean)));

  const tampered = JSON.parse(fs.readFileSync(ADAPTER_REGISTRY_PATH, "utf8"));
  tampered.adapters[0].exact_paths.push("../outside");
  assert.throws(() => validateAdapterRegistry(tampered), /unsafe path/);
});

test("canonical Copilot adapter exposes every declared surface", () => {
  const result = evaluateAdapterConformance({ adapterId: "copilot", root: SCAFFOLD });
  assert.equal(result.status, "PASSED");
  assert.ok(result.checks.some((check) => check.id === "skills:.github/skills"));

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-conformance-"));
  assert.equal(evaluateAdapterConformance({ adapterId: "copilot", root: empty }).status, "FAILED");
});

test("Agent Skills, MCP, and optional A2A compatibility pass conformance", () => {
  assert.equal(STANDARDS_SCAFFOLD_ROOT, SCAFFOLD);
  const result = evaluateStandardsConformance();
  assert.equal(result.status, "PASSED");
  assert.equal(result.standards.mcp.version, "2026-07-28");
  assert.equal(result.standards.a2a.version, "0.3.0");
  assert.equal(result.standards.a2a.required_for_single_agent, false);
  assert.equal(result.standards.a2a.runtime_enabled, false);
});

test("adapter and standards CLI parsers reject ambiguous input", () => {
  assert.deepEqual(parseAdapterArgs(["conformance", "--adapter", "copilot", "--target", "/tmp/repo"]), {
    action: "conformance",
    options: { adapter: "copilot", target: "/tmp/repo" }
  });
  assert.throws(() => parseAdapterArgs(["inspect"]), /requires --adapter/);
  assert.throws(() => parseStandardsArgs(["verify", "--unknown"]), /Unknown standards option/);
});

test("portable adapter fixture covers the complete governed lifecycle", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(SCAFFOLD, ".ai/evals/e2e/adapter-conformance-cases.json"), "utf8"));
  assert.deepEqual(new Set(fixture.cases.map((entry) => entry.area)), new Set(["bootstrap", "update", "action_gateway", "evidence"]));
  assert.ok(fixture.cases.every((entry) => entry.id && entry.expected));
});

function runHook(input, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("Copilot hook allows inspection and gates mutations and releases", () => {
  const read = runHook({ toolName: "bash", toolArgs: { command: "rg -n TODO src && npm test" } });
  assert.equal(read.status, 0);
  assert.equal(JSON.parse(read.stdout).permissionDecision, "allow");

  const edit = runHook({ toolName: "apply_patch", toolArgs: {} });
  assert.equal(JSON.parse(edit.stdout).permissionDecision, "ask");

  const scoped = runHook({ toolName: "bash", toolArgs: { command: "mkdir reports" } }, { AI_AGENT_KIT_TASK_ID: "TASK-1" });
  assert.equal(JSON.parse(scoped.stdout).permissionDecision, "allow");

  const release = runHook({ toolName: "bash", toolArgs: { command: "npm publish" } }, { AI_AGENT_KIT_TASK_ID: "TASK-1" });
  assert.equal(JSON.parse(release.stdout).permissionDecision, "ask");

  const malformed = spawnSync(process.execPath, [HOOK], { input: "not-json", encoding: "utf8" });
  assert.notEqual(malformed.status, 0);
});
