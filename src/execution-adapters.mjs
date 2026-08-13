const BRIDGE_KINDS = new Set(["HOST_NATIVE", "SERIAL_PERSONAS", "CLI_SUBPROCESS"]);
const ENFORCEMENT = new Set(["hard", "advisory", "none"]);

const HOST_CAPABLE_UNVERIFIED = Object.freeze({
  bridge_kind: "HOST_NATIVE",
  native_spawn: false,
  parallel_dispatch: false,
  cancellation: false,
  structured_result: true,
  read_only_enforcement: "hard",
  write_scope_enforcement: "advisory",
  max_concurrency: 1,
  capability_source: "requires-host-probe"
});

const SERIAL = Object.freeze({
  bridge_kind: "SERIAL_PERSONAS",
  native_spawn: false,
  parallel_dispatch: false,
  cancellation: false,
  structured_result: true,
  read_only_enforcement: "advisory",
  write_scope_enforcement: "advisory",
  max_concurrency: 1,
  capability_source: "kit-registry"
});

export const EXECUTION_ADAPTERS = Object.freeze({
  codex: Object.freeze({ id: "codex", ...HOST_CAPABLE_UNVERIFIED }),
  claude: Object.freeze({ id: "claude", ...HOST_CAPABLE_UNVERIFIED }),
  copilot: Object.freeze({ id: "copilot", ...SERIAL }),
  cursor: Object.freeze({ id: "cursor", ...SERIAL }),
  windsurf: Object.freeze({ id: "windsurf", ...SERIAL }),
  gemini: Object.freeze({ id: "gemini", ...SERIAL }),
  amazonq: Object.freeze({ id: "amazonq", ...SERIAL }),
  junie: Object.freeze({ id: "junie", ...SERIAL }),
  cline: Object.freeze({ id: "cline", ...SERIAL }),
  devin: Object.freeze({ id: "devin", ...SERIAL }),
  aider: Object.freeze({ id: "aider", ...SERIAL }),
  continue: Object.freeze({ id: "continue", ...SERIAL }),
  other: Object.freeze({ id: "other", ...SERIAL })
});

function boolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new Error("execution adapter boolean capabilities must be booleans");
  return value;
}

function positiveInteger(value, label, fallback) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 32) throw new Error(`${label} must be an integer between 1 and 32`);
  return value;
}

function enforcement(value, label, fallback) {
  const selected = value ?? fallback;
  if (!ENFORCEMENT.has(selected)) throw new Error(`${label} must be hard, advisory, or none`);
  return selected;
}

export function resolveExecutionAdapter(adapterId, provided = null) {
  const base = EXECUTION_ADAPTERS[adapterId];
  if (!base) throw new Error(`unsupported team execution adapter: ${adapterId}`);
  if (provided == null) return structuredClone(base);
  if (typeof provided !== "object" || Array.isArray(provided)) throw new Error("execution adapter capabilities must be an object");
  if (provided.id && provided.id !== adapterId) throw new Error("execution adapter capability id does not match the selected adapter");
  const bridgeKind = provided.bridge_kind ?? base.bridge_kind;
  if (!BRIDGE_KINDS.has(bridgeKind)) throw new Error("execution adapter bridge kind is invalid");
  const capabilities = {
    id: adapterId,
    bridge_kind: bridgeKind,
    native_spawn: boolean(provided.native_spawn, base.native_spawn),
    parallel_dispatch: boolean(provided.parallel_dispatch, base.parallel_dispatch),
    cancellation: boolean(provided.cancellation, base.cancellation),
    structured_result: boolean(provided.structured_result, base.structured_result),
    read_only_enforcement: enforcement(provided.read_only_enforcement, "read-only enforcement", base.read_only_enforcement),
    write_scope_enforcement: enforcement(provided.write_scope_enforcement, "write-scope enforcement", base.write_scope_enforcement),
    max_concurrency: positiveInteger(provided.max_concurrency, "adapter max concurrency", base.max_concurrency),
    capability_source: "host-probe"
  };
  if (capabilities.native_spawn && capabilities.bridge_kind !== "HOST_NATIVE" && capabilities.bridge_kind !== "CLI_SUBPROCESS") throw new Error("native spawn requires a native or subprocess bridge");
  if (!capabilities.native_spawn || capabilities.bridge_kind === "SERIAL_PERSONAS") { capabilities.parallel_dispatch = false; capabilities.cancellation = false; capabilities.max_concurrency = 1; }
  else if (!capabilities.parallel_dispatch) capabilities.max_concurrency = 1;
  if (!capabilities.structured_result) throw new Error("team execution requires structured result support");
  return capabilities;
}

export function executionModeFor(capabilities) {
  if (capabilities.bridge_kind === "HOST_NATIVE" && capabilities.native_spawn) return "NATIVE_SUBAGENTS";
  if (capabilities.bridge_kind === "CLI_SUBPROCESS" && capabilities.native_spawn) return "CLI_SUBPROCESS";
  return "SERIAL_PERSONAS";
}

export function listExecutionAdapters() {
  return Object.values(EXECUTION_ADAPTERS).map((item) => structuredClone(item));
}
