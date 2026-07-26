import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATES = ["DISCOVER", "ANALYZE", "PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING", "REVIEW_READY", "RELEASED"];
const NEXT_STATE = new Map(STATES.slice(0, -1).map((state, index) => [state, STATES[index + 1]]));
const REQUIRED_EVIDENCE = {
  ANALYZE: [],
  PLAN_READY: ["repository_intelligence"],
  APPROVED: ["approval_hash", "approver"],
  IMPLEMENTING: ["capability_hash"],
  VERIFYING: ["diff_scope"],
  REVIEW_READY: ["tests", "independent_verifier"],
  RELEASED: ["release_reference"]
};
const RISK_ORDER = ["low", "medium", "high", "critical"];

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

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("task id must be 1-128 safe characters");
  return value;
}

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function runtimeRoot(root) {
  return path.join(root, ".ai-agent-kit", "runtime");
}

function taskPath(root, id) {
  return path.join(runtimeRoot(root), "tasks", `${safeId(id)}.json`);
}

function evidencePath(root, id) {
  return path.join(runtimeRoot(root), "evidence", `${safeId(id)}.jsonl`);
}

function telemetryPath(root) {
  return path.join(runtimeRoot(root), "telemetry", "spans.jsonl");
}

function memoryPath(root) {
  return path.join(runtimeRoot(root), "memory", "entries.jsonl");
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readTask(root, id) {
  const file = taskPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function emitSpan(root, name, attributes) {
  appendJsonl(telemetryPath(root), {
    trace_id: crypto.randomBytes(16).toString("hex"),
    span_id: crypto.randomBytes(8).toString("hex"),
    name,
    timestamp: new Date().toISOString(),
    attributes
  });
}

function appendReceipt(root, id, type, data) {
  const file = evidencePath(root, id);
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).at(-1) : "";
  const previousHash = previous ? JSON.parse(previous).receipt_hash : null;
  const receipt = {
    task_id: id,
    type,
    timestamp: new Date().toISOString(),
    previous_receipt_hash: previousHash,
    data
  };
  receipt.receipt_hash = digest(receipt);
  appendJsonl(file, receipt);
  emitSpan(root, `ai_agent.${type}`, { "ai_agent.task.id": id, "ai_agent.receipt.hash": receipt.receipt_hash });
  return receipt;
}

function matchesPath(candidate, patterns) {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  return patterns.some((pattern) => {
    const clean = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
    if (clean.endsWith("/**")) return normalized === clean.slice(0, -3) || normalized.startsWith(clean.slice(0, -2));
    return normalized === clean;
  });
}

function commandDecision(command) {
  const value = (command ?? "").toLowerCase();
  if (/\b(terraform\s+(apply|destroy)|kubectl\s+(apply|delete|create)|git\s+reset\s+--hard|rm\s+-[a-z]*r)/.test(value)) {
    return ["deny", "CRITICAL_MUTATION_FORBIDDEN"];
  }
  if (/\b(git\s+(add|commit|push|tag|merge|rebase)|npm\s+(install|publish)|curl|wget|aws|az|gcloud|psql|mysql)\b/.test(value)) {
    return ["ask", "HUMAN_CONFIRMATION_REQUIRED"];
  }
  return ["allow", "POLICY_ALLOW"];
}

export function createTask(options) {
  const root = rootFor(options.target);
  const id = safeId(options.id);
  if (fs.existsSync(taskPath(root, id))) throw new Error(`task already exists: ${id}`);
  const now = new Date();
  const capability = {
    allowed_tools: options.tools?.length ? options.tools : ["read"],
    allowed_paths: options.paths?.length ? options.paths : [],
    network_domains: options.domains ?? [],
    max_risk: options.risk ?? "low",
    max_actions: Number(options.maxActions ?? 100),
    expires_at: options.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    approval_hash: options.approvalHash ?? null,
    repository_commit: options.repositoryCommit ?? null,
    policy_revision: options.policyRevision ?? "governed-runtime-v1",
    agent_adapter: options.adapter ?? "unknown"
  };
  const task = {
    version: 1,
    id,
    goal: options.goal ?? null,
    acceptance_criteria: options.acceptanceCriteria ?? [],
    state: "DISCOVER",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    capability,
    capability_hash: digest(capability),
    action_count: 0,
    context: { facts: [], assumptions: [] },
    plan: { revision: 0, trigger: "task-created", steps: [] },
    transitions: []
  };
  atomicWrite(taskPath(root, id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, id, "task.created", { state: task.state, capability_hash: task.capability_hash });
  return task;
}

export function addContext(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const key = options.kind === "fact" ? "facts" : options.kind === "assumption" ? "assumptions" : null;
  if (!key) throw new Error("context kind must be fact or assumption");
  if (!options.statement) throw new Error("context statement is required");
  if (key === "facts" && !options.source) throw new Error("facts require a source");
  const entry = {
    statement: options.statement,
    source: options.source ?? null,
    confidence: Number(options.confidence ?? (key === "facts" ? 1 : 0.5)),
    recorded_at: new Date().toISOString()
  };
  if (entry.confidence < 0 || entry.confidence > 1) throw new Error("confidence must be between 0 and 1");
  task.context[key].push(entry);
  task.updated_at = entry.recorded_at;
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, `context.${options.kind}`, {
    statement_hash: digest(entry.statement),
    source_hash: entry.source ? digest(entry.source) : null,
    confidence: entry.confidence
  });
  return task;
}

export function revisePlan(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  if (!["ANALYZE", "PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING"].includes(task.state)) {
    throw new Error(`task state does not permit planning: ${task.state}`);
  }
  if (!options.trigger) throw new Error("plan revision requires a trigger");
  if (!Array.isArray(options.steps) || !options.steps.length) throw new Error("plan revision requires at least one step");
  const previousHash = digest(task.plan);
  task.plan = {
    revision: task.plan.revision + 1,
    trigger: options.trigger,
    steps: options.steps.map((description, index) => ({ id: index + 1, description, status: "pending" })),
    previous_plan_hash: previousHash,
    revised_at: new Date().toISOString()
  };
  task.updated_at = task.plan.revised_at;
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, "plan.revised", {
    revision: task.plan.revision,
    trigger_hash: digest(options.trigger),
    plan_hash: digest(task.plan),
    previous_plan_hash: previousHash
  });
  return task.plan;
}

