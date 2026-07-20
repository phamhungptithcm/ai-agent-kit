import fs from "node:fs";
import path from "node:path";
import { SCAFFOLD_ROOT } from "./assets.mjs";

export const PROMPT_NAMES = [
  "start-task",
  "plan-change",
  "implement-approved",
  "fix-bug",
  "code-quality-review",
  "review-pr",
  "investigate-incident",
  "prepare-handoff"
];

const PROMPT_ALIASES = new Map([
  ["start", "start-task"],
  ["task", "start-task"],
  ["plan", "plan-change"],
  ["change-plan", "plan-change"],
  ["existing-change", "plan-change"],
  ["implement", "implement-approved"],
  ["approved", "implement-approved"],
  ["approved-implementation", "implement-approved"],
  ["bug", "fix-bug"],
  ["bug-fix", "fix-bug"],
  ["quality", "code-quality-review"],
  ["quality-review", "code-quality-review"],
  ["code-quality", "code-quality-review"],
  ["review", "review-pr"],
  ["pr-review", "review-pr"],
  ["incident", "investigate-incident"],
  ["handoff", "prepare-handoff"],
  ["prepare-pr", "prepare-handoff"],
  ["prepare-mr", "prepare-handoff"]
]);

function promptCatalogPath(scaffoldRoot = SCAFFOLD_ROOT) {
  return path.join(scaffoldRoot, ".ai", "PROMPTS.md");
}

export function normalizePromptName(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  if (PROMPT_NAMES.includes(normalized)) return normalized;
  return PROMPT_ALIASES.get(normalized) ?? normalized;
}

export function renderPromptList() {
  return `Available prompts:

${PROMPT_NAMES.map((name) => `- ${name}`).join("\n")}

Examples:
  ai-agent-kit prompt start-task
  ai-agent-kit prompt plan-change
  ai-agent-kit prompt implement-approved

Use 'ai-agent-kit prompts' to print the full catalog.`;
}

export function renderPromptCatalog(scaffoldRoot = SCAFFOLD_ROOT) {
  return fs.readFileSync(promptCatalogPath(scaffoldRoot), "utf8").trimEnd();
}

export function renderNamedPrompt(name, scaffoldRoot = SCAFFOLD_ROOT) {
  const promptName = normalizePromptName(name);
  if (!PROMPT_NAMES.includes(promptName)) {
    throw new Error(`Unknown prompt: ${name}\n\n${renderPromptList()}`);
  }

  const catalog = renderPromptCatalog(scaffoldRoot);
  const lines = catalog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${promptName}`);
  if (start === -1) {
    throw new Error(`Prompt catalog is missing section: ${promptName}`);
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const sectionLines = lines.slice(start + 1, end === -1 ? undefined : end);
  return `# ${promptName}\n\n${sectionLines.join("\n").trimEnd()}`;
}
