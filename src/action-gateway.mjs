import crypto from "node:crypto";

export const ACTION_REASON_CODES = Object.freeze([
  "CAPABILITY_MATCH",
  "TASK_STATE_NOT_EXECUTABLE",
  "CAPABILITY_EXPIRED",
  "ACTION_BUDGET_EXHAUSTED",
  "TOOL_NOT_ALLOWED",
  "PATH_NOT_ALLOWED",
  "RISK_CEILING_EXCEEDED",
  "NETWORK_DOMAIN_NOT_ALLOWED",
  "CRITICAL_AUTONOMOUS_EXECUTION_FORBIDDEN",
  "CRITICAL_MUTATION_FORBIDDEN",
  "HUMAN_CONFIRMATION_REQUIRED",
  "APPROVAL_BINDING_CHANGED",
  "REPOSITORY_COMMIT_CHANGED",
  "POLICY_REVISION_CHANGED",
  "CAPABILITY_HASH_CHANGED",
  "ADAPTER_NOT_ALLOWED",
  "ACTION_ENVELOPE_CHANGED",
  "DECISION_NOT_ALLOW",
  "DECISION_NOT_FOUND"
]);

const RISK_ORDER = ["low", "medium", "high", "critical"];
const SECRET_KEY = /(authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._~+/=-]+|gh[opsu]_[a-z0-9]+|sk-[a-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function actionDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function redactSensitive(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return SECRET_VALUE.test(value) ? "[REDACTED]" : value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitive(entryValue, entryKey)
    ]));
  }
  return value;
}

function safeText(value, field, max = 4096) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new Error(`${field} must be a bounded text value`);
  }
  return value;
}

export function normalizeActionEnvelope(input = {}) {
  const tool = safeText(input.tool, "tool", 256);
  if (!tool) throw new Error("action envelope requires tool");
  const risk = input.risk ?? "low";
  if (!RISK_ORDER.includes(risk)) throw new Error(`unsupported action risk: ${risk}`);
  const parameters = redactSensitive(input.parameters ?? {});
  const envelope = {
    schema_version: 1,
    task_id: safeText(input.id ?? input.taskId, "task id", 128),
    adapter: safeText(input.adapter ?? "unknown", "adapter", 128),
    tool,
    path: safeText(input.path, "path"),
    command: safeText(input.command, "command"),
    domain: safeText(input.domain, "domain", 253)?.toLowerCase() ?? null,
    risk,
    approval_hash: safeText(input.approvalHash, "approval hash", 256),
    repository_commit: safeText(input.repositoryCommit, "repository commit", 256),
    policy_revision: safeText(input.policyRevision, "policy revision", 256),
    capability_hash: safeText(input.capabilityHash, "capability hash", 256),
    parameters_hash: actionDigest(parameters)
  };
  if (!envelope.task_id) throw new Error("action envelope requires task id");
  return Object.freeze(envelope);
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
  return ["allow", "CAPABILITY_MATCH"];
}

export function assessAction({ task, envelope, now = new Date() }) {
  let decision = "allow";
  let reasonCode = "CAPABILITY_MATCH";
  const capability = task.capability;
  if (!["IMPLEMENTING", "VERIFYING"].includes(task.state)) [decision, reasonCode] = ["deny", "TASK_STATE_NOT_EXECUTABLE"];
  else if (new Date(capability.expires_at).getTime() <= now.getTime()) [decision, reasonCode] = ["deny", "CAPABILITY_EXPIRED"];
  else if (task.action_count >= capability.max_actions) [decision, reasonCode] = ["deny", "ACTION_BUDGET_EXHAUSTED"];
  else if (envelope.capability_hash !== task.capability_hash) [decision, reasonCode] = ["deny", "CAPABILITY_HASH_CHANGED"];
  else if (envelope.approval_hash !== capability.approval_hash) [decision, reasonCode] = ["deny", "APPROVAL_BINDING_CHANGED"];
  else if (envelope.repository_commit !== capability.repository_commit) [decision, reasonCode] = ["deny", "REPOSITORY_COMMIT_CHANGED"];
  else if (envelope.policy_revision !== capability.policy_revision) [decision, reasonCode] = ["deny", "POLICY_REVISION_CHANGED"];
  else if (capability.agent_adapter !== "unknown" && envelope.adapter !== capability.agent_adapter) {
    [decision, reasonCode] = ["deny", "ADAPTER_NOT_ALLOWED"];
  } else if (!capability.allowed_tools.includes(envelope.tool)) [decision, reasonCode] = ["deny", "TOOL_NOT_ALLOWED"];
  else if (envelope.path && !matchesPath(envelope.path, capability.allowed_paths)) [decision, reasonCode] = ["deny", "PATH_NOT_ALLOWED"];
  else if (envelope.risk === "critical") [decision, reasonCode] = ["deny", "CRITICAL_AUTONOMOUS_EXECUTION_FORBIDDEN"];
  else if (RISK_ORDER.indexOf(envelope.risk) > RISK_ORDER.indexOf(capability.max_risk)) {
    [decision, reasonCode] = ["deny", "RISK_CEILING_EXCEEDED"];
  } else if (envelope.domain && !capability.network_domains.includes(envelope.domain)) {
    [decision, reasonCode] = ["deny", "NETWORK_DOMAIN_NOT_ALLOWED"];
  } else if (envelope.command) {
    [decision, reasonCode] = commandDecision(envelope.command);
  }
  return {
    decision,
    reason_code: reasonCode,
    envelope_hash: actionDigest(envelope)
  };
}

export function privacyMinimizedAction(envelope) {
  return {
    schema_version: envelope.schema_version,
    task_id: envelope.task_id,
    adapter: envelope.adapter,
    tool: envelope.tool,
    risk: envelope.risk,
    path_hash: envelope.path ? actionDigest(envelope.path) : null,
    command_hash: envelope.command ? actionDigest(envelope.command) : null,
    domain_hash: envelope.domain ? actionDigest(envelope.domain) : null,
    parameters_hash: envelope.parameters_hash
  };
}
