import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main, parseIntentArgs } from "../src/cli.mjs";
import { createTask } from "../src/governed-runtime.mjs";
import { createProductWorkspace, PRODUCT_STAGES } from "../src/product-genesis.mjs";
import {
  detectProductEntry,
  discoverProductWorkspaces,
  evaluateProductIntent,
  loadProductIntentConfig,
  loadProductIntentFixture,
  validateProductIntentConfig
} from "../src/product-intent.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const configFile = path.join(repoRoot, "assets/enterprise-ai-agent-os/.ai/config/product-intent.json");
const fixtureFile = path.join(repoRoot, "assets/enterprise-ai-agent-os/.ai/evals/e2e/product-intent-cases.json");

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-intent-"));
}

test("product intent config stays aligned with the Product Genesis stage contract", () => {
  const config = loadProductIntentConfig(configFile);
  assert.equal(validateProductIntentConfig(config).status, "VALID");
  assert.deepEqual(config.product_stages, PRODUCT_STAGES);
});

test("natural Vietnamese and English raw ideas auto-enter Product Genesis", () => {
  const target = root();
  for (const hint of [
    "Mình muốn làm một ứng dụng giúp chủ salon giảm khách bỏ hẹn",
    "Tôi đang nghĩ tới một nền tảng học tiếng Anh cho trẻ em nhưng chưa biết bắt đầu từ đâu",
    "Giúp tôi xây SaaS quản lý kho từ con số không",
    "I want to build an app that helps salons reduce missed appointments"
  ]) {
    const result = detectProductEntry({ target, hint, config: configFile });
    assert.equal(result.status, "DETECTED");
    assert.equal(result.mode, "PRODUCT_GENESIS");
    assert.equal(result.action, "START_PRODUCT_GENESIS");
    assert.equal(result.entry_skill, "run-product-genesis");
    assert.equal(JSON.stringify(result).includes(hint), false);
    assert.deepEqual(result.privacy, { output_contains_raw_prompt: false, routing_persists_raw_prompt: false });
  }
});

test("existing engineering and explanation requests do not auto-enter Product Genesis", () => {
  const target = root();
  const existing = detectProductEntry({ target, hint: "Fix the checkout bug and add a regression test", config: configFile });
  assert.equal(existing.status, "DETECTED");
  assert.equal(existing.mode, "EXISTING_SYSTEM");
  assert.equal(existing.action, "START_EXISTING_SYSTEM_WORKFLOW");
  const explanation = detectProductEntry({ target, hint: "Explain what the word product means", config: configFile });
  assert.equal(explanation.status, "ABSTAIN");
  assert.equal(explanation.mode, null);
});

test("conflicting product and existing-system signals require confirmation", () => {
  const result = detectProductEntry({ target: root(), hint: "I want to build an app feature in existing code", config: configFile });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.requires_confirmation, true);
  assert.ok(result.reason_codes.includes("CONFLICT_PRODUCT_AND_EXISTING_SYSTEM"));
});

test("one active workspace resumes and a new idea requires start-or-resume selection", () => {
  const target = root();
  createProductWorkspace({ target, id: "salon-pilot", idea: "Reduce salon no-shows", profile: "lean", timestamp: "2026-08-20T12:00:00Z" });
  const discovered = discoverProductWorkspaces({ target, config: configFile });
  assert.equal(discovered.status, "SINGLE_ACTIVE");
  assert.equal(discovered.products[0].id, "salon-pilot");
  const resumed = detectProductEntry({ target, hint: "Tiếp tục sản phẩm từ bước trước", config: configFile });
  assert.equal(resumed.status, "DETECTED");
  assert.equal(resumed.action, "RESUME_PRODUCT_GENESIS");
  assert.equal(resumed.product_id, "salon-pilot");
  const newIdea = detectProductEntry({ target, hint: "Mình muốn làm một ứng dụng quản lý phòng gym", config: configFile });
  assert.equal(newIdea.status, "AMBIGUOUS");
  assert.equal(newIdea.action, "SELECT_OR_START_PRODUCT");
});

