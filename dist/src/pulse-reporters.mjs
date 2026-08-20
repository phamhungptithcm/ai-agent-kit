import { spawnSync } from "node:child_process";
import { pulseDigest } from "./pulse-contract.mjs";

function location(finding) {
  const file = finding.identity?.from ?? finding.nodes?.[0] ?? finding.identity?.nodes?.[0];
  if (!file) return undefined;
  return { physicalLocation: { artifactLocation: { uri: file }, region: { startLine: Math.max(1, finding.line ?? finding.witness?.[0]?.line ?? 1) } } };
}

function sarifResult(finding, state = "new") {
  const result = {
    ruleId: `architecture-pulse/${finding.type}`,
    level: "warning",
    message: { text: finding.title ?? `Architecture Pulse ${finding.type} finding` },
    fingerprints: { "architecturePulse/v2": finding.fingerprint },
    baselineState: state === "fixed" ? "absent" : state === "updated" ? "updated" : state === "unchanged" ? "unchanged" : "new",
    properties: { evidenceTier: finding.evidence_tier ?? null, witness: finding.witness ?? null }
  };
  const primary = location(finding);
  if (primary) result.locations = [primary];
  return result;
}

export function pulseSarif(document) {
  const findings = document.protocol === "aak-architecture-pulse-v2"
    ? document.finding_catalog.map((finding) => ({ finding, state: "new" }))
    : Object.entries(document.finding_changes ?? {}).flatMap(([state, values]) => values.map((finding) => ({ finding, state })));
  const results = findings.map(({ finding, state }) => sarifResult(finding, state));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "AI Agent Kit Architecture Pulse", informationUri: "https://github.com/phamhungptithcm/ai-agent-kit", rules: [...new Set(findings.map(({ finding }) => finding.type))].sort().map((type) => ({ id: `architecture-pulse/${type}`, shortDescription: { text: `Architecture Pulse ${type}` } })) } },
      automationDetails: { id: "architecture-pulse/v2" },
      results
    }]
  };
}

function commandStatus(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  return { available: result.status === 0, version: result.status === 0 ? (result.stdout || result.stderr).split("\n")[0].trim().slice(0, 256) : null };
}

export function pulseDoctor(config = {}) {
  const capabilities = {
    git: commandStatus("git", ["--version"]),
    python_ast: config.resolvers?.python === false ? { available: false, disabled: true } : commandStatus("python3", ["--version"]),
    go_list: config.resolvers?.go === false ? { available: false, disabled: true } : commandStatus("go", ["version"]),
    cargo_metadata: config.resolvers?.rust === false ? { available: false, disabled: true } : commandStatus("cargo", ["--version"]),
    dotnet_msbuild: config.resolvers?.csharp === false ? { available: false, disabled: true } : commandStatus("dotnet", ["--version"])
  };
  return {
    schema_version: 1,
    status: capabilities.git.available ? "READY" : "DEGRADED",
    offline: true,
    implicit_downloads: false,
    capabilities,
    blocking_minimum_tier: config.blocking_minimum_tier ?? (config.schema_version === 2 ? "RESOLVER_VERIFIED" : "SOURCE_FALLBACK"),
    config_digest: pulseDigest(config)
  };
}

export function validatePulsePolicyDocument(config) {
  return {
    status: "VALID",
    rules: (config.rules ?? []).map((rule) => ({ id: rule.id, type: rule.type, severity: rule.severity ?? "warning", threshold: rule.threshold ?? 0 })),
    waivers: (config.waivers ?? []).map((waiver) => ({ fingerprint: waiver.fingerprint, owner: waiver.owner, expires_at: waiver.expires_at })),
    blocking_minimum_tier: config.blocking_minimum_tier ?? (config.schema_version === 2 ? "RESOLVER_VERIFIED" : "SOURCE_FALLBACK"),
    policy_digest: pulseDigest({ rules: config.rules ?? [], waivers: config.waivers ?? [], blocking_minimum_tier: config.blocking_minimum_tier ?? null })
  };
}
