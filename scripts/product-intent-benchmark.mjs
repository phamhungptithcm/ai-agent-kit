import { performance } from "node:perf_hooks";

import { classifyProductIntent, loadProductIntentConfig } from "../src/product-intent.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

const iterations = option("--iterations", 1_000);
const budgetMs = option("--p95-budget-ms", 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) throw new Error("iterations must be an integer from 10 to 100000");
if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 10_000) throw new Error("p95 budget must be between 0 and 10000 milliseconds");

const config = loadProductIntentConfig();
const hints = [
  "Mình muốn làm một ứng dụng giúp chủ salon giảm khách bỏ hẹn",
  "I want to build a SaaS inventory product from scratch",
  "Fix the checkout bug and add a regression test",
  "I want to build an app feature in existing code",
  "Explain what the word product means"
];

for (let index = 0; index < 100; index += 1) classifyProductIntent({ hint: hints[index % hints.length], config });
const durations = [];
for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  classifyProductIntent({ hint: hints[index % hints.length], config });
  durations.push(performance.now() - started);
}
durations.sort((left, right) => left - right);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.ceil(value * durations.length) - 1)];
const total = durations.reduce((sum, value) => sum + value, 0);
const report = {
  schema_version: 1,
  status: percentile(0.95) <= budgetMs ? "PASSED" : "FAILED",
  benchmark: "PRODUCT_INTENT_WARM_IN_PROCESS",
  iterations,
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  max_ms: durations.at(-1),
  mean_ms: total / durations.length,
  p95_budget_ms: budgetMs,
  privacy: { contains_prompts: false, persists_prompts: false }
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASSED") process.exitCode = 1;
