import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasSymlinkComponent } from "./paths.mjs";
import { renderUsageSummary, summarizeUsage } from "./usage-ledger.mjs";
import { inspectFinalReview } from "./final-review.mjs";
import { inspectTeam, reportTeam } from "./team-orchestrator.mjs";

const TASK_STATES = ["DISCOVER", "ANALYZE", "PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING", "REVIEW_READY", "RELEASED"];
const NEXT_STATE = new Map(TASK_STATES.slice(0, -1).map((state, index) => [state, TASK_STATES[index + 1]]));
const CRITERION_STATUSES = new Set(["VERIFIED", "IN_PROGRESS", "PENDING", "BLOCKED", "FAILED", "NOT_APPLICABLE"]);
const CHECK_STATUSES = new Set(["PASSED", "FAILED", "NOT_RUN", "NOT_APPLICABLE", "BLOCKED", "STALE"]);
const DEFAULT_REQUIRED_GATES = ["lint", "typecheck", "tests", "build", "security", "final-implementation-review"];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeId(value, name = "task id") {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) {
    throw new Error(`${name} must be 1-128 safe characters`);
  }
  return value;
}

function boundedScalar(value, name, { required = false, maxLength = 512 } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text || text.length > maxLength || /[\r\n\0]/.test(text)) {
    throw new Error(`${name} must be a bounded single-line value`);
  }
  return text;
}

function privacySafeSummary(value, name) {
  const text = boundedScalar(value, name);
  if (!text) return null;
  const secretLike = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
    /\b(?:api[_ -]?key|authorization|password|secret)\s*[:=]\s*\S+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  ];
  if (secretLike.some((pattern) => pattern.test(text))) {
    throw new Error(`${name} contains secret-like or personal data`);
  }
  return text;
}

