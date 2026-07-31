import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findPricingEntry, loadPricingRegistry, usdPerMillionToMicros } from "./pricing-registry.mjs";
import { hasSymlinkComponent } from "./paths.mjs";

const USAGE_SOURCES = new Set(["provider_response", "adapter_telemetry", "transcript_metadata", "manual"]);
const AGGREGATION_MODES = new Set(["delta", "cumulative"]);
const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeId(value, name = "task id") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) {
    throw new Error(`${name} must be 1-128 safe characters`);
  }
  return value;
}

function boundedScalar(value, name, { required = false, maxLength = 256 } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text || text.length > maxLength || /[\r\n\0]/.test(text)) {
    throw new Error(`${name} must be a bounded single-line value`);
  }
  return text;
}

function count(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_SAFE_COUNT) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return number;
}

function booleanValue(value, name) {
  if (value == null || value === "") return false;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function runtimeRoot(root) {
  return path.join(root, ".ai-agent-kit", "runtime");
}

function taskPath(root, id) {
  return guardedRuntimePath(root, `tasks/${safeId(id)}.json`);
}

function usagePath(root) {
  return guardedRuntimePath(root, "usage/events.jsonl");
}

function guardedRuntimePath(root, suffix) {
  const relPath = `.ai-agent-kit/runtime/${suffix}`;
  if (hasSymlinkComponent(root, relPath)) {
    throw new Error(`refusing runtime access through a symbolic link: ${relPath}`);
  }
  return path.join(runtimeRoot(root), suffix);
}

function requireTask(root, id) {
  const file = taskPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`invalid usage ledger JSON at line ${index + 1}`);
    }
  });
}

function normalizeBuckets(provider, options) {
  const input = count(options.inputTokens, "input tokens");
  const cached = count(options.cachedInputTokens, "cached input tokens");
  const cacheRead = count(options.cacheReadInputTokens, "cache read input tokens");
  const cacheWrite5m = count(
    options.cacheWrite5mInputTokens ?? options.cacheWriteInputTokens,
    "5-minute cache write input tokens"
  );
  const cacheWrite1h = count(options.cacheWrite1hInputTokens, "1-hour cache write input tokens");
  const output = count(options.outputTokens, "output tokens");
  const reasoning = count(options.reasoningTokens, "reasoning tokens");
  if (reasoning > output) throw new Error("reasoning tokens cannot exceed output tokens");

  let uncachedInput = input;
  let cachedInput = cached || cacheRead;
  if (cached && cacheRead) throw new Error("provide cached input tokens or cache read input tokens, not both");
  if (provider === "openai") {
    if (cacheRead || cacheWrite5m || cacheWrite1h) {
      throw new Error("OpenAI usage does not use Anthropic cache read/write token fields");
    }
    if (cached > input) throw new Error("OpenAI cached input tokens cannot exceed input tokens");
    uncachedInput = input - cached;
    cachedInput = cached;
  }
  if (provider === "anthropic") {
    uncachedInput = input;
    cachedInput = cached || cacheRead;
  }

  return {
    uncached_input_tokens: uncachedInput,
    cached_input_tokens: cachedInput,
    cache_write_5m_input_tokens: cacheWrite5m,
    cache_write_1h_input_tokens: cacheWrite1h,
    output_tokens: output,
    reasoning_tokens: reasoning,
    total_tokens: uncachedInput + cachedInput + cacheWrite5m + cacheWrite1h + output
  };
}

export function recordUsage(options) {
  const root = rootFor(options.target);
  const taskId = safeId(options.id);
  requireTask(root, taskId);
  const provider = boundedScalar(options.provider, "provider", { required: true }).toLowerCase();
  const model = boundedScalar(options.model, "model", { required: true });
  const adapter = boundedScalar(options.adapter ?? "unknown", "adapter", { required: true });
  const usageSource = boundedScalar(options.usageSource ?? "manual", "usage source", { required: true });
  if (!USAGE_SOURCES.has(usageSource)) {
    throw new Error(`usage source must be one of: ${[...USAGE_SOURCES].join(", ")}`);
  }
  const aggregationMode = boundedScalar(options.aggregationMode ?? "delta", "aggregation mode", { required: true });
  if (!AGGREGATION_MODES.has(aggregationMode)) {
    throw new Error("aggregation mode must be delta or cumulative");
  }
  const sessionId = boundedScalar(options.sessionId, "session id");
  if (aggregationMode === "cumulative" && !sessionId) {
    throw new Error("cumulative usage requires a session id");
  }
  const observedAt = options.observedAt ? new Date(options.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime())) throw new Error("observed at must be a valid timestamp");
  const recordedAt = new Date().toISOString();
  const buckets = normalizeBuckets(provider, options);
  const event = {
    version: 1,
    task_id: taskId,
    adapter,
    provider,
    model,
    usage_source: usageSource,
    aggregation_mode: aggregationMode,
    session_id_hash: sessionId ? digest(sessionId) : null,
    observed_at: observedAt.toISOString(),
    recorded_at: recordedAt,
    service_tier: boundedScalar(options.serviceTier, "service tier"),
    inference_geo: boundedScalar(options.inferenceGeo, "inference geography"),
    batch: booleanValue(options.batch, "batch"),
    requests: count(options.requests ?? 1, "requests"),
    usage: buckets
  };
  const providerEventId = boundedScalar(options.eventId, "event id", { maxLength: 512 });
  event.event_id = providerEventId
    ? digest({ provider, provider_event_id: providerEventId })
    : digest({
        task_id: taskId,
        adapter,
        provider,
        model,
        aggregation_mode: aggregationMode,
        session_id_hash: event.session_id_hash,
        observed_at: aggregationMode === "delta" ? event.observed_at : null,
        usage: buckets
      });

  const file = usagePath(root);
  const duplicate = readJsonl(file).some((existing) => existing.event_id === event.event_id);
  if (!duplicate) appendJsonl(file, event);
  return {
    status: duplicate ? "DUPLICATE_IGNORED" : "RECORDED",
    task_id: taskId,
    event_id: event.event_id,
    usage: buckets
  };
}