export function transitionTask(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const to = String(options.to ?? "").toUpperCase();
  if (NEXT_STATE.get(task.state) !== to) throw new Error(`invalid transition: ${task.state} -> ${to}`);
  const evidence = options.evidence ?? {};
  const missing = (REQUIRED_EVIDENCE[to] ?? []).filter((key) => !evidence[key]);
  if (missing.length) throw new Error(`transition ${to} missing evidence: ${missing.join(", ")}`);
  if (to === "APPROVED" && evidence.approval_hash !== task.capability.approval_hash) {
    throw new Error("approval evidence does not match capability approval hash");
  }
  const transition = { from: task.state, to, timestamp: new Date().toISOString(), evidence_hash: digest(evidence) };
  task.state = to;
  task.updated_at = transition.timestamp;
  task.transitions.push(transition);
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  appendReceipt(root, task.id, "task.transition", transition);
  return task;
}

export function evaluateAction(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  let decision = "allow";
  let reasonCode = "CAPABILITY_MATCH";
  if (!["IMPLEMENTING", "VERIFYING"].includes(task.state)) [decision, reasonCode] = ["deny", "TASK_STATE_NOT_EXECUTABLE"];
  else if (new Date(task.capability.expires_at).getTime() <= Date.now()) [decision, reasonCode] = ["deny", "CAPABILITY_EXPIRED"];
  else if (task.action_count >= task.capability.max_actions) [decision, reasonCode] = ["deny", "ACTION_BUDGET_EXHAUSTED"];
  else if (!task.capability.allowed_tools.includes(options.tool)) [decision, reasonCode] = ["deny", "TOOL_NOT_ALLOWED"];
  else if (options.path && !matchesPath(options.path, task.capability.allowed_paths)) [decision, reasonCode] = ["deny", "PATH_NOT_ALLOWED"];
  else if ((options.risk ?? "low") === "critical") [decision, reasonCode] = ["deny", "CRITICAL_AUTONOMOUS_EXECUTION_FORBIDDEN"];
  else if (RISK_ORDER.indexOf(options.risk ?? "low") > RISK_ORDER.indexOf(task.capability.max_risk)) [decision, reasonCode] = ["deny", "RISK_CEILING_EXCEEDED"];
  else if (options.domain && !task.capability.network_domains.includes(options.domain)) [decision, reasonCode] = ["deny", "NETWORK_DOMAIN_NOT_ALLOWED"];
  else if (options.command) [decision, reasonCode] = commandDecision(options.command);
  task.action_count += 1;
  task.updated_at = new Date().toISOString();
  atomicWrite(taskPath(root, task.id), `${JSON.stringify(task, null, 2)}\n`);
  const receipt = appendReceipt(root, task.id, "policy.decision", {
    decision,
    reason_code: reasonCode,
    tool: options.tool,
    resource_hash: digest({ path: options.path ?? null, command: options.command ?? null }),
    capability_hash: task.capability_hash,
    action_count: task.action_count
  });
  return { decision, reason_code: reasonCode, receipt_hash: receipt.receipt_hash };
}