function booleanValue(value, name, fallback = true) {
  if (value == null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function positiveNumber(value, name, fallback = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return number;
}

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function runtimeRoot(root) {
  return path.join(root, ".ai-agent-kit", "runtime");
}

function taskPath(root, id) {
  return guardedRuntimePath(root, `tasks/${safeId(id)}.json`);
}

function evidencePath(root, id) {
  return guardedRuntimePath(root, `evidence/${safeId(id)}.jsonl`);
}

function criteriaPath(root, id) {
  return guardedRuntimePath(root, `criteria/${safeId(id)}.jsonl`);
}

function checksPath(root, id) {
  return guardedRuntimePath(root, `checks/${safeId(id)}.jsonl`);
}

function guardedRuntimePath(root, suffix) {
  const relPath = `.ai-agent-kit/runtime/${suffix}`;
  if (hasSymlinkComponent(root, relPath)) {
    throw new Error(`refusing runtime access through a symbolic link: ${relPath}`);
  }
  return path.join(runtimeRoot(root), suffix);
}

function readTask(root, id) {
  const file = taskPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file, label) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`invalid ${label} JSON at line ${index + 1}`);
    }
  });
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function currentCommit(root, deps = {}) {
  const execute = deps.spawnSync ?? spawnSync;
  const result = execute("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function recordCriterionStatus(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const index = Number(options.criterion);
  if (!Number.isInteger(index) || index < 1 || index > task.acceptance_criteria.length) {
    throw new Error(`criterion must be between 1 and ${task.acceptance_criteria.length}`);
  }
  const status = boundedScalar(options.status, "criterion status", { required: true }).toUpperCase();
  if (!CRITERION_STATUSES.has(status)) {
    throw new Error(`criterion status must be one of: ${[...CRITERION_STATUSES].join(", ")}`);
  }
  const evidenceSource = boundedScalar(options.source, "criterion evidence source");
  if (["VERIFIED", "NOT_APPLICABLE"].includes(status) && !evidenceSource) {
    throw new Error(`${status} criterion status requires an evidence source or rationale`);
  }
  const record = {
    version: 1,
    task_id: task.id,
    criterion: index,
    criterion_hash: digest(task.acceptance_criteria[index - 1]),
    status,
    weight: positiveNumber(options.weight, "criterion weight"),
    evidence_source_hash: evidenceSource ? digest(evidenceSource) : null,
    summary: privacySafeSummary(options.summary, "criterion summary"),
    recorded_at: new Date().toISOString()
  };
  record.record_id = digest(record);
  appendJsonl(criteriaPath(root, task.id), record);
  return record;
}

export function recordQualityCheck(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const gate = safeId(boundedScalar(options.gate, "quality gate", { required: true }).toLowerCase(), "quality gate");
  const status = boundedScalar(options.status, "quality check status", { required: true }).toUpperCase();
  if (!CHECK_STATUSES.has(status)) {
    throw new Error(`quality check status must be one of: ${[...CHECK_STATUSES].join(", ")}`);
  }
  const source = boundedScalar(options.source, "quality check evidence source");
  const summary = privacySafeSummary(options.summary, "quality check summary");
  if (status === "PASSED" && !source) throw new Error("PASSED quality check requires an evidence source");
  if (["NOT_RUN", "NOT_APPLICABLE", "BLOCKED", "FAILED"].includes(status) && !summary) {
    throw new Error(`${status} quality check requires a summary or rationale`);
  }
  const exitCode = options.exitCode == null ? null : Number(options.exitCode);
  if (exitCode != null && !Number.isInteger(exitCode)) throw new Error("exit code must be an integer");
  if (status === "PASSED" && exitCode != null && exitCode !== 0) {
    throw new Error("PASSED quality check cannot have a non-zero exit code");
  }
  const record = {
    version: 1,
    task_id: task.id,
    gate,
    status,
    required: booleanValue(options.required, "required", true),
    repository_commit: boundedScalar(options.repositoryCommit, "repository commit") ?? currentCommit(root, options.deps),
    evidence_source_hash: source ? digest(source) : null,
    summary,
    exit_code: exitCode,
    recorded_at: new Date().toISOString()
  };
  record.record_id = digest(record);
  appendJsonl(checksPath(root, task.id), record);
  return record;
}

function latestBy(records, key) {
  const latest = new Map();
  for (const record of records) {
    const value = key(record);
    const current = latest.get(value);
    if (!current || `${record.recorded_at}\0${record.record_id}` > `${current.recorded_at}\0${current.record_id}`) {
      latest.set(value, record);
    }
  }
  return latest;
}

function criterionReport(root, task) {
  const latest = latestBy(readJsonl(criteriaPath(root, task.id), "criterion ledger"), (record) => record.criterion);
  const criteria = task.acceptance_criteria.map((description, offset) => {
    const index = offset + 1;
    const record = latest.get(index);
    const validRecord = record && record.criterion_hash === digest(description) ? record : null;
    return {
      criterion: index,
      description,
      status: validRecord?.status ?? "PENDING",
      weight: validRecord?.weight ?? 1,
      evidence_recorded: Boolean(validRecord?.evidence_source_hash),
      summary: validRecord?.summary ?? null
    };
  });
  const applicable = criteria.filter((criterion) => criterion.status !== "NOT_APPLICABLE");
  const totalWeight = applicable.reduce((sum, criterion) => sum + criterion.weight, 0);
  const verifiedWeight = applicable
    .filter((criterion) => criterion.status === "VERIFIED")
    .reduce((sum, criterion) => sum + criterion.weight, 0);
  return {
    status: criteria.length ? "ASSESSED" : "NOT_ASSESSED",
    percent: totalWeight > 0 ? Math.round(verifiedWeight / totalWeight * 100) : criteria.length ? 100 : null,
    verified: criteria.filter((criterion) => criterion.status === "VERIFIED").length,
    applicable: applicable.length,
    total: criteria.length,
    criteria,
    completed: criteria.filter((criterion) => criterion.status === "VERIFIED"),
    remaining: criteria.filter((criterion) => !["VERIFIED", "NOT_APPLICABLE"].includes(criterion.status))
  };
}

function inspectEvidence(root, task) {
  const receipts = readJsonl(evidencePath(root, task.id), "evidence ledger");
  const errors = [];
  if (digest(task.capability) !== task.capability_hash) errors.push("capability hash mismatch");
  let previous = null;
  for (const receipt of receipts) {
    const claimed = receipt.receipt_hash;
    const copy = { ...receipt };
    delete copy.receipt_hash;
    if (receipt.previous_receipt_hash !== previous) errors.push(`broken previous hash at ${claimed}`);
    if (digest(copy) !== claimed) errors.push(`invalid receipt hash: ${claimed}`);
    previous = claimed;
  }
  let state = "DISCOVER";
  for (const transition of task.transitions ?? []) {
    if (transition.from !== state || NEXT_STATE.get(state) !== transition.to) errors.push("invalid stored transition order");
    state = transition.to;
  }
  if (state !== task.state) errors.push("task state does not match transition history");
  return {
    status: errors.length ? "REJECTED" : "VERIFIED",
    receipt_count: receipts.length,
    latest_receipt_hash: previous,
    errors
  };
}

function inspectGit(root, deps = {}) {
  const execute = deps.spawnSync ?? spawnSync;
  const commit = currentCommit(root, deps);
  const result = execute(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8", timeout: 30000 }
  );
  if (result.status !== 0) {
    return {
      status: "UNKNOWN",
      commit,
      staged: null,
      modified: null,
      untracked: null,
      conflicts: null,
      total_changes: null
    };
  }
  const lines = result.stdout.split("\n").filter(Boolean);
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicts = 0;
  const conflictCodes = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code === "??") untracked += 1;
    else {
      if (code[0] !== " ") staged += 1;
      if (code[1] !== " ") modified += 1;
      if (conflictCodes.has(code)) conflicts += 1;
    }
  }
  return {
    status: lines.length ? "DIRTY" : "CLEAN",
    commit,
    staged,
    modified,
    untracked,
    conflicts,
    total_changes: lines.length
  };
}