function selectedEvents(events) {
  const deltas = events.filter((event) => event.aggregation_mode !== "cumulative");
  const cumulative = new Map();
  for (const event of events.filter((candidate) => candidate.aggregation_mode === "cumulative")) {
    const key = [
      event.task_id,
      event.adapter,
      event.provider,
      event.model,
      event.session_id_hash,
      event.service_tier,
      event.inference_geo,
      event.batch
    ].join("\0");
    const current = cumulative.get(key);
    if (!current || `${event.observed_at}\0${event.recorded_at}` > `${current.observed_at}\0${current.recorded_at}`) {
      cumulative.set(key, event);
    }
  }
  return [...deltas, ...cumulative.values()];
}

function costForEvent(event, registry) {
  const pricing = findPricingEntry(registry, event.provider, event.model, event.observed_at);
  if (!pricing) {
    return { status: "UNAVAILABLE", reason: "no_exact_pricing_entry", event_id: event.event_id };
  }
  if (event.service_tier && !["default", "standard"].includes(event.service_tier.toLowerCase())) {
    return { status: "UNAVAILABLE", reason: "unsupported_service_tier", event_id: event.event_id };
  }
  const rates = pricing.rates_usd_per_million_tokens;
  const buckets = [
    ["uncached_input_tokens", "input"],
    ["cached_input_tokens", "cached_input"],
    ["cache_write_5m_input_tokens", "cache_write_5m_input"],
    ["cache_write_1h_input_tokens", "cache_write_1h_input"],
    ["output_tokens", "output"]
  ];
  let micros = 0n;
  const components = {};
  for (const [usageName, rateName] of buckets) {
    const tokens = count(event.usage?.[usageName], usageName);
    if (tokens > 0 && rates[rateName] == null) {
      return { status: "UNAVAILABLE", reason: `missing_${rateName}_rate`, event_id: event.event_id };
    }
    const rateMicros = BigInt(usdPerMillionToMicros(rates[rateName] ?? 0));
    const component = (BigInt(tokens) * rateMicros + 500_000n) / 1_000_000n;
    components[usageName] = Number(component);
    micros += component;
  }

  let multiplierPpm = 1_000_000n;
  if (event.batch) multiplierPpm = multiplierPpm * 500_000n / 1_000_000n;
  if (event.provider === "anthropic" && event.inference_geo?.toLowerCase() === "us") {
    multiplierPpm = multiplierPpm * 1_100_000n / 1_000_000n;
  } else if (event.inference_geo && event.inference_geo.toLowerCase() !== "global") {
    return { status: "UNAVAILABLE", reason: "unsupported_inference_geography", event_id: event.event_id };
  }
  micros = (micros * multiplierPpm + 500_000n) / 1_000_000n;
  return {
    status: "ESTIMATED",
    event_id: event.event_id,
    estimated_cost_usd_micros: Number(micros),
    components_usd_micros: components,
    pricing: {
      revision: registry.revision,
      provider: pricing.provider,
      model: pricing.model,
      effective_from: pricing.effective_from,
      effective_to: pricing.effective_to,
      source: pricing.source
    }
  };
}

function emptyTotals() {
  return {
    uncached_input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_5m_input_tokens: 0,
    cache_write_1h_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    requests: 0
  };
}