test("multiple active workspaces never select a product silently", () => {
  const target = root();
  createProductWorkspace({ target, id: "salon-pilot", idea: "Reduce salon no-shows", profile: "lean", timestamp: "2026-08-20T12:00:00Z" });
  createProductWorkspace({ target, id: "clinic-pilot", idea: "Coordinate clinic appointments", profile: "standard", timestamp: "2026-08-20T12:01:00Z" });
  const result = detectProductEntry({ target, hint: "Continue where we left off with the product", config: configFile });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.action, "SELECT_PRODUCT");
  assert.deepEqual(new Set(result.active_product_ids), new Set(["salon-pilot", "clinic-pilot"]));
});

test("workspace integrity failure blocks Product Genesis continuation", () => {
  const target = root();
  createProductWorkspace({ target, id: "salon-pilot", idea: "Reduce salon no-shows", profile: "lean", timestamp: "2026-08-20T12:00:00Z" });
  const stateFile = path.join(target, ".ai/products/salon-pilot/product.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.stage = "OPERATING";
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const result = detectProductEntry({ target, hint: "Tiếp tục sản phẩm", config: configFile });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.action, "REPAIR_PRODUCT_WORKSPACE");
  assert.ok(result.reason_codes.includes("WORKSPACE_INTEGRITY_FAILED"));
});

test("intent configuration and workspace discovery reject unsafe linked inputs", () => {
  const target = root();
  const linkedConfig = path.join(target, "intent.json");
  fs.symlinkSync(configFile, linkedConfig);
  assert.throws(() => loadProductIntentConfig(linkedConfig), /non-linked regular JSON file/);
  const localConfig = path.join(target, "intent-copy.json");
  const hardlinkedConfig = path.join(target, "intent-hardlink.json");
  fs.copyFileSync(configFile, localConfig);
  fs.linkSync(localConfig, hardlinkedConfig);
  assert.throws(() => loadProductIntentConfig(hardlinkedConfig), /non-linked regular JSON file/);
  const products = path.join(target, ".ai/products");
  const external = path.join(target, "external-product");
  fs.mkdirSync(products, { recursive: true });
  fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(products, "linked-product"), "dir");
  const result = discoverProductWorkspaces({ target, config: configFile });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.invalid, [{ id: "linked-product", reason: "UNSAFE_WORKSPACE_DIRECTORY" }]);
});

test("workspace discovery enforces an aggregate byte budget", () => {
  const target = root();
  createProductWorkspace({ target, id: "salon-pilot", idea: "Reduce salon no-shows", profile: "lean", timestamp: "2026-08-20T12:00:00Z" });
  const config = loadProductIntentConfig(configFile);
  config.max_total_workspace_bytes = 256;
  const localConfig = path.join(target, "intent-budget.json");
  fs.writeFileSync(localConfig, `${JSON.stringify(config)}\n`);
  const result = discoverProductWorkspaces({ target, config: localConfig });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.invalid, [{ id: "salon-pilot", reason: "WORKSPACE_BYTE_BUDGET_EXCEEDED" }]);
});

test("intent hints are bounded before classification", () => {
  assert.throws(() => detectProductEntry({ target: root(), hint: "x".repeat(40_000), config: configFile }), /exceeds 32768 bytes/);
});

test("product intent evaluation covers multilingual positives negatives and ambiguity", () => {
  const result = evaluateProductIntent({ config: loadProductIntentConfig(configFile), fixture: loadProductIntentFixture(fixtureFile) });
  assert.equal(result.status, "PASSED");
  assert.deepEqual(result.summary, { total: 50, passed: 50, failed: 0, accuracy: 1, product_precision: 1, product_recall: 1 });
  assert.deepEqual(result.failures, []);
});

