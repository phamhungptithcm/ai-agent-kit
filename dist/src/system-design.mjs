import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent } from "./paths.mjs";

const MONTH_SECONDS = 2_592_000;
const DAY_SECONDS = 86_400;
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_PRICE_RESPONSE = 12 * 1024 * 1024;
const PROVENANCE = new Set(["USER_PROVIDED", "REPOSITORY_DETECTED", "CALCULATED", "LIVE_LOOKUP", "ASSUMED", "UNKNOWN"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function canonical(value) { return JSON.stringify(stable(value)); }
export function systemDesignHash(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }

function safeName(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`);
  return value;
}

function inside(root, rel, label = "system-design path") {
  const absolute = path.resolve(root, rel);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error(`${label} must remain inside a non-symlinked repository path`);
  return absolute;
}

export function readSystemDesignJson(root, rel, label = "system-design input") {
  const file = inside(root, rel, label);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT) throw new Error(`${label} must be a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`${label} must contain valid JSON`); }
}

function finite(value, name, { minimum = 0, integer = false, nullable = true } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) throw new Error(`${name} must be ${integer ? "an integer" : "a finite number"} >= ${minimum}`);
  return value;
}

function scalar(value, name, allowed) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 256 || (allowed && !allowed.includes(value))) throw new Error(`${name} is invalid`);
  return value;
}

function safeList(value, name, max = 100) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be an array with at most ${max} entries`);
  return structuredClone(value);
}

function constraint(value, name, { unit, minimum = 0, integer = false } = {}) {
  if (value == null) return { value: null, unit, source: "UNKNOWN", confidence: "unknown", horizon: null };
  if (typeof value === "number") return { value: finite(value, name, { minimum, integer, nullable: false }), unit, source: "USER_PROVIDED", confidence: "medium", horizon: null };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a number or constraint object`);
  const source = value.source ?? "UNKNOWN";
  if (!PROVENANCE.has(source)) throw new Error(`${name}.source is invalid`);
  return {
    value: finite(value.value, `${name}.value`, { minimum, integer }),
    unit: scalar(value.unit ?? unit, `${name}.unit`),
    source,
    confidence: scalar(value.confidence ?? "unknown", `${name}.confidence`, ["high", "medium", "low", "unknown"]),
    horizon: scalar(value.horizon, `${name}.horizon`)
  };
}