function qualityReport(root, task, commit, requiredGates) {
  const latest = latestBy(readJsonl(checksPath(root, task.id), "quality check ledger"), (record) => record.gate);
  const configured = new Set(requiredGates);
  for (const record of latest.values()) {
    if (record.required) configured.add(record.gate);
  }
  const gates = [...new Set([...configured, ...latest.keys()])].sort().map((gate) => {
    const record = latest.get(gate);
    if (!record) {
      return {
        gate,
        status: "NOT_RUN",
        required: configured.has(gate),
        summary: "No current evidence recorded.",
        repository_commit: null,
        evidence_recorded: false
      };
    }
    const stale = record.repository_commit && commit && record.repository_commit !== commit;
    return {
      gate,
      status: stale && record.status === "PASSED" ? "STALE" : record.status,
      required: configured.has(gate) || record.required,
      summary: record.summary,
      repository_commit: record.repository_commit,
      evidence_recorded: Boolean(record.evidence_source_hash)
    };
  });
  const counts = Object.fromEntries([...CHECK_STATUSES].sort().map((status) => [
    status,
    gates.filter((gate) => gate.status === status).length
  ]));
  const knownIssues = gates.some((gate) => ["FAILED", "BLOCKED"].includes(gate.status))
    ? "ISSUES_FOUND"
    : gates.some((gate) => gate.status === "PASSED")
      ? "NONE_FOUND_WITHIN_EXECUTED_CHECKS"
      : "UNKNOWN_NO_PASSED_CHECKS";
  return { gates, counts, known_issues: knownIssues };
}

function productionReadiness(task, progress, evidence, git, quality, finalReview, team, productionTarget) {
  if (!productionTarget) {
    return { status: "NOT_APPLICABLE", blockers: [], rationale: "Task is not a production target." };
  }
  const blockers = [];
  if (!["REVIEW_READY", "RELEASED"].includes(task.state)) {
    blockers.push(`Task state is ${task.state}; REVIEW_READY or RELEASED is required.`);
  }
  if (evidence.status !== "VERIFIED") blockers.push("Evidence integrity is not verified.");
  if (progress.percent !== 100 || progress.status !== "ASSESSED") {
    blockers.push("Acceptance criteria are not 100% verified.");
  }
  if (git.status !== "CLEAN") blockers.push(`Git worktree is ${git.status}.`);
  if (finalReview.status !== "PASSED") blockers.push(`Final implementation review is ${finalReview.status}.`);
  if (team && team.status !== "READY") blockers.push(`Agent workcell is ${team.status}; the latest independent review must complete cleanly.`);
  for (const gate of quality.gates.filter((candidate) => candidate.required)) {
    if (!["PASSED", "NOT_APPLICABLE"].includes(gate.status)) {
      blockers.push(`Required quality gate ${gate.gate} is ${gate.status}.`);
    }
  }
  return {
    status: blockers.length ? "NOT_READY" : "READY",
    blockers,
    rationale: blockers.length
      ? "Production readiness is fail-closed until every blocker has current evidence."
      : "All configured production-readiness gates have current evidence."
  };
}