export function verifyEvidence(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const file = evidencePath(root, task.id);
  const receipts = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
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
  let storedState = "DISCOVER";
  for (const transition of task.transitions) {
    if (transition.from !== storedState || NEXT_STATE.get(storedState) !== transition.to) errors.push("invalid stored transition order");
    storedState = transition.to;
  }
  if (storedState !== task.state) errors.push("task state does not match transition history");
  if (task.state !== "DISCOVER" && !task.goal) errors.push("task goal is missing");
  if (["PLAN_READY", "APPROVED", "IMPLEMENTING", "VERIFYING", "REVIEW_READY", "RELEASED"].includes(task.state)) {
    if (!task.acceptance_criteria.length) errors.push("acceptance criteria are missing");
    if (!task.plan.steps.length) errors.push("execution plan is missing");
  }
  const result = {
    status: errors.length ? "REJECTED" : "VERIFIED",
    task_id: task.id,
    state: task.state,
    receipt_count: receipts.length,
    latest_receipt_hash: previous,
    errors
  };
  emitSpan(root, "ai_agent.verification", { "ai_agent.task.id": task.id, "ai_agent.verification.status": result.status });
  return result;
}

export function proposeMemory(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  if (!options.title || !options.content || !options.source) {
    throw new Error("memory proposal requires title, content, and source");
  }
  const entry = {
    id: digest({ task_id: task.id, title: options.title, content: options.content }).slice(0, 24),
    task_id: task.id,
    title: options.title,
    category: options.category ?? "learning",
    scope: options.scope ?? "repository",
    content: options.content,
    source: options.source,
    source_commit: options.sourceCommit ?? null,
    confidence: Number(options.confidence ?? 0.5),
    status: "proposed",
    approver: null,
    review_date: null,
    created_at: new Date().toISOString()
  };
  if (entry.confidence < 0 || entry.confidence > 1) throw new Error("confidence must be between 0 and 1");
  entry.content_hash = digest({
    title: entry.title, category: entry.category, scope: entry.scope,
    content: entry.content, source: entry.source, source_commit: entry.source_commit
  });
  appendJsonl(memoryPath(root), entry);
  appendReceipt(root, task.id, "memory.proposed", {
    memory_id: entry.id, content_hash: entry.content_hash, confidence: entry.confidence
  });
  return entry;
}

export function approveMemory(options) {
  const root = rootFor(options.target);
  if (!options.memoryId || !options.approver) throw new Error("memory approval requires memory id and approver");
  const file = memoryPath(root);
  const entries = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  const proposed = [...entries].reverse().find((entry) => entry.id === options.memoryId);
  if (!proposed) throw new Error(`memory not found: ${options.memoryId}`);
  if (proposed.status !== "proposed") throw new Error("only proposed memory can be approved");
  const approved = {
    ...proposed,
    status: "approved",
    approver: options.approver,
    review_date: options.reviewDate ?? new Date().toISOString().slice(0, 10),
    approved_at: new Date().toISOString()
  };
  appendJsonl(file, approved);
  appendReceipt(root, approved.task_id, "memory.approved", {
    memory_id: approved.id, content_hash: approved.content_hash, approver_hash: digest(approved.approver)
  });
  return approved;
}

export function queryMemory(options) {
  const file = memoryPath(rootFor(options.target));
  if (!fs.existsSync(file)) return [];
  const latest = new Map();
  for (const entry of fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)) latest.set(entry.id, entry);
  return [...latest.values()].filter((entry) =>
    entry.status === "approved"
    && (!options.scope || entry.scope === options.scope)
    && (!options.query || `${entry.title}\n${entry.content}`.toLowerCase().includes(options.query.toLowerCase()))
  );
}

export function scoreTask(options) {
  const task = readTask(rootFor(options.target), options.id);
  const verification = verifyEvidence(options);
  const dimensions = {
    goal_contract: Boolean(task.goal && task.acceptance_criteria.length),
    evidence_integrity: verification.status === "VERIFIED",
    repository_grounding: task.context.facts.some((fact) => fact.source),
    adaptive_plan: task.plan.revision > 0 && task.plan.steps.length > 0,
    governed_execution: task.action_count > 0
  };
  const passed = Object.values(dimensions).filter(Boolean).length;
  return { task_id: task.id, score: passed / Object.keys(dimensions).length, passed, total: Object.keys(dimensions).length, dimensions };
}

export function inspectTask(options) {
  return readTask(rootFor(options.target), options.id);
}

export function exportEvidence(options) {
  const root = rootFor(options.target);
  const task = readTask(root, options.id);
  const verification = verifyEvidence(options);
  const ledger = fs.existsSync(evidencePath(root, task.id))
    ? fs.readFileSync(evidencePath(root, task.id), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  return { schema_version: 1, task, verification, ledger };
}

export { STATES };
