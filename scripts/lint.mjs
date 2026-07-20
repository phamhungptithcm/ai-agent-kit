import fs from "node:fs";
import path from "node:path";

const roots = ["bin", "src", "scripts", "test"];
const forbiddenExecutionPatterns = [
  /runner\.run\(["']git["'],\s*\[\s*["']add["']/,
  /runner\.run\(["']git["'],\s*\[\s*["']commit["']/,
  /runner\.run\(["']git["'],\s*\[\s*["']push["']/,
  /runner\.run\(["']git["'],\s*\[\s*["']worktree["']/,
  /runner\.run\(["']git["'],\s*\[\s*["']checkout["']/,
  /runner\.run\(["']git["'],\s*\[\s*["']switch["']/,
  /fetch\([^)]*gitlab/i,
  /fetch\([^)]*jira/i,
  /fetch\([^)]*atlassian/i
];
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(mjs|md|json)$/.test(entry.name)) files.push(full);
  }
}

for (const root of roots) walk(root);

const errors = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\t")) errors.push(`${file}: contains tab indentation`);
  for (const pattern of forbiddenExecutionPatterns) {
    if (pattern.test(text) && !file.endsWith("lint.mjs")) {
      errors.push(`${file}: contains forbidden execution pattern ${pattern}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`lint passed (${files.length} files)`);
