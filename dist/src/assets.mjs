import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCAFFOLD_CANDIDATES = [
  path.resolve(MODULE_DIR, "..", "assets", "enterprise-ai-agent-os"),
  path.resolve(MODULE_DIR, "..", "..", "assets", "enterprise-ai-agent-os")
];
export const SCAFFOLD_ROOT = SCAFFOLD_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? SCAFFOLD_CANDIDATES[0];

const SKIP_PARTS = new Set(["__pycache__", ".ai-agent-kit", ".codegraph", ".cocoindex_code"]);
const SKIP_SUFFIXES = [".pyc", ".pyo"];

export function loadScaffoldFiles(root = SCAFFOLD_ROOT) {
  const files = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_PARTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (rel.startsWith(".ai/local/") || rel.startsWith(".ai/generated/")) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (!SKIP_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        files.set(rel, fs.readFileSync(full, "utf8"));
      }
    }
  }
  walk(root);
  return files;
}
