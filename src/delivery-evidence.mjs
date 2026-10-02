import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeRelPath, hasSymlinkComponent } from "./paths.mjs";
import { stableTeamValue, teamControlDigest } from "./team-control-contract.mjs";

export const deliveryDigest = teamControlDigest;
export const isUntrackedDeliveryDependency = (name) => name.split("/").includes("node_modules");
export function deliveryId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("Delivery identifier must be 1-128 safe characters.");
  return value;
}
export function deliveryText(value, label, max = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`${label} must be non-empty bounded text.`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+\S{8,}|\b(?:password|secret|api[_ -]?key|authorization)\s*[:=]\s*\S+/i.test(value)) throw new Error(`${label} contains secret-like data.`);
  return value.trim();
}
export function deliveryFile(root, relative) {
  const normalized = normalizeRelPath(relative);
  if (normalized !== relative || normalized === "." || /^[A-Za-z]:|^\\\\/.test(relative)) throw new Error("Evidence paths must be canonical repository-relative paths.");
  if (hasSymlinkComponent(root, normalized)) throw new Error("Evidence paths cannot contain symbolic links.");
  const file = path.resolve(root, normalized);
  if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Evidence path escapes the repository.");
  return file;
}
export function readDeliveryFile(root, relative, max = 2 * 1024 * 1024) {
  const file = deliveryFile(root, relative);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("Evidence must be a bounded, non-linked regular file.");
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== stat.size) throw new Error("Evidence changed during read.");
    return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } finally { fs.closeSync(fd); }
}
export function readDeliveryJson(root, relative) { return JSON.parse(readDeliveryFile(root, relative).bytes.toString("utf8")); }
export function writeDeliveryJson(root, relative, value) {
  const file = deliveryFile(root, relative);
  if (fs.existsSync(file)) readDeliveryFile(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("Delivery JSON exceeds its bounded file budget.");
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function deliveryCandidate(root) {
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 || r.error) throw new Error("Candidate Git evidence is unavailable.");
    return r.stdout;
  };
  git(["rev-parse", "--git-dir"]);
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  const commit = head.status === 0 ? head.stdout.trim() : null;
  const diff = commit ? git(["diff", "--binary", "HEAD", "--", ".", ":(exclude).ai-agent-kit"]) : `${git(["diff", "--binary", "--", ".", ":(exclude).ai-agent-kit"])}${git(["diff", "--binary", "--cached", "--", ".", ":(exclude).ai-agent-kit"])}`;
  const names = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter((name) => name && !name.startsWith(".ai-agent-kit/") && !isUntrackedDeliveryDependency(name)).sort();
  const files = names.map((name) => [name, readDeliveryFile(root, name, 16 * 1024 * 1024).sha256]);
  return { commit, signature: deliveryDigest({ diff, untracked: files }) };
}
export function deliveryInput(root, id) {
  const task = readDeliveryJson(root, `.ai-agent-kit/runtime/tasks/${deliveryId(id)}.json`);
  const contractPath = `.ai-agent-kit/product/${id}/contract.json`;
  const contract = fs.existsSync(deliveryFile(root, contractPath)) ? readDeliveryJson(root, contractPath) : null;
  if (task.product_contract) {
    const canonical = readDeliveryJson(root, task.product_contract.path);
    if (deliveryDigest(canonical) !== task.product_contract.hash || deliveryDigest(contract) !== task.product_contract.hash) throw new Error("Product requirements are stale or inconsistent.");
    for (const document of canonical.documents) if (readDeliveryFile(root, document.path).sha256 !== document.sha256) throw new Error("Product document evidence is stale.");
    if (canonical.schema_version === 2) {
      const sources = [...canonical.quality.controls.flatMap((control) => control.sources), ...Object.values(canonical.quality.stack).flatMap((entries) => entries.map((entry) => entry.evidence))];
      for (const source of sources) if (readDeliveryFile(root, source.path).sha256 !== source.sha256) throw new Error("Production control or stack source evidence is stale.");
    }
  }
  const flowPath = `.ai-agent-kit/product/${id}/flow.json`;
  const flow = fs.existsSync(deliveryFile(root, flowPath)) ? readDeliveryJson(root, flowPath) : null;
  const registered = (flow?.documents ?? []).filter((document) => !contract?.documents?.some((bound) => bound.id === document.id));
  for (const document of registered) if (readDeliveryFile(root, document.path).sha256 !== document.sha256) throw new Error("Registered product document evidence is stale.");
  return deliveryDigest({ candidate: deliveryCandidate(root), task: { id: task.id, goal: task.goal, acceptance: task.acceptance_criteria, plan: task.plan, context: task.context, capability_hash: task.capability_hash }, contract, registered_documents: registered });
}
export function deliveryScopeSnapshot(root) {
  const names = (args) => { const result = spawnSync("git", ["ls-files", ...args, "-z"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 }); if (result.status !== 0 || result.error) throw new Error("Scope snapshot is unavailable."); return result.stdout.split("\0").filter(Boolean); };
  const tracked = names(["--cached"]); const untracked = names(["--others", "--exclude-standard"]).filter((name) => !isUntrackedDeliveryDependency(name));
  const entries = {};
  for (const name of [...new Set([...tracked, ...untracked])].filter((item) => !item.startsWith(".ai-agent-kit/")).sort()) {
    const file = deliveryFile(root, name);
    entries[name] = fs.existsSync(file) ? readDeliveryFile(root, name, 16 * 1024 * 1024).sha256 : null;
  }
  return entries;
}
export function evidencePath(id, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash ?? "")) throw new Error("Execution reference must be a SHA-256 receipt hash.");
  return `.ai-agent-kit/runtime/executions/${deliveryId(id)}/${hash}.json`;
}
export function runDeliveryCheck(options) {
  const root = path.resolve(options.target ?? process.cwd()); const id = deliveryId(options.id);
  if (options.authorized !== true) throw new Error("Checks require an explicitly authorized command; document content cannot execute commands.");
  const check = deliveryId(options.check);
  const command = deliveryText(options.command, "Executable", 512);
  const args = options.args ?? [];
  if (!Array.isArray(args) || args.length > 100 || args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))) throw new Error("Check arguments are invalid.");
  deliveryText([command, ...args].join(" "), "Check command", 16384);
  const timeout = Number(options.timeoutMs ?? 120000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) throw new Error("Check timeout must be 1-600000 milliseconds.");
  const inputHash = deliveryInput(root, id);
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024, shell: false });
  let unchanged = false;
  try { unchanged = deliveryInput(root, id) === inputHash; } catch { /* A deleted or changed requirement still produces a stale execution receipt. */ }
  let measurements = [];
  try {
    const output = JSON.parse(String(result.stdout ?? ""));
    if (Array.isArray(output.measurements) && output.measurements.length <= 50) measurements = output.measurements.map((measurement) => {
      if (!Number.isFinite(measurement.value) || measurement.value < 0) throw new Error("Invalid observed measurement.");
      return { id: deliveryId(measurement.id), value: measurement.value, unit: deliveryText(measurement.unit, "Measured unit"), workload: deliveryText(measurement.workload, "Measured workload"), environment: deliveryText(measurement.environment, "Measured environment") };
    });
  } catch { /* Non-metric output remains ordinary command evidence, never a benchmark. */ }
  const record = { schema_version: 1, task_id: id, check_id: check, evidence_level: "LOCAL_EXECUTED", input_hash: inputHash, command_hash: deliveryDigest({ command, args }), measurements, started_at: started, finished_at: new Date().toISOString(), exit_code: result.status, signal: result.signal ?? null, error_code: result.error?.code ?? null, stdout_hash: deliveryDigest(String(result.stdout ?? "")), stderr_hash: deliveryDigest(String(result.stderr ?? "")), status: result.status === 0 && !result.error && unchanged ? "PASSED" : unchanged ? "FAILED" : "STALE", candidate_unchanged: unchanged };
  record.receipt_hash = deliveryDigest(record);
  writeDeliveryJson(root, evidencePath(id, record.receipt_hash), record);
  return record;
}
export function verifyExecutionEvidence(root, id, hash, inputHash, requirePassed = true) {
  const record = readDeliveryJson(root, evidencePath(id, hash));
  const copy = { ...record }; delete copy.receipt_hash;
  if (record.schema_version !== 1 || record.task_id !== id || record.receipt_hash !== hash || deliveryDigest(copy) !== hash) throw new Error("Execution receipt integrity or task binding failed.");
  if (record.input_hash !== inputHash) throw new Error("Execution evidence is stale for the candidate or requirements.");
  if (record.evidence_level !== "LOCAL_EXECUTED" || (requirePassed && (record.status !== "PASSED" || record.exit_code !== 0 || record.error_code || record.signal || !record.candidate_unchanged))) throw new Error("Execution evidence did not pass.");
  return record;
}
export function evidenceManifestHash(value) { return crypto.createHash("sha256").update(JSON.stringify(stableTeamValue(value))).digest("hex"); }