export function summarizeUsage(options) {
  const root = rootFor(options.target);
  const taskId = safeId(options.id);
  requireTask(root, taskId);
  const events = selectedEvents(readJsonl(usagePath(root)).filter((event) => event.task_id === taskId));
  if (!events.length) {
    return {
      task_id: taskId,
      status: "UNAVAILABLE",
      reason: "no_usage_evidence",
      event_count: 0,
      usage: null,
      cost: {
        status: "UNAVAILABLE",
        estimated_cost_usd_micros: null,
        actual_billed_cost: "UNAVAILABLE",
        reason: "no_usage_evidence"
      }
    };
  }

  const totals = emptyTotals();
  for (const event of events) {
    for (const name of Object.keys(totals).filter((name) => name !== "requests")) {
      totals[name] += count(event.usage?.[name], name);
    }
    totals.requests += count(event.requests, "requests");
  }

  let registry;
  try {
    registry = loadPricingRegistry(options);
  } catch (error) {
    return {
      task_id: taskId,
      status: "AVAILABLE",
      event_count: events.length,
      usage: totals,
      providers: [...new Set(events.map((event) => event.provider))],
      models: [...new Set(events.map((event) => event.model))],
      sources: [...new Set(events.map((event) => event.usage_source))],
      cost: {
        status: "UNAVAILABLE",
        estimated_cost_usd_micros: null,
        actual_billed_cost: "UNAVAILABLE",
        reason: `pricing_registry_error: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
  const costs = events.map((event) => costForEvent(event, registry));
  const estimated = costs.filter((cost) => cost.status === "ESTIMATED");
  const unavailable = costs.filter((cost) => cost.status !== "ESTIMATED");
  const estimatedMicros = estimated.reduce((sum, cost) => sum + cost.estimated_cost_usd_micros, 0);
  return {
    task_id: taskId,
    status: "AVAILABLE",
    event_count: events.length,
    usage: totals,
    providers: [...new Set(events.map((event) => event.provider))],
    models: [...new Set(events.map((event) => event.model))],
    sources: [...new Set(events.map((event) => event.usage_source))],
    cost: {
      status: unavailable.length === 0 ? "ESTIMATED" : estimated.length ? "PARTIAL_ESTIMATE" : "UNAVAILABLE",
      estimated_cost_usd_micros: estimated.length ? estimatedMicros : null,
      actual_billed_cost: "UNAVAILABLE",
      pricing_revision: registry.revision,
      priced_event_count: estimated.length,
      unpriced_event_count: unavailable.length,
      unavailable_reasons: [...new Set(unavailable.map((cost) => cost.reason).filter(Boolean))],
      pricing_sources: [...new Set(estimated.map((cost) => cost.pricing.source))]
    }
  };
}

export function formatUsdMicros(value) {
  if (value == null) return "Unavailable";
  const amount = value / 1_000_000;
  return `$${amount.toFixed(amount >= 0.01 ? 4 : 6).replace(/0+$/, "").replace(/\.$/, "")} USD`;
}

export function renderUsageSummary(summary, { compact = false } = {}) {
  if (summary.status === "UNAVAILABLE") {
    return compact
      ? "Tokens: unavailable | Cost: unavailable"
      : `Usage & Cost\n  Tokens used: Unavailable — ${summary.reason}\n  Estimated cost: Unavailable`;
  }
  const usage = summary.usage;
  const costLabel = summary.cost.status === "ESTIMATED"
    ? `Estimated API cost: ${formatUsdMicros(summary.cost.estimated_cost_usd_micros)}`
    : summary.cost.status === "PARTIAL_ESTIMATE"
      ? `Partial API cost estimate: ${formatUsdMicros(summary.cost.estimated_cost_usd_micros)}`
      : "Estimated API cost: Unavailable";
  if (compact) {
    return `Tokens: ${usage.total_tokens.toLocaleString("en-US")} | ${costLabel}`;
  }
  return `Usage & Cost
  Provider: ${summary.providers.join(", ")}
  Model: ${summary.models.join(", ")}
  Input tokens: ${(usage.uncached_input_tokens + usage.cached_input_tokens + usage.cache_write_5m_input_tokens + usage.cache_write_1h_input_tokens).toLocaleString("en-US")}
    Uncached input: ${usage.uncached_input_tokens.toLocaleString("en-US")}
    Cached input: ${usage.cached_input_tokens.toLocaleString("en-US")}
    5m cache writes: ${usage.cache_write_5m_input_tokens.toLocaleString("en-US")}
    1h cache writes: ${usage.cache_write_1h_input_tokens.toLocaleString("en-US")}
  Output tokens: ${usage.output_tokens.toLocaleString("en-US")}
    Reasoning tokens: ${usage.reasoning_tokens.toLocaleString("en-US")}
  Total tokens used: ${usage.total_tokens.toLocaleString("en-US")}
  ${costLabel}
  Actual billed cost: Unavailable
  Usage source: ${summary.sources.join(", ")}
  Pricing revision: ${summary.cost.pricing_revision ?? "Unavailable"}`;
}