export function buildFinalTaskReport(options, deps = {}) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const progress = criterionReport(root, task);
  const evidence = inspectEvidence(root, task);
  const git = inspectGit(root, deps);
  const requiredGates = options.requiredGates?.length
    ? options.requiredGates.map((gate) => safeId(String(gate).toLowerCase(), "required gate"))
    : DEFAULT_REQUIRED_GATES;
  const quality = qualityReport(root, task, git.commit, requiredGates);
  const finalReview = inspectFinalReview({ target: root, id: task.id }, deps);
  const finalReviewGate = quality.gates.find((gate) => gate.gate === "final-implementation-review");
  if (finalReviewGate) {
    finalReviewGate.status = finalReview.status === "PASSED" ? "PASSED" : finalReview.status;
    finalReviewGate.summary = finalReview.status === "PASSED"
      ? "Evidence-backed final implementation review passed."
      : `Final implementation review is ${finalReview.status}.`;
    finalReviewGate.repository_commit = finalReview.reviewed_commit ?? null;
    finalReviewGate.evidence_recorded = Boolean(finalReview.review_hash);
  }
  quality.counts = Object.fromEntries([...CHECK_STATUSES].sort().map((status) => [
    status,
    quality.gates.filter((gate) => gate.status === status).length
  ]));
  quality.known_issues = quality.gates.some((gate) => ["FAILED", "BLOCKED", "REJECTED"].includes(gate.status))
    ? "ISSUES_FOUND"
    : quality.gates.some((gate) => gate.status === "PASSED")
      ? "NONE_FOUND_WITHIN_EXECUTED_CHECKS"
      : "UNKNOWN_NO_PASSED_CHECKS";
  const productionTarget = booleanValue(options.productionTarget, "production target", true);
  let team = null;
  try { const contract = inspectTeam({ target: root, id: task.id }); team = { ...reportTeam({ target: root, id: task.id }), state: contract.state }; } catch (error) { if (!/team contract is missing/.test(error.message)) team = { status: "REJECTED", blocker: error.message }; }
  const readiness = productionReadiness(task, progress, evidence, git, quality, finalReview, team, productionTarget);
  let usage;
  try {
    usage = summarizeUsage(options);
  } catch (error) {
    usage = {
      task_id: task.id,
      status: "UNAVAILABLE",
      reason: `usage_reporting_error: ${error instanceof Error ? error.message : String(error)}`,
      event_count: 0,
      usage: null,
      cost: {
        status: "UNAVAILABLE",
        estimated_cost_usd_micros: null,
        actual_billed_cost: "UNAVAILABLE"
      }
    };
  }
  return {
    report_version: 1,
    generated_at: new Date().toISOString(),
    task: {
      id: task.id,
      goal: task.goal,
      state: task.state,
      repository_commit: git.commit,
      adapter: task.capability?.agent_adapter ?? "unknown"
    },
    progress,
    evidence,
    quality,
    final_review: finalReview,
    team,
    code_status: {
      git,
      known_issues: quality.known_issues,
      claim: quality.known_issues === "NONE_FOUND_WITHIN_EXECUTED_CHECKS"
        ? "No known issues were found within the executed checks."
        : "Code health is not fully verified."
    },
    production_readiness: readiness,
    usage
  };
}

function renderCriteria(items, emptyLabel) {
  if (!items.length) return `  - ${emptyLabel}`;
  return items.map((item) => `  - [${item.status}] ${item.criterion}. ${item.description}`).join("\n");
}

function renderQuality(quality) {
  return quality.gates.map((gate) => (
    `  - ${gate.gate}: ${gate.status}${gate.summary ? ` — ${gate.summary}` : ""}`
  )).join("\n") || "  - No quality evidence recorded.";
}

