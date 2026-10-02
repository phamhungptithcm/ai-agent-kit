import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { addProductQuestion, answerProductQuestion, createProductWorkspace, inspectProduct, inspectProductDossier, nextProductAction, resumeProduct } from "../src/product-genesis.mjs";

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

function summary(values) {
  const round = (value) => Number(value.toFixed(3));
  return {
    samples: values.length,
    average_ms: round(values.reduce((total, value) => total + value, 0) / values.length),
    p50_ms: round(percentile(values, 0.5)), p95_ms: round(percentile(values, 0.95)), max_ms: round(Math.max(...values))
  };
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    total += entry.isDirectory() ? directoryBytes(item) : fs.lstatSync(item).size;
  }
  return total;
}

const iterationsIndex = process.argv.indexOf("--iterations");
const requested = Number(iterationsIndex >= 0 ? process.argv[iterationsIndex + 1] : 100);
if (!Number.isInteger(requested) || requested < 1 || requested > 400) throw new Error("--iterations must be an integer from 1 to 400");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-benchmark-"));

try {
  createProductWorkspace({ target: root, id: "benchmark-product", idea: "Measure bounded local Product Workspace operations", profile: "LEAN", actor: "benchmark" });
  const reads = [], dossierReads = [], mutations = [];
  for (let index = 0; index < requested; index += 1) {
    let started = performance.now();
    inspectProduct({ target: root, id: "benchmark-product" });
    resumeProduct({ target: root, id: "benchmark-product" });
    nextProductAction({ target: root, id: "benchmark-product" });
    reads.push(performance.now() - started);

    started = performance.now();
    inspectProductDossier({ target: root, id: "benchmark-product" });
    dossierReads.push(performance.now() - started);

    started = performance.now();
    const questionId = `Q-BENCH-${String(index).padStart(4, "0")}`;
    addProductQuestion({ target: root, id: "benchmark-product", questionId, question: `Bounded benchmark decision ${index}?`, rationale: "Measure append and integrity overhead", priority: 0, actor: "benchmark" });
    answerProductQuestion({ target: root, id: "benchmark-product", questionId, answerStatus: "DEFERRED", answer: "Benchmark-only deferred question", actor: "benchmark" });
    mutations.push(performance.now() - started);
  }
  const workspace = path.join(root, ".ai/products/benchmark-product");
  console.log(JSON.stringify({
    schema_version: 1, status: "MEASURED_LOCAL", measured_at: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu_count: os.cpus().length },
    iterations: requested, operations_per_read_sample: 3, operations_per_mutation_sample: 2,
    read_latency: summary(reads), dossier_status_latency: summary(dossierReads), mutation_latency: summary(mutations), workspace_bytes: directoryBytes(workspace),
    limitations: ["Local filesystem benchmark; excludes model inference, research, reviewers, authorized provider verification, network, and GitHub API latency.", "Results are machine- and filesystem-specific and are not a production SLO."]
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
