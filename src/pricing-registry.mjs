import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent, normalizeRelPath } from "./paths.mjs";

export const BUILT_IN_PRICING_REVISION = "2026-07-30";

const OPENAI_SOURCE = "https://developers.openai.com/api/docs/models/compare";
const ANTHROPIC_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

const BUILT_IN_ENTRIES = [
  {
    provider: "openai",
    model: "gpt-5.6-sol",
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: { input: 5, cached_input: 0.5, output: 30 },
    source: OPENAI_SOURCE
  },
  {
    provider: "openai",
    model: "gpt-5.6-terra",
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: { input: 2, cached_input: 0.2, output: 12 },
    source: OPENAI_SOURCE
  },
  {
    provider: "openai",
    model: "gpt-5.6-luna",
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: { input: 0.2, cached_input: 0.02, output: 1.2 },
    source: OPENAI_SOURCE
  },
  ...["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5"].map((model) => ({
    provider: "anthropic",
    model,
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: {
      input: 5,
      cache_write_5m_input: 6.25,
      cache_write_1h_input: 10,
      cached_input: 0.5,
      output: 25
    },
    source: ANTHROPIC_SOURCE
  })),
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    effective_from: "2026-07-30",
    effective_to: "2026-08-31",
    rates_usd_per_million_tokens: {
      input: 2,
      cache_write_5m_input: 2.5,
      cache_write_1h_input: 4,
      cached_input: 0.2,
      output: 10
    },
    source: ANTHROPIC_SOURCE
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5",
    effective_from: "2026-09-01",
    effective_to: null,
    rates_usd_per_million_tokens: {
      input: 3,
      cache_write_5m_input: 3.75,
      cache_write_1h_input: 6,
      cached_input: 0.3,
      output: 15
    },
    source: ANTHROPIC_SOURCE
  },
  ...["claude-sonnet-4-6", "claude-sonnet-4-5"].map((model) => ({
    provider: "anthropic",
    model,
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: {
      input: 3,
      cache_write_5m_input: 3.75,
      cache_write_1h_input: 6,
      cached_input: 0.3,
      output: 15
    },
    source: ANTHROPIC_SOURCE
  })),
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    effective_from: "2026-07-30",
    effective_to: null,
    rates_usd_per_million_tokens: {
      input: 1,
      cache_write_5m_input: 1.25,
      cache_write_1h_input: 2,
      cached_input: 0.1,
      output: 5
    },
    source: ANTHROPIC_SOURCE
  }
];

function validateScalar(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be a non-empty bounded string`);
  }
  return value.trim();
}

function validateRate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return number;
}

function validateDate(value, name, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const text = validateScalar(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }
  return text;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("pricing entry must be an object");
  }
  const rates = entry.rates_usd_per_million_tokens;
  if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
    throw new Error("pricing entry requires rates_usd_per_million_tokens");
  }
  const normalizedRates = {};
  for (const name of ["input", "cached_input", "cache_write_5m_input", "cache_write_1h_input", "output"]) {
    if (rates[name] != null) normalizedRates[name] = validateRate(rates[name], `pricing rate ${name}`);
  }
  if (normalizedRates.input == null || normalizedRates.output == null) {
    throw new Error("pricing entry requires input and output rates");
  }
  return {
    provider: validateScalar(entry.provider, "pricing provider").toLowerCase(),
    model: validateScalar(entry.model, "pricing model"),
    effective_from: validateDate(entry.effective_from, "pricing effective_from"),
    effective_to: validateDate(entry.effective_to, "pricing effective_to", { nullable: true }),
    rates_usd_per_million_tokens: normalizedRates,
    source: validateScalar(entry.source, "pricing source")
  };
}

export function loadPricingRegistry(options = {}) {
  const builtIn = BUILT_IN_ENTRIES.map(normalizeEntry);
  if (!options.registry) {
    return { revision: BUILT_IN_PRICING_REVISION, entries: builtIn, source: "built-in" };
  }

  const root = path.resolve(options.target ?? process.cwd());
  const relPath = normalizeRelPath(options.registry);
  if (hasSymlinkComponent(root, relPath)) {
    throw new Error("custom pricing registry cannot be read through a symbolic link");
  }
  const file = path.join(root, relPath);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entries)) {
    throw new Error("custom pricing registry requires an entries array");
  }
  const revision = validateScalar(payload.revision, "pricing registry revision");
  const custom = payload.entries.map(normalizeEntry);
  const customKeys = new Set(custom.map((entry) => `${entry.provider}\0${entry.model}\0${entry.effective_from}`));
  return {
    revision,
    entries: [...builtIn.filter((entry) => !customKeys.has(`${entry.provider}\0${entry.model}\0${entry.effective_from}`)), ...custom],
    source: file
  };
}

export function findPricingEntry(registry, provider, model, observedAt) {
  const date = String(observedAt ?? new Date().toISOString()).slice(0, 10);
  return registry.entries
    .filter((entry) => (
      entry.provider === provider
      && entry.model === model
      && entry.effective_from <= date
      && (entry.effective_to == null || entry.effective_to >= date)
    ))
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}

export function usdPerMillionToMicros(value) {
  return Math.round(validateRate(value, "pricing rate") * 1_000_000);
}
