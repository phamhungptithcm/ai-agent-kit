import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { redactSensitive } from "./action-gateway.mjs";
import { buildFinalTaskReport } from "./task-report.mjs";
import { exportEvidence, inspectTask } from "./governed-runtime.mjs";
import { adapterMap, loadAdapterRegistry } from "./adapter-sdk.mjs";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function runGit(root, args, deps = {}) {
  const result = (deps.spawnSync ?? spawnSync)("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function matches(candidate, patterns = []) {
  const value = candidate.replaceAll("\\", "/");
  return patterns.some((pattern) => {
    const clean = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
    return clean.endsWith("/**") ? value === clean.slice(0, -3) || value.startsWith(clean.slice(0, -2)) : value === clean;
  });
}

function safeSummary(value) {
  if (typeof value !== "string" || !value || value.length > 512 || /[\r\n\0]/.test(value)) return "UNAVAILABLE_SENSITIVE_OR_UNBOUNDED";
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return "UNAVAILABLE_SENSITIVE_OR_UNBOUNDED";
  const redacted = redactSensitive(value);
  return redacted === "[REDACTED]" ? "UNAVAILABLE_SENSITIVE_OR_UNBOUNDED" : redacted;
}

export function buildPrEvidencePackage(options, deps = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const task = inspectTask({ target: root, id: options.id });
  const report = buildFinalTaskReport({ target: root, id: options.id, productionTarget: "false", requiredGates: options.requiredGates ?? [] }, deps);
  const evidence = exportEvidence({ target: root, id: options.id });
  const base = options.baseRef ?? "HEAD";
  const names = runGit(root, ["diff", "--name-only", "--no-renames", base, "--"], deps).split("\n").filter(Boolean).sort();
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"], deps).split("\n").filter(Boolean).sort();
  const files = [...new Set([...names, ...untracked])].filter((file) => !file.startsWith(".ai-agent-kit/")).sort();
  const allowed = task.capability?.allowed_paths ?? [];
  const drift = files.filter((file) => !matches(file, allowed));
  const facts = (task.context?.facts ?? []).map((entry) => ({ statement: safeSummary(entry.statement), statement_hash: digest(entry.statement), source_reference: safeSummary(entry.source), source_hash: entry.source ? digest(entry.source) : null, confidence: entry.confidence }));
  const assumptions = (task.context?.assumptions ?? []).map((entry) => ({ statement: safeSummary(entry.statement), statement_hash: digest(entry.statement), confidence: entry.confidence }));
  const ledgerReference = `.ai-agent-kit/runtime/evidence/${task.id}.jsonl`;
  const adapterId = task.capability?.agent_adapter ?? "unknown";
  const registry = loadAdapterRegistry();
  const adapter = adapterMap(registry)[adapterId];
  const output = redactSensitive({
    schema_version: 1,
    task: { id: task.id, goal: task.goal, state: task.state, acceptance_criteria: task.acceptance_criteria, repository_commit: report.task.repository_commit, policy_revision: task.capability?.policy_revision ?? null, adapter: adapterId },
    adapter: adapter ? { sdk_version: registry.sdk_version, capabilities: adapter.capabilities, limitations: adapter.limitations } : { status: "UNRECOGNIZED", limitations: ["No registered adapter capability contract was available for this task."] },
    context: { verified_facts: facts, assumptions },
    change: { files, allowed_paths: allowed, approval_to_diff: { status: drift.length ? "FAILED" : "PASSED", drift } },
    verification: { progress: report.progress, quality: report.quality, final_review: report.final_review, evidence: report.evidence, receipt_reference: ledgerReference, latest_receipt_hash: evidence.verification.latest_receipt_hash },
    risks: { production_readiness: report.production_readiness.status, remaining: report.progress.remaining.map((item) => ({ criterion: item.criterion, status: item.status, summary: item.summary })) },
    logs: { policy: "Referenced by path and digest; raw logs are excluded from this package." }
  });
  output.package_hash = digest(output);
  return output;
}

export function renderPrEvidenceMarkdown(pkg) {
  const criteria = pkg.task.acceptance_criteria.map((criterion, index) => {
    const state = pkg.verification.progress.criteria.find((item) => item.criterion === index + 1)?.status ?? "PENDING";
    return `- [${state === "VERIFIED" ? "x" : " "}] ${criterion} — ${state}`;
  }).join("\n") || "- No acceptance criteria recorded.";
  const files = pkg.change.files.map((file) => `- \`${file}\``).join("\n") || "- No changed files detected.";
  const gates = pkg.verification.quality.gates.map((gate) => `- ${gate.gate}: ${gate.status}`).join("\n") || "- No quality checks recorded.";
  const findings = (pkg.verification.final_review.finding_history ?? pkg.verification.final_review.findings ?? []).map((finding) => `- ${finding.cycle ? `Cycle ${finding.cycle} ` : ""}[${finding.severity}/${finding.status}] ${finding.id}: ${finding.summary}${finding.resolution ? ` — ${finding.resolution}` : ""}`).join("\n") || "- No findings recorded.";
  const adapterLimitations = (pkg.adapter?.limitations ?? []).map((item) => `- ${item}`).join("\n") || "- None declared.";
  return `# AI Change Evidence\n\n## Task\n\n${pkg.task.goal ?? "Goal unavailable."}\n\n- Task: \`${pkg.task.id}\`\n- State: \`${pkg.task.state}\`\n- Commit: \`${pkg.task.repository_commit ?? "UNAVAILABLE"}\`\n- Adapter: \`${pkg.task.adapter}\`\n- Adapter SDK: \`${pkg.adapter?.sdk_version ?? "UNRECOGNIZED"}\`\n\n### Adapter limitations\n\n${adapterLimitations}\n\n## Acceptance criteria\n\n${criteria}\n\n## Changed files\n\n${files}\n\nApproval-to-diff: **${pkg.change.approval_to_diff.status}**\n${pkg.change.approval_to_diff.drift.length ? `\nOut of scope: ${pkg.change.approval_to_diff.drift.map((file) => `\`${file}\``).join(", ")}\n` : ""}\n## Verification\n\n${gates}\n\n- Final implementation review: ${pkg.verification.final_review.status}\n- Review cycles: ${pkg.verification.final_review.cycle_count ?? 0}\n- Evidence integrity: ${pkg.verification.evidence.status}\n- Receipt ledger: \`${pkg.verification.receipt_reference}\`\n- Latest receipt: \`${pkg.verification.latest_receipt_hash ?? "UNAVAILABLE"}\`\n\n### Review findings and fixes\n\n${findings}\n\n## Remaining risk\n\n- Production readiness: ${pkg.risks.production_readiness}\n- Remaining criteria: ${pkg.risks.remaining.length}\n- Raw logs are referenced, not embedded.\n\nPackage hash: \`${pkg.package_hash}\`\n`;
}

export function assertPrEvidenceScope(pkg) {
  if (pkg.change.approval_to_diff.status !== "PASSED") throw new Error(`approval-to-diff scope drift: ${pkg.change.approval_to_diff.drift.join(", ")}`);
  return pkg;
}
