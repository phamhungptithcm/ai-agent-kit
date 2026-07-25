import path from "node:path";
import { requireGitRoot } from "./git.mjs";
import { createRunner } from "./runner.mjs";
import {
  checkCodeGraphAvailability,
  checkCocoIndexAvailability,
  installMissingTools,
  TOOL_SPECS
} from "./tools.mjs";

function shellCommand(parts) {
  return parts
    .map((part) => /^[A-Za-z0-9@._/=:^-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`)
    .join(" ");
}

export function inspectToolPlan(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const toolStatus = {
    codegraph: checkCodeGraphAvailability(runner, root),
    cocoindex: checkCocoIndexAvailability(runner, root)
  };
  return { root, runner, toolStatus };
}

export function renderToolPlan(plan) {
  return `AI Agent Kit Tool Plan

Repository: ${plan.root}

CodeGraph:
- Status: ${plan.toolStatus.codegraph.status}
- Pinned package: ${TOOL_SPECS.codegraph.package}
- Install command: ${shellCommand(TOOL_SPECS.codegraph.installCommand)}

CocoIndex:
- Status: ${plan.toolStatus.cocoindex.status}
- Pinned package: ${TOOL_SPECS.cocoindex.package}
- Install command: ${shellCommand(TOOL_SPECS.cocoindex.installCommand)}

No tools were installed.
No repository files were modified.
Run tools install --apply only after reviewing this plan.`;
}

export function applyToolPlan(options, deps = {}) {
  if (!options.apply) {
    throw new Error("Tool installation changes the user environment. Re-run with tools install --apply.");
  }
  const plan = inspectToolPlan(options, deps);
  const results = installMissingTools(plan.runner, plan.root, plan.toolStatus, true);
  const finalStatus = {
    codegraph: checkCodeGraphAvailability(plan.runner, plan.root),
    cocoindex: checkCocoIndexAvailability(plan.runner, plan.root)
  };
  return { ...plan, results, finalStatus };
}

export function renderToolInstall(result) {
  return `AI Agent Kit Tool Install

Repository: ${result.root}

Actions:
${result.results.map((line) => `- ${line}`).join("\n") || "- Required tools were already present; nothing installed."}

CodeGraph: ${result.finalStatus.codegraph.status}
CocoIndex: ${result.finalStatus.cocoindex.status}

No application source files were modified.
No Git operations were performed.`;
}