export function validateSystemDesignRequest(input) {
  if (input?.request_hash) {
    const copy = structuredClone(input); const claimed = copy.request_hash; delete copy.request_hash;
    if (systemDesignHash(copy) !== claimed) throw new Error("system-design request hash mismatch");
    return input;
  }
  if (!input || input.schema_version !== 1) throw new Error("system-design request schema_version must be 1");
  const workload = input.workload ?? {};
  const service = input.service_levels ?? {};
  const cost = input.cost ?? {};
  const normalized = {
    schema_version: 1,
    id: safeName(input.id ?? "SYSTEM-DESIGN", "system-design id"),
    goal: boundedText(input.goal, "goal"),
    stage: scalar(input.stage ?? "launch", "stage", ["launch", "target", "extreme"]),
    workload: {
      average_rps: constraint(workload.average_rps, "average_rps", { unit: "requests_per_second" }),
      peak_rps: constraint(workload.peak_rps, "peak_rps", { unit: "requests_per_second" }),
      burst_rps: constraint(workload.burst_rps, "burst_rps", { unit: "requests_per_second" }),
      burst_duration_seconds: constraint(workload.burst_duration_seconds, "burst_duration_seconds", { unit: "seconds" }),
      registered_users: constraint(workload.registered_users, "registered_users", { unit: "users", integer: true }),
      peak_active_users: constraint(workload.peak_active_users, "peak_active_users", { unit: "users", integer: true }),
      open_connections: constraint(workload.open_connections, "open_connections", { unit: "connections", integer: true }),
      average_service_time_ms: constraint(workload.average_service_time_ms, "average_service_time_ms", { unit: "milliseconds" }),
      request_bytes: constraint(workload.request_bytes, "request_bytes", { unit: "bytes" }),
      response_bytes: constraint(workload.response_bytes, "response_bytes", { unit: "bytes" }),
      write_rps: constraint(workload.write_rps, "write_rps", { unit: "writes_per_second" }),
      stored_bytes_per_write: constraint(workload.stored_bytes_per_write, "stored_bytes_per_write", { unit: "bytes" }),
      cache_hit_ratio: constraint(workload.cache_hit_ratio, "cache_hit_ratio", { unit: "ratio" }),
      retry_rate: constraint(workload.retry_rate, "retry_rate", { unit: "ratio" })
    },
    service_levels: {
      latency_scope: scalar(service.latency_scope, "latency_scope", ["end_to_end", "server", "dependency"]),
      latency_percentile: scalar(service.latency_percentile, "latency_percentile", ["p50", "p90", "p95", "p99", "p99.9", "maximum"]),
      latency_target_ms: constraint(service.latency_target_ms, "latency_target_ms", { unit: "milliseconds" }),
      availability_percent: constraint(service.availability_percent, "availability_percent", { unit: "percent" }),
      rto_minutes: constraint(service.rto_minutes, "rto_minutes", { unit: "minutes" }),
      rpo_minutes: constraint(service.rpo_minutes, "rpo_minutes", { unit: "minutes" })
    },
    data: input.data ?? {}, security: input.security ?? {}, cost: {
      provider: scalar(cost.provider, "cost.provider", ["aws", "gcp", "azure", "other"]),
      regions: safeList(cost.regions, "cost.regions", 20).map((item) => scalar(item, "cost.region")),
      monthly_ceiling: constraint(cost.monthly_ceiling, "monthly_ceiling", { unit: cost.currency ?? "USD" }),
      currency: scalar(cost.currency ?? "USD", "cost.currency"),
      purchase_model: scalar(cost.purchase_model ?? "on_demand", "cost.purchase_model"),
      items: safeList(cost.items, "cost.items", 100).map((item, index) => ({ name: boundedText(item?.name, `cost.items[${index}].name`), monthly_quantity: finite(item?.monthly_quantity, `cost.items[${index}].monthly_quantity`), unit_price: finite(item?.unit_price, `cost.items[${index}].unit_price`), currency: scalar(item?.currency ?? cost.currency ?? "USD", `cost.items[${index}].currency`), source: scalar(item?.source ?? "UNKNOWN", `cost.items[${index}].source`, [...PROVENANCE]), source_hash: item?.source_hash == null ? null : scalar(item.source_hash, `cost.items[${index}].source_hash`) }))
    },
    delivery: structuredClone(input.delivery ?? {}), facts: safeList(input.facts, "facts"), assumptions: safeList(input.assumptions, "assumptions"), unknowns: safeList(input.unknowns, "unknowns"), conflicts: []
  };
  const value = (item) => item.value;
  const w = normalized.workload;
  if (value(w.average_rps) != null && value(w.peak_rps) != null && value(w.average_rps) > value(w.peak_rps)) normalized.conflicts.push("average_rps exceeds peak_rps");
  if (value(w.peak_rps) != null && value(w.burst_rps) != null && value(w.peak_rps) > value(w.burst_rps)) normalized.conflicts.push("peak_rps exceeds burst_rps");
  for (const item of [w.cache_hit_ratio, w.retry_rate]) if (item.value != null && item.value > 1) normalized.conflicts.push(`${item === w.cache_hit_ratio ? "cache_hit_ratio" : "retry_rate"} exceeds 1`);
  if (normalized.service_levels.availability_percent.value > 100) normalized.conflicts.push("availability_percent exceeds 100");
  if (value(w.peak_rps) != null && !normalized.service_levels.latency_percentile) normalized.unknowns.push("latency_percentile");
  if (value(w.peak_rps) != null && value(w.average_service_time_ms) == null) normalized.unknowns.push("average_service_time_ms");
  if (normalized.cost.items.some((item) => item.source === "LIVE_LOOKUP" && !/^[a-f0-9]{64}$/.test(item.source_hash ?? ""))) normalized.conflicts.push("live cost item lacks a pricing snapshot hash");
  normalized.status = normalized.conflicts.length ? "CONSTRAINTS_CONFLICT" : normalized.unknowns.length ? "INSUFFICIENT_EVIDENCE" : "READY_FOR_REVIEW";
  normalized.request_hash = systemDesignHash(normalized);
  return normalized;
}

