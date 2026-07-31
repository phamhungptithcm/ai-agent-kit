import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  actionDigest,
  redactSensitive
} from "./action-gateway.mjs";
import {
  authorizeAction,
  executeAuthorizedAction,
  recordActionVerification,
  recordSecurityDecision
} from "./governed-runtime.mjs";

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./
];
const POISONING_PATTERNS = [
  /ignore (all|any|the) (previous|prior|higher)/i,
  /reveal (the )?(system prompt|secret|credential)/i,
  /disable (security|policy|approval)/i,
  /send .*token/i
];
const DEFAULT_RATE_STORE = new Map();

function rootFor(target) {
  return path.resolve(target ?? process.cwd());
}

function registryPath(root, explicit) {
  return explicit
    ? path.resolve(root, explicit)
    : path.join(root, ".ai", "context", "mcp-trust-registry.json");
}

function readRegistry(root, explicit) {
  const file = registryPath(root, explicit);
  if (!fs.existsSync(file)) {
    return { version: 1, default_trust: "deny", servers: [] };
  }
  const registry = JSON.parse(fs.readFileSync(file, "utf8"));
  if (registry.default_trust !== "deny" || !Array.isArray(registry.servers)) {
    throw new Error("MCP trust registry must be deny-by-default");
  }
  return registry;
}

function safeServerId(value) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value ?? "")) throw new Error("invalid MCP server id");
  return value;
}

function normalizedServer(config) {
  return {
    id: safeServerId(config.id),
    command: String(config.command ?? ""),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    package: config.package ?? null,
    version: config.version ?? null,
    executable_sha256: config.executable_sha256 ?? null,
    transport: config.transport ?? "stdio",
    auto_start: config.auto_start === true
  };
}

export function mcpServerIdentity(config) {
  return actionDigest(normalizedServer(config));
}

function findTrust(registry, serverId) {
  return registry.servers.find((entry) => entry.id === serverId) ?? null;
}

function unsafeStartup(server) {
  const joined = [server.command, ...server.args].join(" ").toLowerCase();
  return !server.command
    || /(^|\s)(sh|bash|zsh|cmd|powershell)(\s|$)/.test(server.command.toLowerCase())
    || /curl|wget|\|\s*(sh|bash)|npx\s+(-y|--yes)?\s*[^@\s]+(@latest)?/.test(joined);
}

function domainAllowed(domain, allowedDomains) {
  if (!domain) return true;
  const normalized = domain.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return false;
  if (net.isIP(normalized) && (PRIVATE_IPV4.some((pattern) => pattern.test(normalized)) || normalized === "::1")) return false;
  return allowedDomains.includes(normalized);
}

function pathAllowed(candidate, roots) {
  if (!candidate) return true;
  const absolute = path.resolve(candidate);
  return roots.some((root) => {
    const allowed = path.resolve(root);
    return absolute === allowed || absolute.startsWith(`${allowed}${path.sep}`);
  });
}

function containsPoisoning(value) {
  const text = JSON.stringify(value ?? {});
  return POISONING_PATTERNS.some((pattern) => pattern.test(text));
}

function brokerDecision(options, decision, reasonCode, details = {}) {
  return recordSecurityDecision({
    target: options.target,
    id: options.id,
    decision,
    reasonCode,
    subject: { server_id: options.server?.id ?? null, tool: options.tool ?? null },
    details
  });
}

export function authorizeMcpStart(options) {
  const root = rootFor(options.target);
  const server = normalizedServer(options.server);
  const registry = readRegistry(root, options.registry);
  const trust = findTrust(registry, server.id);
  if (!trust) return brokerDecision(options, "deny", "MCP_SERVER_UNTRUSTED");
  if (unsafeStartup(server)) return brokerDecision(options, "deny", "MCP_UNSAFE_LOCAL_STARTUP");
  if (trust.configuration_sha256 !== mcpServerIdentity(server)) {
    return brokerDecision(options, "deny", "MCP_TRUST_REGISTRY_DRIFT");
  }
  if (new Date(trust.review_expires).getTime() <= Date.now()) {
    return brokerDecision(options, "deny", "MCP_TRUST_REVIEW_EXPIRED");
  }
  if (server.auto_start && trust.auto_start !== true) {
    return brokerDecision(options, "ask", "MCP_AUTOSTART_APPROVAL_REQUIRED");
  }
  return brokerDecision(options, "allow", "MCP_SERVER_TRUSTED");
}

