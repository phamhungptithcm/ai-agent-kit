import crypto from "node:crypto";

const TEAM_TYPES = new Set(["SOLO", "PRODUCT_WORKCELL", "BUG_WORKCELL", "ASSURANCE_WORKCELL"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function corpus(task, goal, paths) {
  return [
    goal,
    ...paths,
    ...(task.context?.facts ?? []).flatMap((item) => [item.statement, item.source]),
    ...(task.context?.assumptions ?? []).flatMap((item) => [item.statement, item.source])
  ].filter(Boolean).join(" ").toLowerCase();
}

export function compileTeamSignals({ task, goal, paths, risk }) {
  const text = corpus(task, goal, paths);
  const areas = [...new Set(paths.map((item) => item.split(/[\\/]/)[0]).filter(Boolean))];
  const tests = paths.some((item) => /(^|\/)(test|tests|spec|__tests__|e2e)(\/|$)|\.(test|spec)\./i.test(item));
  const docsOnly = paths.length > 0 && paths.every((item) => /(^|\/)docs?(\/|$)|\.md$/i.test(item));
  const signals = {
    risk,
    area_count: areas.length,
    path_count: paths.length,
    docs_only: docsOnly,
    tests,
    bug: /\bbug\b|\bfix\b|defect|regression|incident|crash|broken|incorrect|failure|root cause/.test(text),
    feature: /feature|implement|build|add|create|refactor|architecture|api|website|capability/.test(text),
    security: /auth|security|permission|tenant|secret|credential|pii|pci|oauth|jwt|role/.test(text),
    payment: /payment|billing|invoice|ledger|financial|reconciliation/.test(text),
    migration: /migration|schema|database|transaction|backfill|ddl|prisma|alembic|db\/migrate/.test(text),
    api: /\bapi\b|endpoint|controller|route|graphql|openapi|swagger|contract/.test(text),
    concurrency: /concurr|race|thread|lock|atomic|idempoten|queue|worker/.test(text),
    infrastructure: /infrastructure|deploy|production|terraform|kubernetes|docker|ci\/cd|\.github\/workflows/.test(text),
    performance: /performance|latency|throughput|cache|n\+1|batch|memory|cpu/.test(text),
    frontend: /frontend|visual|accessibility|component|\.tsx|\.jsx|\.vue|\.svelte|\.css/.test(text),
    trivial_docs: paths.length <= 1 && /typo|spelling|copy edit|formatting|small documentation/.test(text)
  };
  return { ...signals, signal_hash: digest(signals) };
}

export function classifyTeam({ signals, shape }) {
  if (shape) {
    const selected = shape.toUpperCase();
    if (!TEAM_TYPES.has(selected)) throw new Error("team shape is invalid");
    return { team_type: selected, reasons: ["explicit team shape"] };
  }
  const assurance = [signals.security, signals.payment, signals.migration, signals.concurrency, signals.infrastructure].some(Boolean);
  if (["high", "critical"].includes(String(signals.risk).toLowerCase()) || assurance) return { team_type: "ASSURANCE_WORKCELL", reasons: [["high", "critical"].includes(String(signals.risk).toLowerCase()) ? "high task risk" : "security, data, concurrency, or operational boundary"] };
  if (signals.trivial_docs) return { team_type: "SOLO", reasons: ["bounded documentation-only task"] };
  if (signals.bug) return { team_type: "BUG_WORKCELL", reasons: ["bug or failure intent"] };
  if (signals.area_count > 1 || signals.feature) return { team_type: "PRODUCT_WORKCELL", reasons: [signals.area_count > 1 ? "multiple approved change areas" : "feature or architecture intent"] };
  return { team_type: "SOLO", reasons: ["bounded low-complexity task"] };
}

function assignment(id, role, objective, options = {}) {
  return {
    id,
    role,
    objective,
    write_access: Boolean(options.write),
    allowed_paths: options.paths ?? [],
    depends_on: options.dependsOn ?? [],
    required: options.required !== false,
    blocking: options.blocking !== false,
    phase: options.phase ?? "DISCOVERY",
    status: "PENDING",
    evidence_hashes: [],
    finding_count: 0,
    attempts: 0,
    max_attempts: options.maxAttempts ?? 2,
    execution: { state: "PENDING", spawn_id: null, external_run_id: null, claim_id: null, agent_id: null, last_heartbeat_at: null }
  };
}

function reviewer(paths, dependencies) {
  return assignment("independent-reviewer", "Independent Code Reviewer", "Review requirement match, correctness, bad paths, security, production readiness, and trade-offs independently.", { paths, dependsOn: dependencies, phase: "REVIEW" });
}

function postSpecialists(signals, paths) {
  const candidates = [];
  if (signals.security || signals.payment) candidates.push(assignment("security-reviewer", "Security Reviewer", "Review threats, authorization, sensitive data, abuse, payment boundaries, and supply-chain risk.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE" }));
  if (signals.migration) candidates.push(assignment("data-migration-reviewer", "Data Migration Reviewer", "Review compatibility, reversibility, transaction safety, rollout order, backfill behavior, and data-loss risk.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE" }));
  if (signals.api) candidates.push(assignment("api-contract-reviewer", "API Contract Reviewer", "Review request and response contracts, compatibility, validation, authorization, idempotency, and consumer impact.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE", required: false, blocking: false }));
  if (signals.performance || signals.concurrency) candidates.push(assignment("performance-reviewer", "Performance and Concurrency Reviewer", "Review latency, batching, resource use, concurrency safety, locking, retries, and load-sensitive failure modes.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE", required: signals.concurrency, blocking: signals.concurrency }));
  if (signals.frontend) candidates.push(assignment("design-reviewer", "Design and Accessibility Reviewer", "Review usability, visual integrity, responsive behavior, accessibility, motion safety, and important UI states.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE", required: false, blocking: false }));
  return candidates;
}

