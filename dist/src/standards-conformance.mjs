import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_CANDIDATES = [
  path.resolve(MODULE_DIR, "..", "assets", "enterprise-ai-agent-os"),
  path.resolve(MODULE_DIR, "..", "..", "assets", "enterprise-ai-agent-os")
];
export const STANDARDS_SCAFFOLD_ROOT = SCAFFOLD_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? SCAFFOLD_CANDIDATES[0];
const ALLOWED_SKILL_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseSkillFrontmatter(text, file = "SKILL.md") {
  if (!text.startsWith("---\n")) throw new Error(`${file} must start with YAML frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${file} has unterminated YAML frontmatter`);
  const fields = {};
  let nested = false;
  for (const line of text.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      if (!nested) throw new Error(`${file} has unsupported nested frontmatter`);
      continue;
    }
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`${file} has invalid frontmatter line: ${line}`);
    const [, key, rawValue] = match;
    if (!ALLOWED_SKILL_FIELDS.has(key)) throw new Error(`${file} uses non-standard frontmatter field: ${key}`);
    if (Object.hasOwn(fields, key)) throw new Error(`${file} repeats frontmatter field: ${key}`);
    fields[key] = parseScalar(rawValue);
    nested = key === "metadata" && rawValue.trim() === "";
  }
  return { fields, body: text.slice(end + 5) };
}

function skillFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "SKILL.md"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function validateSkill(file) {
  const text = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const { fields, body } = parseSkillFrontmatter(text, file);
  const directory = path.basename(path.dirname(file));
  const failures = [];
  if (!SKILL_NAME.test(fields.name ?? "") || fields.name.length > 64) failures.push("name must use 1-64 lowercase letters, digits, and hyphens");
  if (fields.name !== directory) failures.push("name must match the parent directory");
  if (!fields.description || fields.description.length > 1024) failures.push("description must contain 1-1024 characters");
  if (!body.trim()) failures.push("body must not be empty");
  if (text.split("\n").length > 500) failures.push("SKILL.md exceeds the 500-line progressive-disclosure limit");
  return { file, status: failures.length === 0 ? "PASSED" : "FAILED", failures };
}

export function loadStandardsCompatibility(root = STANDARDS_SCAFFOLD_ROOT) {
  const file = path.join(root, ".ai", "standards", "compatibility.json");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.schema_version !== 1) throw new Error("Standards compatibility schema_version must be 1");
  if (value.namespace !== "dev.hunpeolabs.ai-agent-kit") throw new Error("Standards extensions must use the documented namespace");
  if (value.standards?.mcp?.version !== "2026-07-28") throw new Error("MCP compatibility version must be explicit");
  if (value.standards?.a2a?.version !== "0.3.0") throw new Error("A2A compatibility version must be explicit");
  if (value.standards?.a2a?.required_for_single_agent !== false || value.standards?.a2a?.runtime_enabled !== false) throw new Error("A2A must remain optional and disabled by default");
  return value;
}

export function evaluateStandardsConformance({ root = STANDARDS_SCAFFOLD_ROOT } = {}) {
  const compatibility = loadStandardsCompatibility(root);
  const skills = skillFiles(path.join(root, compatibility.standards.agent_skills.skill_root)).map(validateSkill);
  const mcpRegistry = JSON.parse(fs.readFileSync(path.join(root, compatibility.standards.mcp.trust_registry), "utf8"));
  const checks = [
    { id: "agent-skills:bundles", status: skills.length > 0 && skills.every((skill) => skill.status === "PASSED") ? "PASSED" : "FAILED", details: skills },
    { id: "mcp:explicit-version", status: compatibility.standards.mcp.version ? "PASSED" : "FAILED" },
    { id: "mcp:zero-trust-registry", status: mcpRegistry && typeof mcpRegistry === "object" ? "PASSED" : "FAILED" },
    { id: "a2a:optional-single-agent", status: compatibility.standards.a2a.required_for_single_agent === false ? "PASSED" : "FAILED" },
    { id: "a2a:runtime-disabled", status: compatibility.standards.a2a.runtime_enabled === false ? "PASSED" : "FAILED" },
    { id: "extensions:namespaced", status: compatibility.namespace === "dev.hunpeolabs.ai-agent-kit" ? "PASSED" : "FAILED" }
  ];
  return {
    schema_version: 1,
    status: checks.every((check) => check.status === "PASSED") ? "PASSED" : "FAILED",
    retrieved_on: compatibility.retrieved_on,
    standards: compatibility.standards,
    checks
  };
}