test("intent and product discovery CLI surfaces are machine-readable", async () => {
  assert.throws(() => parseIntentArgs(["detect"]), /exactly one/);
  assert.throws(() => parseIntentArgs(["detect", "--hint", "idea", "--stdin"]), /exactly one/);
  assert.throws(() => parseIntentArgs(["eval"]), /requires --fixture/);
  const target = root();
  const logs = [];
  assert.equal(await main(["intent", "detect", "--target", target, "--config", configFile, "--stdin"], { log: (value) => logs.push(value) }, { readStdin: async () => "Mình muốn làm một ứng dụng cho salon" }), 0);
  assert.equal(JSON.parse(logs.at(-1)).action, "START_PRODUCT_GENESIS");
  assert.equal(await main(["product", "discover", "--target", target], { log: (value) => logs.push(value) }), 0);
  assert.equal(JSON.parse(logs.at(-1)).status, "EMPTY");
  assert.equal(await main(["intent", "eval", "--config", configFile, "--fixture", fixtureFile], { log: (value) => logs.push(value) }), 0);
  assert.equal(JSON.parse(logs.at(-1)).status, "PASSED");
});

test("governed task creation routes natural raw ideas through the Product Genesis orchestrator", () => {
  const target = root();
  fs.mkdirSync(path.join(target, ".ai/config"), { recursive: true });
  fs.mkdirSync(path.join(target, ".ai/skills-src/run-product-genesis"), { recursive: true });
  fs.copyFileSync(configFile, path.join(target, ".ai/config/product-intent.json"));
  fs.copyFileSync(path.join(repoRoot, "assets/enterprise-ai-agent-os/.ai/config/skill-routing.json"), path.join(target, ".ai/config/skill-routing.json"));
  fs.cpSync(path.join(repoRoot, "assets/enterprise-ai-agent-os/.ai/skills-src"), path.join(target, ".ai/skills-src"), { recursive: true });
  const task = createTask({ target, id: "RAW-IDEA", goal: "Mình muốn làm một ứng dụng giúp salon giảm khách bỏ hẹn" });
  assert.equal(task.skill_routing.status, "ROUTED");
  assert.equal(task.skill_routing.route_id, "run-product-genesis");
  assert.equal(task.skill_routing.entry_action, "START_PRODUCT_GENESIS");
  assert.equal(task.skill_routing.reason_codes.includes("SIGNAL_CREATION"), true);
  const specification = createTask({ target, id: "WRITE-SPEC", goal: "Write product specification for checkout" });
  assert.equal(specification.skill_routing.status, "ROUTED");
  assert.equal(specification.skill_routing.route_id, "write-product-specification");
  const conflicting = createTask({ target, id: "CONFLICT", goal: "I want to build an app feature in existing code" });
  assert.equal(conflicting.skill_routing.status, "ABSTAIN");
  assert.equal(conflicting.skill_routing.reason, "PRODUCT_INTENT_AMBIGUOUS");
});

test("all twelve adapter instruction paths expose the Conversation Entry Gate", () => {
  const assetRoot = path.join(repoRoot, "assets/enterprise-ai-agent-os");
  const surfaces = {
    claude: "CLAUDE.md",
    codex: "AGENTS.md",
    copilot: ".github/copilot-instructions.md",
    cursor: ".cursor/rules/ai-agent-kit.mdc",
    windsurf: "AGENTS.md",
    gemini: "GEMINI.md",
    amazonq: ".amazonq/rules/ai-agent-kit.md",
    junie: ".junie/AGENTS.md",
    cline: ".clinerules/ai-agent-kit.md",
    devin: "AGENTS.md",
    aider: "CONVENTIONS.md",
    continue: ".continue/rules/ai-agent-kit.md"
  };
  const registry = JSON.parse(fs.readFileSync(path.join(assetRoot, ".ai/adapters/registry.json"), "utf8"));
  assert.deepEqual(new Set(Object.keys(surfaces)), new Set(registry.adapters.map((adapter) => adapter.id)));
  for (const [adapter, relative] of Object.entries(surfaces)) {
    const content = fs.readFileSync(path.join(assetRoot, relative), "utf8");
    assert.match(content, /conversation-entry-gate\.md|Conversation Entry Gate/, `${adapter} does not expose the entry gate`);
  }
});
