import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { SCAFFOLD_ROOT } from "./assets.mjs";

const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const PRODUCT_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SIGNAL_GROUPS = Object.freeze([
  "orchestration", "creation", "product", "greenfield", "governance",
  "existing_engineering", "continuation", "explanation"
]);
const DEFAULT_CONFIG = path.join(SCAFFOLD_ROOT, ".ai", "config", "product-intent.json");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rootOf(value) {
  const root = path.resolve(value ?? process.cwd());
  if (!fs.existsSync(root)) throw new Error("intent target does not exist");
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("intent target must be a real directory");
  return root;
}

function readBoundedJson(file, label, maximum = MAX_CONFIG_BYTES, aggregateBudget = null) {
  let before;
  try {
    before = fs.lstatSync(file);
  } catch {
    throw new Error(`${label} must be a bounded non-linked regular JSON file`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > maximum) {
    throw new Error(`${label} must be a bounded non-linked regular JSON file`);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new Error(`${label} must be a bounded non-linked regular JSON file`);
  }
  let content;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum || stat.dev !== before.dev || stat.ino !== before.ino) {
      throw new Error(`${label} must be a bounded non-linked regular JSON file`);
    }
    if (aggregateBudget && stat.size > aggregateBudget.remaining_bytes) {
      throw new Error(`${label} exceeds the aggregate workspace byte budget`);
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (offset !== stat.size || after.size !== stat.size || after.dev !== stat.dev || after.ino !== stat.ino) {
      throw new Error(`${label} changed while it was being read`);
    }
    if (aggregateBudget) aggregateBudget.remaining_bytes -= stat.size;
    content = bytes.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  try { return JSON.parse(content); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) throw new Error(`${field} must contain 1-256 strings`);
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim() || Buffer.byteLength(item) > 256) throw new Error(`${field}[${index}] must be a bounded non-empty string`);
  }
}

export function validateProductIntentConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("product intent config must be an object");
  if (config.schema_version !== 1) throw new Error("product intent config requires schema_version 1");
  if (typeof config.id !== "string" || !config.id.trim()) throw new Error("product intent config requires id");
  if (!Number.isInteger(config.max_hint_bytes) || config.max_hint_bytes < 256 || config.max_hint_bytes > 65_536) throw new Error("product intent max_hint_bytes must be 256-65536");
  if (!Number.isInteger(config.max_workspaces) || config.max_workspaces < 1 || config.max_workspaces > 1_000) throw new Error("product intent max_workspaces must be 1-1000");
  if (!Number.isInteger(config.max_total_workspace_bytes) || config.max_total_workspace_bytes < 256 || config.max_total_workspace_bytes > 512 * 1024 * 1024) throw new Error("product intent max_total_workspace_bytes must be 256-536870912");
  assertStringArray(config.product_stages, "product intent product_stages");
  assertStringArray(config.terminal_stages, "product intent terminal_stages");
  if (new Set(config.product_stages).size !== config.product_stages.length) throw new Error("product intent product_stages must not contain duplicates");
  if (new Set(config.terminal_stages).size !== config.terminal_stages.length || config.terminal_stages.some((stage) => !config.product_stages.includes(stage))) throw new Error("product intent terminal_stages must be unique known product stages");
  if (!config.signals || typeof config.signals !== "object" || Array.isArray(config.signals)) throw new Error("product intent config requires signals");
  const actualGroups = Object.keys(config.signals).sort();
  const expectedGroups = [...SIGNAL_GROUPS].sort();
  if (actualGroups.join("|") !== expectedGroups.join("|")) throw new Error(`product intent signal groups must be exactly: ${expectedGroups.join(", ")}`);
  for (const group of SIGNAL_GROUPS) assertStringArray(config.signals[group], `product intent signals.${group}`);
  return { schema_version: 1, status: "VALID", config_id: config.id, config_hash: digest(config) };
}

export function loadProductIntentConfig(file = DEFAULT_CONFIG) {
  const config = readBoundedJson(path.resolve(file), "product intent config");
  validateProductIntentConfig(config);
  return config;
}

export function loadProductIntentFixture(file) {
  return readBoundedJson(path.resolve(file), "product intent fixture");
}

function configFor(root, requested) {
  if (requested) return loadProductIntentConfig(requested);
  const local = path.join(root, ".ai", "config", "product-intent.json");
  return fs.existsSync(local) ? loadProductIntentConfig(local) : loadProductIntentConfig();
}

