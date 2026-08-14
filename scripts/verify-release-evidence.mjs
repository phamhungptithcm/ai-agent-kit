import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonical = path.join(root, "assets", "enterprise-ai-agent-os");
const manifestFile = path.join(canonical, ".ai", "manifest.yaml");
const manifest = fs.readFileSync(manifestFile, "utf8");
const listed = [...manifest.matchAll(/^\s+-\s+"([^"]+)"\s*$/gm)].map((match) => match[1]);
const missing = listed.filter((relative) => !fs.existsSync(path.join(canonical, relative)));
if (missing.length) throw new Error(`manifest references missing evidence:\n${missing.join("\n")}`);

for (const relative of listed.filter((item) => item.endsWith(".json"))) {
  JSON.parse(fs.readFileSync(path.join(canonical, relative), "utf8"));
}

const required = [
  ".ai/templates/decision-event.schema.json",
  ".ai/templates/run-envelope.schema.json",
  ".ai/templates/plugin-manifest.schema.json",
  ".ai/templates/aakrun.schema.json",
  ".ai/templates/reliability-benchmark.schema.json",
  ".ai/rules/decision-trace-integrity.md",
  ".ai/guards/plugin-activation-gate.yaml"
];
const unlisted = required.filter((item) => !listed.includes(item));
if (unlisted.length) throw new Error(`required release evidence is not in the canonical manifest:\n${unlisted.join("\n")}`);

console.log(`release evidence verified (${listed.length} canonical entries)`);
