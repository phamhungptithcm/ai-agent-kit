import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";

const ALLOWED_RUNNERS = new Set(["node", "npm", "python", "python3", "go", "cargo", "mvn", "gradle", "gradlew"]);
const SECRET_NAME = /(token|secret|password|credential|private[_-]?key|api[_-]?key)/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function regularJson(root, file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("failure manifest must remain in a non-symlinked repository path");
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("failure manifest must be a bounded regular file");
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

export function validateFailureManifest(manifest) {
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0 || manifest.cases.length > 50) throw new Error("failure manifest requires 1-50 schema v1 cases");
  const ids = new Set();
  const cases = manifest.cases.map((item) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(item.id ?? "") || ids.has(item.id)) throw new Error("failure case ids must be unique safe identifiers");
    ids.add(item.id);
    if (!Array.isArray(item.command) || item.command.length < 1 || item.command.length > 32 || item.command.some((arg) => typeof arg !== "string" || arg.length > 512 || arg.includes("\0"))) throw new Error(`${item.id}: command must be a bounded argv array`);
    const runner = path.basename(item.command[0]);
    if (!ALLOWED_RUNNERS.has(runner)) throw new Error(`${item.id}: runner ${runner} is not allowed`);
    const args = item.command.slice(1);
    if ((runner === "node" || runner.startsWith("python")) && (!args[0] || args[0].startsWith("-") || !/\.(?:[cm]?js|py)$/.test(args[0]))) throw new Error(`${item.id}: ${runner} requires a repository test file, not inline code or flags`);
    if (runner === "npm" && !["test", "run"].includes(args[0])) throw new Error(`${item.id}: npm is limited to test or run`);
    if (runner === "go" && args[0] !== "test") throw new Error(`${item.id}: go is limited to test`);
    if (runner === "cargo" && args[0] !== "test") throw new Error(`${item.id}: cargo is limited to test`);
    if (runner === "mvn" && !args.some((arg) => ["test", "verify"].includes(arg))) throw new Error(`${item.id}: mvn requires test or verify`);
    if ((runner === "gradle" || runner === "gradlew") && !args.some((arg) => ["test", "check"].includes(arg))) throw new Error(`${item.id}: Gradle requires test or check`);
    if (!Number.isInteger(item.expected_exit_code ?? 0) || (item.expected_exit_code ?? 0) < 0 || (item.expected_exit_code ?? 0) > 255) throw new Error(`${item.id}: invalid expected exit code`);
    if (item.env && (typeof item.env !== "object" || Array.isArray(item.env) || Object.entries(item.env).some(([key, value]) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || SECRET_NAME.test(key) || typeof value !== "string" || value.length > 256))) throw new Error(`${item.id}: env must be bounded and cannot contain secret-like names`);
    return { id: item.id, category: item.category ?? "error-handling", command: item.command, env: item.env ?? {}, expected_exit_code: item.expected_exit_code ?? 0 };
  });
  return { schema_version: 1, cases };
}

export function planFailureLab(options) {
  const root = path.resolve(options.target ?? process.cwd());
  const manifest = validateFailureManifest(regularJson(root, options.manifest));
  for (const item of manifest.cases) {
    const runner = path.basename(item.command[0]);
    if (runner === "node" || runner.startsWith("python")) {
      const script = path.resolve(root, item.command[1]);
      const relative = path.relative(root, script);
      if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative) || !fs.lstatSync(script).isFile()) throw new Error(`${item.id}: test file must be a regular repository file`);
    }
  }
  return { schema_version: 1, status: "PREVIEW", manifest_hash: digest(manifest), case_count: manifest.cases.length, cases: manifest.cases.map(({ id, category, command, expected_exit_code }) => ({ id, category, runner: path.basename(command[0]), expected_exit_code })), executed: false };
}

export function runFailureLab(options, deps = {}) {
  if (!options.apply) throw new Error("failure lab execution requires --apply after reviewing the plan");
  const root = path.resolve(options.target ?? process.cwd());
  const manifest = validateFailureManifest(regularJson(root, options.manifest));
  const run = deps.spawnSync ?? spawnSync;
  const startedAt = new Date().toISOString();
  const results = manifest.cases.map((item) => {
    const result = run(item.command[0], item.command.slice(1), { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...item.env }, encoding: "utf8", timeout: options.timeoutMs ?? 120000, maxBuffer: 1024 * 1024 });
    const actual = Number.isInteger(result.status) ? result.status : null;
    return { id: item.id, category: item.category, status: actual === item.expected_exit_code && !result.error ? "PASSED" : "FAILED", expected_exit_code: item.expected_exit_code, actual_exit_code: actual, timed_out: result.error?.code === "ETIMEDOUT", output_hash: digest({ stdout: result.stdout ?? "", stderr: result.stderr ?? "" }) };
  });
  const report = { schema_version: 1, started_at: startedAt, completed_at: new Date().toISOString(), manifest_hash: digest(manifest), status: results.every((item) => item.status === "PASSED") ? "PASSED" : "FAILED", summary: { total: results.length, passed: results.filter((item) => item.status === "PASSED").length, failed: results.filter((item) => item.status === "FAILED").length }, results };
  report.report_hash = digest(report);
  return report;
}

export function writeFailureReport({ report, target, output }) {
  const root = path.resolve(target ?? process.cwd());
  const local = path.join(root, ".ai-agent-kit");
  if (hasSymlinkComponent(root, ".ai-agent-kit")) throw new Error("failure report must remain in a non-symlinked repository path");
  fs.mkdirSync(local, { recursive: true });
  const ignore = path.join(local, ".gitignore");
  const lines = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8").split(/\r?\n/).filter(Boolean) : [];
  fs.writeFileSync(ignore, `${[...new Set([...lines, "failure-lab/"])].join("\n")}\n`, { mode: 0o644 });
  const absolute = path.resolve(root, output ?? ".ai-agent-kit/failure-lab/latest.json");
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || hasSymlinkComponent(root, relative)) throw new Error("failure report must remain in a non-symlinked repository path");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { status: report.status, file: path.relative(root, absolute), report_hash: report.report_hash, summary: report.summary };
}
