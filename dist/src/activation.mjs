import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

const PACKAGE_NAME = "@hunpeolabs/ai-agent-kit";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

export const ACTIVATION_ACTIONS = new Map([
  ["1", "preview"],
  ["2", "governed"],
  ["3", "full"],
  ["4", "exit"]
]);

export function renderActivationMenu() {
  return `AI Agent Kit is not activated automatically.

Choose how to import the kit into this project:
  1. Preview import — no files changed
  2. Import governed kit
  3. Import full kit
  4. Exit`;
}

export function renderNonInteractiveActivationHelp() {
  return `${renderActivationMenu()}

Interactive input is unavailable. Run one of:
  ai-agent-kit bootstrap --dry-run
  ai-agent-kit bootstrap --preset governed
  ai-agent-kit bootstrap --preset full`;
}

export async function selectActivationAction({ input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) return null;

  const terminal = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = (await terminal.question("Choose [1-4]: ")).trim();
      const action = ACTIVATION_ACTIONS.get(answer);
      if (action) return action;
      output.write("Enter 1, 2, 3, or 4.\n");
    }
  } finally {
    terminal.close();
  }
}

export function findInstalledDependency(root) {
  const packageJsonPath = path.join(path.resolve(root), "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return DEPENDENCY_FIELDS.find((field) => (
      packageData[field]
      && Object.prototype.hasOwnProperty.call(packageData[field], PACKAGE_NAME)
    )) ?? null;
  } catch {
    return null;
  }
}

export function renderDependencyCleanup(field) {
  return `Kit imported successfully.

${PACKAGE_NAME} is still listed in ${field}, but the imported kit does not need a persistent npm dependency.

After reviewing the generated files, remove it with:
  npm uninstall ${PACKAGE_NAME}`;
}