export function buildQuickArchitectureRequest(options = {}) {
  const goal = boundedText(options.goal, "goal");
  const id = options.id ?? `ARCH-${systemDesignHash(goal).slice(0, 10).toUpperCase()}`;
  const request = {
    schema_version: 1,
    id,
    goal,
    stage: options.stage ?? "target",
    workload: {
      average_rps: options.averageRps ?? null,
      peak_rps: options.peakRps ?? null,
      peak_active_users: options.concurrentUsers ?? null,
      open_connections: options.openConnections ?? null,
      average_service_time_ms: options.serviceTimeMs ?? null
    },
    service_levels: {
      latency_scope: options.latencyMs == null ? null : "end_to_end",
      latency_percentile: options.latencyMs == null ? null : "p99",
      latency_target_ms: options.latencyMs ?? null,
      availability_percent: options.availability ?? null
    },
    cost: {
      provider: options.provider ?? null,
      regions: options.region ? [options.region] : [],
      monthly_ceiling: options.budget ?? null,
      currency: options.currency ?? "USD"
    },
    facts: [], assumptions: [], unknowns: []
  };
  const normalized = validateSystemDesignRequest(request);
  const questions = [];
  if (normalized.workload.peak_rps.value == null && normalized.workload.open_connections.value == null) questions.push("What is the sustained peak RPS or open-connection target?");
  if (!normalized.service_levels.latency_percentile || normalized.service_levels.latency_target_ms.value == null) questions.push("Which latency percentile and end-to-end target matter?");
  if (!normalized.cost.provider || !normalized.cost.regions.length || normalized.cost.monthly_ceiling.value == null) questions.push("Which provider, region, and monthly budget should constrain the design?");
  return {
    schema_version: 1,
    status: normalized.status,
    request: normalized,
    questions: questions.slice(0, 3),
    next: [
      `ai-agent-kit architecture model --file .ai-agent-kit/architecture/requests/${normalized.id}.json`,
      `ai-agent-kit architecture benchmark-plan --file .ai-agent-kit/architecture/requests/${normalized.id}.json`,
      "Ask the agent to recommend no more than three architecture options and build the selected evidence pack."
    ]
  };
}

export function writeArchitectureRequest({ result, target, output }) {
  const root = path.resolve(target ?? process.cwd()); protectArchitectureOutput(root);
  const file = inside(root, output ?? `.ai-agent-kit/architecture/requests/${result.request.id}.json`, "architecture request output");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("architecture request output cannot be a symbolic link");
  fs.writeFileSync(file, `${JSON.stringify(result.request, null, 2)}\n`, { mode: 0o600 });
  const relative = path.relative(root, file);
  return { ...result, request_file: file, next: result.next.map((item) => item.includes("--file .ai-agent-kit/architecture/requests/") ? item.replace(/--file \S+/, `--file ${relative}`) : item) };
}

export function applyPricingSnapshot(request, snapshot, { itemIndex = 0, monthlyQuantity } = {}) {
  if (!snapshot || !["LIVE_ESTIMATE", "REVIEWED_SNAPSHOT"].includes(snapshot.status) || !/^[a-f0-9]{64}$/.test(snapshot.snapshot_hash ?? "")) throw new Error("pricing snapshot is not reviewed evidence");
  const snapshotCopy = structuredClone(snapshot); const claimed = snapshotCopy.snapshot_hash; delete snapshotCopy.snapshot_hash; delete snapshotCopy.expires_at;
  if (systemDesignHash(snapshotCopy) !== claimed) throw new Error("pricing snapshot hash mismatch");
  const item = snapshot.items?.[itemIndex];
  if (!item) throw new Error("pricing snapshot item does not exist");
  const quantity = finite(monthlyQuantity, "monthly_quantity", { nullable: false });
  if (item.unit_price == null || item.unit_price === "") throw new Error("pricing snapshot item has no unit price");
  const unitPrice = Number(item.unit_price);
  const input = structuredClone(request);
  input.cost ??= {};
  input.cost.items ??= [];
  input.cost.items.push({ name: `${snapshot.provider}:${item.sku ?? item.product ?? itemIndex}`, monthly_quantity: quantity, unit_price: finite(unitPrice, "pricing unit_price", { nullable: false }), currency: item.currency ?? snapshot.currency ?? "USD", source: "LIVE_LOOKUP", source_hash: snapshot.snapshot_hash });
  if (input.request_hash) { delete input.request_hash; input.request_hash = systemDesignHash(input); }
  return input;
}

export function inspectArchitectureWorkspace({ target, repositoryCommit } = {}) {
  const root = path.resolve(target ?? process.cwd());
  const base = inside(root, ".ai-agent-kit/architecture/designs", "architecture designs");
  if (!fs.existsSync(base)) return { schema_version: 1, status: "EMPTY", designs: [], next: "Run ai-agent-kit architecture start --goal <goal>." };
  const designs = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).slice(0, 200).map((entry) => {
    if (entry.isSymbolicLink()) return { id: entry.name, status: "REJECTED", reason: "design directory cannot be a symbolic link" };
    const file = path.join(base, entry.name, "architecture.json");
    if (!fs.existsSync(file)) return { id: entry.name, status: "INCOMPLETE", reason: "architecture.json is missing" };
    try { const artifact = readSystemDesignJson(root, path.relative(root, file), "architecture artifact"); return { id: artifact.id ?? entry.name, ...verifyArchitectureArtifact(artifact, { repositoryCommit }), design_status: artifact.status, generated_at: artifact.generated_at, file: path.relative(root, file) }; } catch (error) { return { id: entry.name, status: "REJECTED", reason: error.message }; }
  });
  return { schema_version: 1, status: designs.some((item) => ["REJECTED", "STALE", "INCOMPLETE"].includes(item.status)) ? "ATTENTION_REQUIRED" : designs.length ? "CURRENT" : "EMPTY", designs };
}