function renderGit(git) {
  if (git.status === "UNKNOWN") return "Git worktree: UNKNOWN";
  if (git.status === "CLEAN") return "Git worktree: CLEAN";
  return `Git worktree: DIRTY — ${git.staged} staged, ${git.modified} modified, ${git.untracked} untracked, ${git.conflicts} conflicts`;
}

function renderFinalReview(review) {
  const dimensions = Object.entries(review.dimensions ?? {}).map(([name, value]) =>
    `  - ${name}: ${value.status} — ${value.summary}`
  );
  const findings = (review.finding_history ?? review.findings ?? []).map((finding) =>
    `  - ${finding.cycle ? `cycle ${finding.cycle} ` : ""}[${finding.severity}/${finding.status}] ${finding.id} at ${finding.location}: ${finding.summary}${finding.resolution ? ` — ${finding.resolution}` : ""}`
  );
  return [
    `Decision: ${review.status}`,
    `Review cycles: ${review.cycle_count ?? 0}`,
    "Reviewed:",
    dimensions.join("\n") || "  - No review dimensions recorded.",
    "Findings and fixes:",
    findings.join("\n") || "  - No findings recorded.",
    "Residual risks:",
    (review.residual_risks ?? []).map((item) => `  - ${item}`).join("\n") || "  - None recorded.",
    "Limitations:",
    (review.limitations ?? []).map((item) => `  - ${item}`).join("\n") || "  - None recorded."
  ].join("\n");
}

export function renderFinalTaskReport(report, { compact = false } = {}) {
  const progress = report.progress.percent == null ? "Unavailable" : `${report.progress.percent}%`;
  if (compact) {
    const completed = `${report.progress.verified}/${report.progress.applicable}`;
    const qualityPassed = report.quality.counts.PASSED ?? 0;
    return [
      `Progress: ${progress} | Production: ${report.production_readiness.status}`,
      renderUsageSummary(report.usage, { compact: true }),
      `Completed: ${completed} | Remaining: ${report.progress.remaining.length} | Blockers: ${report.production_readiness.blockers.length}`,
      `Quality: ${qualityPassed} PASSED | Worktree: ${report.code_status.git.status}`,
      `Team: ${report.team?.team_type ?? "NOT_APPLICABLE"} | ${report.team?.status ?? "NOT_APPLICABLE"} | Context: ${report.team?.context?.status ?? "NOT_APPLICABLE"}`,
      `Final review: ${report.final_review.status} | Cycles: ${report.final_review.cycle_count ?? 0} | Findings: ${report.final_review.finding_history?.length ?? report.final_review.findings?.length ?? 0}`
    ].join("\n");
  }
  return `AI Agent Kit — Final Task Report
Task: ${report.task.id}
State: ${report.task.state}
Commit: ${report.task.repository_commit ?? "Unavailable"}
Generated: ${report.generated_at}

Progress: ${progress} — ${report.progress.verified}/${report.progress.applicable} applicable criteria verified

${renderUsageSummary(report.usage)}

Completed
${renderCriteria(report.progress.completed, "No acceptance criterion is verified.")}

Remaining
${renderCriteria(report.progress.remaining, "No applicable acceptance criterion remains.")}

Quality
${renderQuality(report.quality)}

Final Implementation Review
${renderFinalReview(report.final_review)}

Engineering Team
  Type: ${report.team?.team_type ?? "NOT_APPLICABLE"}
  Execution: ${report.team?.execution_mode ?? "NOT_APPLICABLE"}
  Status: ${report.team?.status ?? "NOT_APPLICABLE"}
  Review independence: ${report.team?.review_independence ?? "NOT_APPLICABLE"}
  Shared context: ${report.team?.context?.status ?? "NOT_APPLICABLE"}
  Handoffs: ${report.team?.context?.handoff_count ?? 0}
  Open conflicts: ${report.team?.context?.open_conflicts ?? 0}

Code Status
  ${renderGit(report.code_status.git)}
  ${report.code_status.claim}

Production Readiness: ${report.production_readiness.status}
  ${report.production_readiness.rationale}

Blockers
${report.production_readiness.blockers.map((blocker) => `  - ${blocker}`).join("\n") || "  - None"}`;
}