function normalizedForms(value) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
  const ascii = normalized.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
  return [normalized, ascii];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesPhrase(forms, phrase) {
  const needles = normalizedForms(phrase);
  return forms.some((form, index) => {
    const needle = needles[index];
    if (!needle) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(needle)}(?=$|[^\\p{L}\\p{N}])`, "u").test(form);
  });
}

function matchedGroups(hint, config) {
  if (typeof hint !== "string" || !hint.trim()) throw new Error("intent hint must be a non-empty string");
  if (Buffer.byteLength(hint.trim()) > config.max_hint_bytes) throw new Error(`intent hint exceeds ${config.max_hint_bytes} bytes`);
  const forms = normalizedForms(hint);
  return Object.fromEntries(SIGNAL_GROUPS.map((group) => [group, config.signals[group].filter((phrase) => includesPhrase(forms, phrase)).length]));
}

function classify(hint, config) {
  const matches = matchedGroups(hint, config);
  const reasons = [];
  for (const group of SIGNAL_GROUPS) if (matches[group] > 0) reasons.push(`SIGNAL_${group.toUpperCase()}`);

  if (matches.explanation && !matches.orchestration && !matches.greenfield) {
    return { status: "ABSTAIN", mode: null, confidence: "low", reason_codes: reasons };
  }
  if (matches.orchestration) {
    return { status: "DETECTED", mode: "PRODUCT_GENESIS", confidence: "high", reason_codes: reasons };
  }
  if (matches.continuation && !matches.existing_engineering) {
    return { status: "DETECTED", mode: "PRODUCT_CONTINUATION", confidence: "high", reason_codes: reasons };
  }

  const productShape = matches.creation > 0 && matches.product > 0;
  const greenfieldShape = matches.greenfield > 0 && (matches.creation > 0 || matches.product > 0);
  const governedShape = matches.governance >= 2 && (matches.creation > 0 || matches.product > 0 || matches.greenfield > 0);
  if (matches.existing_engineering && (productShape || greenfieldShape || governedShape)) {
    return { status: "AMBIGUOUS", mode: null, confidence: "low", reason_codes: [...reasons, "CONFLICT_PRODUCT_AND_EXISTING_SYSTEM"] };
  }
  if (matches.existing_engineering) {
    return { status: "DETECTED", mode: "EXISTING_SYSTEM", confidence: "high", reason_codes: reasons };
  }
  if (greenfieldShape || productShape) {
    return { status: "DETECTED", mode: "PRODUCT_GENESIS", confidence: "high", reason_codes: reasons };
  }
  if (governedShape) {
    return { status: "DETECTED", mode: "PRODUCT_GENESIS", confidence: "medium", reason_codes: reasons };
  }
  if (matches.creation || matches.product || matches.greenfield || matches.governance || matches.continuation) {
    return { status: "AMBIGUOUS", mode: null, confidence: "low", reason_codes: reasons };
  }
  return { status: "ABSTAIN", mode: null, confidence: "low", reason_codes: [] };
}

export function classifyProductIntent({ hint, config = loadProductIntentConfig() }) {
  validateProductIntentConfig(config);
  return { schema_version: 1, ...classify(hint, config) };
}

export function evaluateProductIntent({ config = loadProductIntentConfig(), fixture }) {
  const configReport = validateProductIntentConfig(config);
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture) || fixture.schema_version !== 1) throw new Error("product intent fixture requires schema_version 1");
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 1 || fixture.cases.length > 1_000) throw new Error("product intent fixture requires 1-1000 cases");
  const ids = new Set();
  const cases = fixture.cases.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`product intent fixture case ${index} must be an object`);
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error(`product intent fixture case ${index} id must be unique`);
    ids.add(item.id);
    if (typeof item.hint !== "string" || !item.hint.trim()) throw new Error(`product intent fixture case ${item.id} requires hint`);
    if (!["DETECTED", "AMBIGUOUS", "ABSTAIN"].includes(item.expect_status)) throw new Error(`product intent fixture case ${item.id} has invalid expect_status`);
    if (![null, "PRODUCT_GENESIS", "PRODUCT_CONTINUATION", "EXISTING_SYSTEM"].includes(item.expect_mode)) throw new Error(`product intent fixture case ${item.id} has invalid expect_mode`);
    const actual = classify(item.hint, config);
    const passed = actual.status === item.expect_status && actual.mode === item.expect_mode;
    return { id: item.id, status: passed ? "PASSED" : "FAILED", expected_status: item.expect_status, actual_status: actual.status, expected_mode: item.expect_mode, actual_mode: actual.mode };
  });
  const expectedProduct = cases.filter((item) => item.expected_status === "DETECTED" && item.expected_mode === "PRODUCT_GENESIS");
  const actualProduct = cases.filter((item) => item.actual_status === "DETECTED" && item.actual_mode === "PRODUCT_GENESIS");
  const trueProduct = expectedProduct.filter((item) => item.actual_status === "DETECTED" && item.actual_mode === "PRODUCT_GENESIS");
  const passed = cases.filter((item) => item.status === "PASSED").length;
  const accuracy = passed / cases.length;
  const precision = actualProduct.length ? trueProduct.length / actualProduct.length : 1;
  const recall = expectedProduct.length ? trueProduct.length / expectedProduct.length : 1;
  const thresholds = {
    minimum_accuracy: Number(fixture.thresholds?.minimum_accuracy ?? 1),
    minimum_product_precision: Number(fixture.thresholds?.minimum_product_precision ?? 1),
    minimum_product_recall: Number(fixture.thresholds?.minimum_product_recall ?? 1)
  };
  for (const [field, value] of Object.entries(thresholds)) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`product intent ${field} must be between 0 and 1`);
  const status = accuracy >= thresholds.minimum_accuracy && precision >= thresholds.minimum_product_precision && recall >= thresholds.minimum_product_recall ? "PASSED" : "FAILED";
  return {
    schema_version: 1,
    status,
    fixture_id: fixture.id,
    fixture_hash: digest(fixture),
    config_id: config.id,
    config_hash: configReport.config_hash,
    summary: { total: cases.length, passed, failed: cases.length - passed, accuracy, product_precision: precision, product_recall: recall },
    thresholds,
    failures: cases.filter((item) => item.status === "FAILED")
  };
}

function inspectWorkspaceState(productsRoot, entry, config, aggregateBudget) {
  if (!PRODUCT_ID.test(entry.name)) throw new Error("workspace directory has an invalid product id");
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("workspace must be a real directory");
  const productDirectory = path.join(productsRoot, entry.name);
  const stateFile = path.join(productDirectory, "product.json");
  const state = readBoundedJson(stateFile, `product workspace ${entry.name}`, MAX_STATE_BYTES, aggregateBudget);
  if (state.schema_version !== 1 || state.id !== entry.name || !config.product_stages.includes(state.stage)) throw new Error("workspace state identity or stage is invalid");
  const copy = structuredClone(state);
  const claimed = copy.state_hash;
  delete copy.state_hash;
  if (!claimed || claimed !== digest(copy)) throw new Error("workspace state hash is invalid");
  if (!Number.isFinite(Date.parse(state.updated_at))) throw new Error("workspace updated_at is invalid");
  return {
    id: state.id,
    name: typeof state.name === "string" ? state.name : state.id,
    stage: state.stage,
    profile: state.profile,
    revision: state.revision,
    updated_at: state.updated_at,
    state_hash: claimed,
    lifecycle: config.terminal_stages.includes(state.stage) ? "TERMINAL" : "ACTIVE"
  };
}

function workspaceFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("invalid product id")) return "INVALID_PRODUCT_ID";
  if (message.includes("real directory")) return "UNSAFE_WORKSPACE_DIRECTORY";
  if (message.includes("bounded non-linked")) return "UNSAFE_WORKSPACE_STATE";
  if (message.includes("aggregate workspace byte budget")) return "WORKSPACE_BYTE_BUDGET_EXCEEDED";
  if (message.includes("changed while")) return "WORKSPACE_CHANGED_DURING_READ";
  if (message.includes("not valid JSON")) return "INVALID_WORKSPACE_JSON";
  if (message.includes("identity or stage")) return "INVALID_WORKSPACE_CONTRACT";
  if (message.includes("state hash")) return "INVALID_WORKSPACE_HASH";
  if (message.includes("updated_at")) return "INVALID_WORKSPACE_TIMESTAMP";
  return "UNREADABLE_WORKSPACE_STATE";
}

export function discoverProductWorkspaces(options = {}) {
  const root = rootOf(options.target);
  const config = configFor(root, options.config);
  const configReport = validateProductIntentConfig(config);
  const productsRoot = path.join(root, ".ai", "products");
  if (!fs.existsSync(productsRoot)) {
    return { schema_version: 1, status: "EMPTY", config_id: config.id, config_hash: configReport.config_hash, active_count: 0, terminal_count: 0, invalid_count: 0, products: [], invalid: [] };
  }
  const productsStat = fs.lstatSync(productsRoot);
  if (!productsStat.isDirectory() || productsStat.isSymbolicLink()) throw new Error("product workspace root must be a real directory");
  const entries = fs.readdirSync(productsRoot, { withFileTypes: true })
    .filter((entry) => entry.name !== ".locks")
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > config.max_workspaces) throw new Error(`product workspace count exceeds ${config.max_workspaces}`);
  const products = [], invalid = [];
  const aggregateBudget = { remaining_bytes: config.max_total_workspace_bytes };
  for (const entry of entries) {
    try { products.push(inspectWorkspaceState(productsRoot, entry, config, aggregateBudget)); }
    catch (error) { invalid.push({ id: PRODUCT_ID.test(entry.name) ? entry.name : null, reason: workspaceFailureReason(error) }); }
  }
  products.sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id));
  const active = products.filter((product) => product.lifecycle === "ACTIVE");
  const terminal = products.filter((product) => product.lifecycle === "TERMINAL");
  return {
    schema_version: 1,
    status: invalid.length ? "BLOCKED" : active.length === 0 ? "NO_ACTIVE" : active.length === 1 ? "SINGLE_ACTIVE" : "MULTIPLE_ACTIVE",
    config_id: config.id,
    config_hash: configReport.config_hash,
    active_count: active.length,
    terminal_count: terminal.length,
    invalid_count: invalid.length,
    products,
    invalid
  };
}

function resultBase(config, workspaces, classification) {
  return {
    schema_version: 1,
    detector_id: config.id,
    detector_hash: digest(config),
    status: classification.status,
    mode: classification.mode,
    confidence: classification.confidence,
    reason_codes: classification.reason_codes,
    entry_skill: null,
    action: classification.status,
    requires_confirmation: classification.status === "AMBIGUOUS",
    product_id: null,
    workspace_status: workspaces.status,
    active_product_ids: workspaces.products.filter((product) => product.lifecycle === "ACTIVE").map((product) => product.id),
    privacy: { output_contains_raw_prompt: false, routing_persists_raw_prompt: false }
  };
}

export function detectProductEntry(options = {}) {
  const root = rootOf(options.target);
  const config = configFor(root, options.config);
  const workspaces = discoverProductWorkspaces({ target: root, config: options.config });
  const classification = classify(options.hint, config);
  const result = resultBase(config, workspaces, classification);

  if (classification.mode === "EXISTING_SYSTEM") {
    return { ...result, status: "DETECTED", action: "START_EXISTING_SYSTEM_WORKFLOW", requires_confirmation: false };
  }
  const productIntent = classification.mode === "PRODUCT_GENESIS" || classification.mode === "PRODUCT_CONTINUATION";
  if (!productIntent) return result;
  if (workspaces.status === "BLOCKED") {
    return { ...result, status: "BLOCKED", mode: "PRODUCT_GENESIS", action: "REPAIR_PRODUCT_WORKSPACE", requires_confirmation: true, reason_codes: [...result.reason_codes, "WORKSPACE_INTEGRITY_FAILED"] };
  }
  if (workspaces.active_count > 1) {
    return { ...result, status: "AMBIGUOUS", mode: "PRODUCT_GENESIS", action: "SELECT_PRODUCT", requires_confirmation: true, reason_codes: [...result.reason_codes, "MULTIPLE_ACTIVE_PRODUCTS"] };
  }
  const active = workspaces.products.find((product) => product.lifecycle === "ACTIVE") ?? null;
  if (classification.mode === "PRODUCT_CONTINUATION") {
    if (!active) return { ...result, status: "AMBIGUOUS", mode: "PRODUCT_GENESIS", action: "SELECT_OR_START_PRODUCT", requires_confirmation: true, reason_codes: [...result.reason_codes, "NO_ACTIVE_PRODUCT"] };
    return { ...result, status: "DETECTED", mode: "PRODUCT_GENESIS", entry_skill: "run-product-genesis", action: "RESUME_PRODUCT_GENESIS", requires_confirmation: false, product_id: active.id };
  }
  if (active) {
    return { ...result, status: "AMBIGUOUS", mode: "PRODUCT_GENESIS", entry_skill: "run-product-genesis", action: "SELECT_OR_START_PRODUCT", requires_confirmation: true, product_id: active.id, reason_codes: [...result.reason_codes, "ACTIVE_PRODUCT_EXISTS"] };
  }
  return { ...result, status: "DETECTED", mode: "PRODUCT_GENESIS", entry_skill: "run-product-genesis", action: "START_PRODUCT_GENESIS", requires_confirmation: false };
}