function v(item) { return item?.value ?? null; }
export function calculateSystemDesignModel(request, options = {}) {
  const normalized = request.request_hash ? request : validateSystemDesignRequest(request);
  const w = normalized.workload;
  const peak = v(w.peak_rps), average = v(w.average_rps), burst = v(w.burst_rps), latency = v(w.average_service_time_ms);
  const retryMultiplier = v(w.retry_rate) == null ? 1 : 1 + v(w.retry_rate);
  const cacheMiss = v(w.cache_hit_ratio) == null ? null : 1 - v(w.cache_hit_ratio);
  const effectivePeak = peak == null ? null : peak * retryMultiplier;
  const safeRps = finite(options.tested_safe_rps_per_replica, "tested_safe_rps_per_replica");
  if (safeRps === 0) throw new Error("tested_safe_rps_per_replica must be greater than zero");
  const headroom = finite(options.headroom_factor ?? 1.25, "headroom_factor", { minimum: 1, nullable: false });
  const zoneReserve = finite(options.zone_failure_reserve_factor ?? 1, "zone_failure_reserve_factor", { minimum: 1, nullable: false });
  const minReplicas = finite(options.minimum_replicas ?? 1, "minimum_replicas", { minimum: 1, integer: true, nullable: false });
  const monthlyRequests = average == null ? null : average * MONTH_SECONDS * retryMultiplier;
  const monthlyEgress = monthlyRequests == null || v(w.response_bytes) == null ? null : monthlyRequests * v(w.response_bytes);
  const storageAmplification = finite(options.storage_amplification_factor ?? 1, "storage_amplification_factor", { minimum: 1, nullable: false });
  const retentionDays = finite(options.retention_days, "retention_days", { integer: true });
  const dailyStorage = v(w.write_rps) == null || v(w.stored_bytes_per_write) == null ? null : v(w.write_rps) * v(w.stored_bytes_per_write) * DAY_SECONDS * storageAmplification;
  const replicas = effectivePeak == null || !safeRps ? null : Math.max(minReplicas, Math.ceil(effectivePeak * headroom * zoneReserve / safeRps));
  const burstQueue = burst == null || peak == null || v(w.burst_duration_seconds) == null ? null : Math.max(0, burst - peak) * v(w.burst_duration_seconds);
  const availability = v(normalized.service_levels.availability_percent);
  const monthlyErrorBudgetSeconds = availability == null ? null : MONTH_SECONDS * Math.max(0, 1 - availability / 100);
  const totals = {}; let missingCost = false;
  for (const item of normalized.cost.items) { if (item.monthly_quantity == null || item.unit_price == null) { missingCost = true; continue; } totals[item.currency] = (totals[item.currency] ?? 0) + item.monthly_quantity * item.unit_price; }
  const costStatus = !normalized.cost.items.length || (!Object.keys(totals).length && missingCost) ? "UNAVAILABLE" : missingCost ? "PARTIAL" : "CALCULATED";
  const model = {
    schema_version: 2, request_hash: normalized.request_hash,
    traffic: { monthly_requests: monthlyRequests, retry_multiplier: retryMultiplier, cache_miss_rps: cacheMiss == null || effectivePeak == null ? null : effectivePeak * cacheMiss, burst_queue_items: burstQueue },
    concurrency: { peak_inflight_requests: effectivePeak == null || latency == null ? null : effectivePeak * latency / 1000, open_connections: v(w.open_connections) },
    network: { peak_ingress_bytes_per_second: effectivePeak == null || v(w.request_bytes) == null ? null : effectivePeak * v(w.request_bytes), peak_egress_bytes_per_second: effectivePeak == null || v(w.response_bytes) == null ? null : effectivePeak * v(w.response_bytes), monthly_egress_bytes: monthlyEgress },
    storage: { daily_logical_bytes: dailyStorage, retained_bytes: dailyStorage == null || retentionDays == null ? null : dailyStorage * retentionDays },
    reliability: { monthly_error_budget_seconds: monthlyErrorBudgetSeconds },
    cost: { status: costStatus, monthly_totals: totals, mixed_currency: Object.keys(totals).length > 1, item_count: normalized.cost.items.length },
    capacity: { required_replicas: replicas, status: replicas == null ? "UNAVAILABLE" : "CALCULATED", evidence: replicas == null ? "tested_safe_rps_per_replica is missing" : "benchmark-backed" },
    assumptions: { headroom_factor: headroom, zone_failure_reserve_factor: zoneReserve, storage_amplification_factor: storageAmplification }
  };
  model.model_hash = systemDesignHash(model);
  return model;
}

