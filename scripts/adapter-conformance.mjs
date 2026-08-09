import path from "node:path";
import { evaluateAdapterConformance, loadAdapterRegistry } from "../src/adapter-sdk.mjs";
import { evaluateStandardsConformance } from "../src/standards-conformance.mjs";

const root = path.resolve("assets/enterprise-ai-agent-os");
const registry = loadAdapterRegistry();
const adapters = registry.adapters.map((adapter) => evaluateAdapterConformance({ adapterId: adapter.id, root, registry }));
const standards = evaluateStandardsConformance({ root });
const result = {
  schema_version: 1,
  status: adapters.every((adapter) => adapter.status === "PASSED") && standards.status === "PASSED" ? "PASSED" : "FAILED",
  adapters: adapters.map(({ adapter, status }) => ({ adapter, status })),
  standards: standards.status
};

console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASSED") process.exitCode = 1;