function checkRequest(options, trust) {
  if (!trust.allowed_tools.includes(options.tool)) return ["deny", "MCP_TOOL_NOT_ALLOWED"];
  if (!pathAllowed(options.path, trust.filesystem_roots ?? [])) return ["deny", "MCP_FILESYSTEM_ROOT_NOT_ALLOWED"];
  if (!domainAllowed(options.domain, trust.network_domains ?? [])) return ["deny", "MCP_NETWORK_DOMAIN_NOT_ALLOWED"];
  if (Number(options.timeoutMs ?? trust.timeout_ms) > Number(trust.timeout_ms)) return ["ask", "MCP_TIMEOUT_EXPANSION_REQUIRES_APPROVAL"];
  if (containsPoisoning(options.parameters)) return ["deny", "MCP_INDIRECT_PROMPT_INJECTION"];
  if (JSON.stringify(options.parameters ?? {}).match(/authorization|cookie|bearer|api[-_]?key|token/i)) {
    return ["deny", "MCP_TOKEN_PASSTHROUGH_FORBIDDEN"];
  }
  return ["allow", "MCP_REQUEST_WITHIN_TRUST"];
}

export function authorizeMcpRequest(options, deps = {}) {
  const root = rootFor(options.target);
  const server = normalizedServer(options.server);
  const registry = readRegistry(root, options.registry);
  const trust = findTrust(registry, server.id);
  const start = authorizeMcpStart({ ...options, server });
  if (start.decision !== "allow") return start;
  const [decision, reasonCode] = checkRequest(options, trust);
  if (decision !== "allow") return brokerDecision(options, decision, reasonCode);
  const rateKey = `${root}:${server.id}:${options.tool}`;
  const rateStore = deps.rateStore ?? DEFAULT_RATE_STORE;
  const now = Number(deps.now?.getTime?.() ?? Date.now());
  const windowMs = 60_000;
  const previous = (rateStore.get(rateKey) ?? []).filter((stamp) => now - stamp < windowMs);
  if (previous.length >= Number(trust.rate_limit_per_minute ?? 60)) {
    return brokerDecision(options, "deny", "MCP_RATE_LIMIT_EXCEEDED");
  }
  previous.push(now);
  rateStore.set(rateKey, previous);
  return authorizeAction({
    ...options,
    adapter: options.adapter,
    tool: `mcp:${server.id}/${options.tool}`,
    parameters: redactSensitive(options.parameters ?? {})
  });
}

export function executeMcpRequest(options, executor, deps = {}) {
  const authorization = authorizeMcpRequest(options, deps);
  if (authorization.decision !== "allow") return authorization;
  const credentials = deps.credentialProvider ? deps.credentialProvider({
    serverId: options.server.id,
    tool: options.tool
  }) : undefined;
  const execution = executeAuthorizedAction({
    ...options,
    tool: `mcp:${options.server.id}/${options.tool}`,
    parameters: redactSensitive(options.parameters ?? {}),
    decisionToken: authorization.decision_token
  }, () => executor({
    server: normalizedServer(options.server),
    tool: options.tool,
    parameters: redactSensitive(options.parameters ?? {}),
    timeoutMs: options.timeoutMs,
    credentials
  }));
  if (execution.status !== "completed") return execution;
  const sanitizedResult = redactSensitive(execution.result);
  const verification = recordActionVerification({
    target: options.target,
    id: options.id,
    status: "verified",
    executionReceiptHash: execution.receipt_hash,
    evidence: { result_hash: actionDigest(sanitizedResult) }
  });
  return {
    status: "completed",
    result: sanitizedResult,
    authorization_receipt_hash: authorization.receipt_hash,
    execution_receipt_hash: execution.receipt_hash,
    verification_receipt_hash: verification.receipt_hash
  };
}

export function inspectMcpTrust(options) {
  const root = rootFor(options.target);
  const registry = readRegistry(root, options.registry);
  return {
    version: registry.version,
    default_trust: registry.default_trust,
    servers: registry.servers.map((server) => ({
      id: server.id,
      review_expires: server.review_expires,
      allowed_tools: server.allowed_tools,
      filesystem_roots: server.filesystem_roots,
      network_domains: server.network_domains,
      configuration_sha256: server.configuration_sha256
    }))
  };
}