function cacheRoot(root) {
  protectArchitectureOutput(root);
  const directory = inside(root, ".ai-agent-kit/architecture/pricing", "pricing cache");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function protectArchitectureOutput(root) {
  const runtimeRoot = inside(root, ".ai-agent-kit", "architecture runtime root");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const ignore = path.join(runtimeRoot, ".gitignore");
  if (fs.existsSync(ignore) && fs.lstatSync(ignore).isSymbolicLink()) throw new Error("architecture runtime .gitignore cannot be a symbolic link");
  const current = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
  if (!current.split(/\r?\n/).includes("architecture/")) fs.appendFileSync(ignore, `${current && !current.endsWith("\n") ? "\n" : ""}architecture/\n`, { mode: 0o600 });
}

function boundedText(value, name, max = 256) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) throw new Error(`${name} must be 1-${max} characters`);
  return value;
}

function pricingCacheKey({ provider, region, service, sku, currency }) {
  return `${provider}-${systemDesignHash({ region, service, sku, currency }).slice(0, 24)}.json`;
}

async function boundedJson(response) {
  if (!response.ok) throw new Error(`pricing endpoint returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_PRICE_RESPONSE) throw new Error("pricing response exceeds size limit");
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_PRICE_RESPONSE) { await reader.cancel(); throw new Error("pricing response exceeds size limit"); } chunks.push(value); }
    text = Buffer.concat(chunks.map((item) => Buffer.from(item))).toString("utf8");
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_PRICE_RESPONSE) throw new Error("pricing response exceeds size limit");
  }
  return JSON.parse(text);
}

function priceResult(options, items, sourceUrl, now) {
  const normalized = items.slice(0, 100).map((item) => ({ ...item, provider: options.provider, region: options.region, currency: options.currency ?? "USD", source_url: sourceUrl, retrieved_at: now.toISOString() }));
  const result = { schema_version: 1, status: normalized.length ? "LIVE_ESTIMATE" : "UNAVAILABLE", provider: options.provider, service: options.service, region: options.region, currency: options.currency ?? "USD", items: normalized, source_url: sourceUrl, retrieved_at: now.toISOString() };
  result.snapshot_hash = systemDesignHash(result);
  return result;
}

export async function lookupArchitecturePricing(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const provider = scalar(options.provider, "provider", ["aws", "gcp", "azure"]);
  const region = safeName(options.region, "region");
  const service = boundedText(options.service, "service");
  const sku = options.sku ? boundedText(options.sku, "sku") : null;
  const now = deps.now ?? new Date();
  const cacheFile = path.join(cacheRoot(root), pricingCacheKey({ provider, region, service, sku, currency: options.currency ?? "USD" }));
  if (!options.refresh && fs.existsSync(cacheFile)) {
    const stat = fs.lstatSync(cacheFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT) throw new Error("pricing cache must be a bounded regular file");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const copy = structuredClone(cached); const claimed = copy.snapshot_hash; delete copy.snapshot_hash; delete copy.expires_at;
    if (claimed && systemDesignHash(copy) === claimed && Number.isFinite(Date.parse(cached.expires_at)) && Date.parse(cached.expires_at) > now.getTime()) { const result = { ...cached, status: "REVIEWED_SNAPSHOT" }; delete result.snapshot_hash; delete result.expires_at; result.snapshot_hash = systemDesignHash(result); return { ...result, expires_at: cached.expires_at }; }
  }
  const fetcher = deps.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") return { schema_version: 1, status: "UNAVAILABLE", reason: "network lookup is unavailable", provider, region, service, items: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    let url, items;
    if (provider === "azure") {
      const filter = [`armRegionName eq '${region}'`, `serviceName eq '${service}'`, sku ? `armSkuName eq '${sku}'` : null].filter(Boolean).join(" and ");
      url = `https://prices.azure.com/api/retail/prices?currencyCode='${encodeURIComponent(options.currency ?? "USD")}'&$filter=${encodeURIComponent(filter)}`;
      const body = await boundedJson(await fetcher(url, { signal: controller.signal, redirect: "error" }));
      items = (body.Items ?? []).map((item) => ({ sku: item.armSkuName ?? item.skuName, product: item.productName, unit: item.unitOfMeasure, unit_price: item.retailPrice, effective_date: item.effectiveStartDate, purchase_model: item.type }));
    } else if (provider === "gcp") {
      if (!options.apiKey) return { schema_version: 1, status: "UNAVAILABLE", reason: "GCP catalog lookup requires an API key", provider, region, service, items: [] };
      url = `https://cloudbilling.googleapis.com/v1/services/${encodeURIComponent(service)}/skus`;
      const body = await boundedJson(await fetcher(url, { signal: controller.signal, redirect: "error", headers: { "x-goog-api-key": options.apiKey } }));
      items = (body.skus ?? []).filter((item) => (item.serviceRegions ?? []).includes(region) && (!sku || item.skuId === sku)).map((item) => { const price = item.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice; return { sku: item.skuId, product: item.description, unit: item.pricingInfo?.[0]?.pricingExpression?.usageUnit, unit_price: price ? Number(price.units ?? 0) + Number(price.nanos ?? 0) / 1e9 : null, effective_date: item.pricingInfo?.[0]?.effectiveTime, purchase_model: "catalog" }; });
    } else {
      url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${encodeURIComponent(service)}/current/${encodeURIComponent(region)}/index.json`;
      const body = await boundedJson(await fetcher(url, { signal: controller.signal, redirect: "error" }));
      items = Object.entries(body.products ?? {}).filter(([id]) => !sku || id === sku).flatMap(([id, product]) => Object.values(body.terms?.OnDemand?.[id] ?? {}).flatMap((term) => Object.values(term.priceDimensions ?? {}).map((dimension) => ({ sku: id, product: product.attributes?.instanceType ?? product.productFamily, unit: dimension.unit, unit_price: dimension.pricePerUnit?.[options.currency ?? "USD"] ?? null, effective_date: body.publicationDate, purchase_model: "on_demand" }))));
    }
    const result = priceResult({ ...options, provider, region, service }, items, url.replace(/([?&]key=)[^&]+/, "$1REDACTED"), now);
    const saved = { ...result, expires_at: new Date(now.getTime() + (options.ttlHours ?? 24) * 3600000).toISOString() };
    if (fs.existsSync(cacheFile) && fs.lstatSync(cacheFile).isSymbolicLink()) throw new Error("pricing cache cannot be a symbolic link");
    fs.writeFileSync(cacheFile, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
    return result;
  } catch (error) {
    const reason = error.name === "AbortError" ? "pricing lookup timed out" : String(error.message).replaceAll(options.apiKey ?? "\0", "REDACTED").slice(0, 512);
    return { schema_version: 1, status: "UNAVAILABLE", reason, provider, region, service, items: [] };
  } finally { clearTimeout(timeout); }
}

export function buildBenchmarkPlan(request, options = {}) {
  const normalized = request.request_hash ? request : validateSystemDesignRequest(request);
  const plan = { schema_version: 1, request_hash: normalized.request_hash, environment: options.environment ?? "non-production", approval_required: true, cost_ceiling: options.costCeiling ?? null, workload: { average_rps: v(normalized.workload.average_rps), peak_rps: v(normalized.workload.peak_rps), burst_rps: v(normalized.workload.burst_rps), payload: { request_bytes: v(normalized.workload.request_bytes), response_bytes: v(normalized.workload.response_bytes) } }, phases: ["smoke", "warm-up", "steady", "peak", "burst", "dependency-degradation", "recovery"], required_measurements: ["success_rate", "p50_ms", "p95_ms", "p99_ms", "throughput_rps", "cpu", "memory", "queue_depth", "dependency_errors", "cost"], stop_conditions: ["cost ceiling reached", "error rate exceeds approved threshold", "data integrity risk", "target environment instability"] };
  plan.plan_hash = systemDesignHash(plan);
  return plan;
}

export function importBenchmarkResult(input, request) {
  if (input?.schema_version !== 1 || !input.plan_hash || !input.started_at || !input.completed_at) throw new Error("benchmark result is incomplete");
  const normalized = request.request_hash ? request : validateSystemDesignRequest(request);
  if (input.request_hash !== normalized.request_hash) throw new Error("benchmark result does not match the request");
  const started = Date.parse(input.started_at), completed = Date.parse(input.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed <= started) throw new Error("benchmark timestamps are invalid");
  const metrics = input.metrics ?? {};
  finite(metrics.throughput_rps, "metrics.throughput_rps", { nullable: false });
  finite(metrics.p99_ms, "metrics.p99_ms", { nullable: false });
  finite(metrics.success_rate, "metrics.success_rate", { nullable: false });
  if (metrics.success_rate > 1) throw new Error("metrics.success_rate must not exceed 1");
  const evidence = safeList(input.evidence, "benchmark evidence", 100);
  for (const [index, item] of evidence.entries()) if (!item || typeof item !== "object" || !/^[a-f0-9]{64}$/.test(item.hash ?? "")) throw new Error(`benchmark evidence ${index} requires a SHA-256 hash`);
  const result = { schema_version: 1, request_hash: input.request_hash, plan_hash: input.plan_hash, environment: scalar(input.environment, "environment"), started_at: input.started_at, completed_at: input.completed_at, metrics: { throughput_rps: metrics.throughput_rps, p99_ms: metrics.p99_ms, success_rate: metrics.success_rate }, evidence, status: metrics.success_rate >= 0.99 ? "ACCEPTED" : "REJECTED" };
  result.benchmark_hash = systemDesignHash(result);
  return result;
}

export function buildArchitectureArtifact(input, options = {}) {
  const request = validateSystemDesignRequest(input.request);
  const model = calculateSystemDesignModel(request, input.capacity_options ?? {});
  if (!input.recommendation || !Array.isArray(input.components) || !Array.isArray(input.decisions) || !Array.isArray(input.traceability)) throw new Error("architecture artifact requires recommendation, components, decisions, and traceability");
  for (const [name, value, max] of [["components", input.components, 100], ["decisions", input.decisions, 100], ["traceability", input.traceability, 200]]) if (value.length > max) throw new Error(`${name} exceeds ${max} entries`);
  const artifact = { schema_version: 1, id: safeName(input.id ?? request.id, "architecture id"), generated_at: options.generatedAt ?? new Date().toISOString(), repository_commit: options.repositoryCommit ?? null, status: request.status, request, model, recommendation: input.recommendation, options: (input.options ?? []).slice(0, 3), components: input.components, flows: (input.flows ?? []).slice(0, 100), decisions: input.decisions, security_controls: (input.security_controls ?? []).slice(0, 200), failure_modes: (input.failure_modes ?? []).slice(0, 200), evolution_triggers: (input.evolution_triggers ?? []).slice(0, 100), traceability: input.traceability, validation_plan: (input.validation_plan ?? []).slice(0, 200), limitations: (input.limitations ?? []).slice(0, 100) };
  artifact.artifact_hash = systemDesignHash({ ...artifact, generated_at: null });
  return artifact;
}

export function verifyArchitectureArtifact(artifact, { repositoryCommit } = {}) {
  const copy = structuredClone(artifact); const claimed = copy.artifact_hash; delete copy.artifact_hash; copy.generated_at = null;
  if (!claimed || systemDesignHash(copy) !== claimed) return { status: "REJECTED", reason: "architecture artifact hash mismatch" };
  if (artifact.request?.request_hash !== systemDesignHash((() => { const value = structuredClone(artifact.request); delete value.request_hash; return value; })())) return { status: "REJECTED", artifact_hash: claimed, reason: "request hash mismatch" };
  if (artifact.model?.model_hash !== systemDesignHash((() => { const value = structuredClone(artifact.model); delete value.model_hash; return value; })())) return { status: "REJECTED", artifact_hash: claimed, reason: "model hash mismatch" };
  if (repositoryCommit && artifact.repository_commit && repositoryCommit !== artifact.repository_commit) return { status: "STALE", artifact_hash: claimed, reason: "repository commit changed" };
  return { status: "VERIFIED", artifact_hash: claimed };
}

export function diffArchitectureArtifacts(before, after) {
  const fields = ["request", "recommendation", "components", "decisions", "security_controls", "failure_modes", "evolution_triggers", "traceability", "validation_plan"];
  return { schema_version: 1, before_hash: before.artifact_hash, after_hash: after.artifact_hash, changes: fields.filter((field) => canonical(before[field]) !== canonical(after[field])).map((field) => ({ field, before_hash: systemDesignHash(before[field]), after_hash: systemDesignHash(after[field]) })) };
}

function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function displayNumber(value) { return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : value ?? "UNAVAILABLE"; }
export function renderArchitectureHtml(artifact) {
  const components = artifact.components.map((item) => `<article><b>${esc(item.name ?? item.id)}</b><span>${esc(item.responsibility ?? item.type ?? "component")}</span></article>`).join("");
  const constraints = Object.entries(artifact.request.workload).filter(([, item]) => item.value != null).map(([key, item]) => `<li><b>${esc(key)}</b><span>${esc(item.value)} ${esc(item.unit)}</span></li>`).join("");
  const trace = artifact.traceability.map((item) => `<tr><td>${esc(item.constraint)}</td><td>${esc(item.decision)}</td><td>${esc(item.validation)}</td><td>${esc(item.sli)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>System Design · ${esc(artifact.id)}</title><style>:root{color-scheme:dark;--b:#07111c;--p:#0d1a28;--l:#22364a;--t:#f3f7fb;--m:#94a8bc;--a:#65a9ff;--g:#45d99a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 8% 0,#173b67,transparent 34%),var(--b);color:var(--t);font:15px/1.55 system-ui,sans-serif}.shell{width:min(1160px,calc(100% - 28px));margin:auto;padding:46px 0}.tag{color:var(--a);font-weight:800;letter-spacing:.13em;text-transform:uppercase;font-size:12px}h1{font-size:clamp(34px,6vw,62px);line-height:1;margin:12px 0 18px;letter-spacing:-.05em}.lead{max-width:780px;color:var(--m);font-size:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:26px}.card{background:#0d1a28e8;border:1px solid var(--l);border-radius:18px;padding:22px;overflow:auto}.card h2{margin-top:0}.components{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.components article{border:1px solid var(--l);border-radius:13px;padding:14px}.components span{display:block;color:var(--m);font-size:12px;margin-top:5px}ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--l);padding:9px 0}li span{color:var(--m);text-align:right}table{width:100%;min-width:520px;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:10px;border-bottom:1px solid var(--l)}.ready{color:var(--g)}footer{color:var(--m);font:11px monospace;word-break:break-all;margin-top:18px}@media(max-width:760px){.grid{grid-template-columns:1fr}.components{grid-template-columns:1fr}}</style></head><body><main class="shell"><div class="tag">Constraint-driven system design</div><h1>${esc(artifact.recommendation.title ?? artifact.id)}</h1><p class="lead">${esc(artifact.recommendation.summary ?? artifact.recommendation)}</p><b class="ready">${esc(artifact.status)}</b><section class="grid"><div class="card"><h2>System</h2><div class="components">${components}</div></div><div class="card"><h2>Measured targets</h2><ul>${constraints}</ul></div><div class="card"><h2>Capacity</h2><ul><li><b>Peak in-flight</b><span>${esc(displayNumber(artifact.model.concurrency.peak_inflight_requests))}</span></li><li><b>Required replicas</b><span>${esc(displayNumber(artifact.model.capacity.required_replicas))}</span></li><li><b>Monthly egress</b><span>${esc(displayNumber(artifact.model.network.monthly_egress_bytes))} bytes</span></li></ul></div><div class="card"><h2>Traceability</h2><table><thead><tr><th>Constraint</th><th>Decision</th><th>Validation</th><th>SLI</th></tr></thead><tbody>${trace}</tbody></table></div></section><footer>Architecture ${artifact.artifact_hash}</footer></main></body></html>`;
}

export function writeArchitecturePack({ artifact, target, output }) {
  const root = path.resolve(target ?? process.cwd());
  protectArchitectureOutput(root);
  const directory = inside(root, output ?? `.ai-agent-kit/architecture/designs/${artifact.id}`, "architecture output");
  fs.mkdirSync(directory, { recursive: true });
  const json = path.join(directory, "architecture.json"), html = path.join(directory, "index.html");
  for (const file of [json, html]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("architecture output cannot be a symbolic link");
  fs.writeFileSync(json, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(html, renderArchitectureHtml(artifact), { mode: 0o600 });
  return { status: "GENERATED", directory, files: { json, html }, artifact_hash: artifact.artifact_hash };
}

export function evaluateSystemDesignFixture(fixture) {
  if (fixture?.schema_version !== 1 || !fixture.output) throw new Error("system-design eval fixture is invalid");
  const output = fixture.output;
  const failures = [];
  if (!["READY_FOR_REVIEW", "NEEDS_DECISION", "INSUFFICIENT_EVIDENCE", "CONSTRAINTS_CONFLICT"].includes(output.status)) failures.push("invalid status");
  if (output.status === "PRODUCTION_READY") failures.push("design-only production claim");
  if (output.capacity?.required_replicas != null && !output.capacity?.benchmark_hash) failures.push("replica count lacks benchmark evidence");
  if (output.cost?.status === "LIVE_ESTIMATE" && (!output.cost?.sources?.length || output.cost.sources.some((item) => !item.provider || !item.region || !item.sku || !item.source_url || !item.retrieved_at))) failures.push("live cost lacks provenance");
  if (!output.recommendation || !output.validation_plan?.length || !output.traceability?.length) failures.push("required design evidence is missing");
  if ((fixture.prompt ?? "").match(/concurrent|connection/i) && !output.distinctions?.includes("connections_vs_requests")) failures.push("connections and requests are conflated");
  return { schema_version: 1, fixture_id: fixture.id ?? "unknown", status: failures.length ? "FAILED" : "PASSED", failures };
}