export function buildTeamAssignments({ type, paths, signals, maxAgents }) {
  const implementer = assignment("implementation-engineer", "Implementation Engineer", type === "BUG_WORKCELL" ? "Implement the smallest approved root-cause fix." : "Implement only the approved scope and focused verification.", { write: true, paths, phase: "IMPLEMENTATION" });
  if (type === "SOLO" || maxAgents === 2) return [implementer, reviewer(paths, ["implementation-engineer"])];

  const discovery = type === "BUG_WORKCELL"
    ? [assignment("investigator", "Domain Analyst", "Reproduce the failure and identify the first incorrect state."), assignment("impact-explorer", "Impact Explorer", "Trace callers, consumers, regressions, and preserved behavior.")]
    : type === "ASSURANCE_WORKCELL"
      ? [assignment("impact-explorer", "Impact Explorer", "Map scope, contracts, data, tests, and operational blast radius."), assignment("solution-architect", "Solution Architect", "Check boundaries, alternatives, failure behavior, compatibility, and rollback.")]
      : [assignment("domain-analyst", "Domain Analyst", "Verify the outcome, requirements, and preserved behavior."), assignment("impact-explorer", "Impact Explorer", "Map code, data, tests, and downstream impact.")];

  implementer.depends_on = discovery.map((item) => item.id);
  const qa = assignment("qa-lead", "QA Lead", "Validate acceptance criteria, regressions, failure paths, recovery, and evidence.", { paths, dependsOn: ["implementation-engineer"], phase: "ASSURANCE" });
  const specialists = postSpecialists(signals, paths);
  const requiredCore = [implementer, qa];
  const reserved = requiredCore.length + 1;
  let remaining = Math.max(0, maxAgents - reserved);
  const selectedDiscovery = discovery.slice(0, Math.min(1, remaining)); remaining -= selectedDiscovery.length;
  const selectedRequiredSpecialists = specialists.filter((item) => item.required).slice(0, remaining); remaining -= selectedRequiredSpecialists.length;
  const additionalDiscovery = discovery.slice(selectedDiscovery.length, selectedDiscovery.length + remaining); selectedDiscovery.push(...additionalDiscovery); remaining -= additionalDiscovery.length;
  const selectedOptionalSpecialists = specialists.filter((item) => !item.required).slice(0, remaining);
  const selectedSpecialists = [...selectedRequiredSpecialists, ...selectedOptionalSpecialists];
  const selectedIds = new Set([...selectedDiscovery, ...requiredCore, ...selectedSpecialists].map((item) => item.id));
  implementer.depends_on = implementer.depends_on.filter((id) => selectedIds.has(id));
  const reviewDependencies = ["implementation-engineer", "qa-lead", ...selectedSpecialists.filter((item) => item.required).map((item) => item.id)];
  return [...selectedDiscovery, implementer, qa, ...selectedSpecialists, reviewer(paths, reviewDependencies)];
}

export function teamPlanningHash({ goal, paths, task, risk, shape, maxAgents }) {
  return digest({
    goal,
    paths,
    context: task.context ?? {},
    skill_routing: task.skill_routing ?? null,
    execution_context: task.execution_context ?? null,
    risk,
    shape: shape ?? null,
    max_agents: maxAgents
  });
}
