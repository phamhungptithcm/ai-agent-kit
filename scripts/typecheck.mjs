import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["bin", "src", "scripts", "test"];
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".mjs")) files.push(full);
  }
}

for (const root of roots) walk(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
}

console.log(`typecheck passed (${files.length} files)`);
