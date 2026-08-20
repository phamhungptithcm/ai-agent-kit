# Architecture Pulse v1.4.1

Architecture Pulse is AI Agent Kit's local structural-assurance lane. It records what architecture changed, identifies exact new and fixed findings, shows affected components and witness paths, and states how trustworthy the evidence is.

The diagnostic Pulse index remains a trend signal. It never grants approval and never blocks on its own.

## What changed in v1.4.1

v1.4.1 replaces count-only comparison with stable finding identity. A fixed cycle and a different new cycle no longer cancel each other out because the aggregate count stayed unchanged.

The v2 evidence contract adds:

- stable fingerprints for graph edges, cycles, boundaries, layer-order findings, and public-API bypasses;
- new, unchanged, updated, and fixed finding states;
- honest scope categories for supported, unsupported, policy-excluded, external, unresolved, ambiguous, and parse-failed evidence;
- separate analysis and policy digests;
- analyzer compatibility based on graph, metric, extractor, and resolver semantics rather than the npm package version;
- emitted evidence tiers: SOURCE_FALLBACK, AST_VERIFIED, RESOLVER_VERIFIED, and EXPLICIT_MANIFEST, with INDEX_VERIFIED reserved for a future trusted adapter;
- bounded graph sharding, an opt-in non-authoritative content-addressed diagnostic cache, and one end-to-end deadline;
- base/head structural diff, affected components, and dependency witnesses;
- expiring integrity-bound waivers, richer dependency rules, SARIF, trend history, and diagnostic commands.

## Evidence pipeline

~~~text
Git snapshot or working tree
  → bounded inventory and truthful scope
  → source adapters and optional native resolvers
  → typed, component-aware file graph
  → stable finding catalog and witnesses
  → v2 baseline or base/head diff
  → named policy and governed waivers
  → task report, SARIF, trend, and Change Passport evidence
~~~

Pulse remains clean-room and first-party. It does not copy, vendor, invoke, wrap, or depend on Sentrux code, packages, binaries, services, assets, telemetry, or runtime behavior.

## Commands

Inspect the current repository:

~~~bash
ai-agent-kit pulse doctor --config pulse.json
ai-agent-kit pulse scan --config pulse.json --format text
ai-agent-kit pulse explain --file .ai-agent-kit/pulse/results/latest.json
~~~

Compare a change directly:

~~~bash
ai-agent-kit pulse diff --base origin/main --head working-tree --config pulse.json --format text
~~~

Manage trusted comparison state:

~~~bash
ai-agent-kit pulse baseline create --config pulse.json
ai-agent-kit pulse baseline verify --config pulse.json
ai-agent-kit pulse baseline inspect
ai-agent-kit pulse baseline migrate --baseline path/to/v1.json --dry-run
ai-agent-kit pulse check --config pulse.json --format text
~~~

Export and track evidence:

~~~bash
ai-agent-kit pulse sarif --file .ai-agent-kit/pulse/results/comparison.json
ai-agent-kit pulse trend record --file .ai-agent-kit/pulse/results/latest.json
ai-agent-kit pulse trend show
~~~

Baseline creation is refused in CI. CI may verify a reviewed baseline, but it cannot manufacture the desired state it is meant to enforce.

## Configuration

~~~json
{
  "schema_version": 2,
  "blocking_minimum_tier": "RESOLVER_VERIFIED",
  "components": [
    {
      "id": "domain",
      "paths": ["src/domain"],
      "owner": "domain-team",
      "public_api": ["src/domain/index.ts"]
    }
  ],
  "layers": [
    { "id": "domain", "paths": ["src/domain"], "order": 1 },
    { "id": "ui", "paths": ["src/ui"], "order": 2 }
  ],
  "boundaries": [
    {
      "name": "domain-must-not-depend-on-ui",
      "from": "src/domain",
      "deny": ["src/ui"],
      "owner": "architecture"
    }
  ],
  "rules": [
    {
      "id": "no-new-cycles",
      "type": "new-cycles",
      "threshold": 0,
      "severity": "block",
      "evidence_tier": "RESOLVER_VERIFIED"
    },
    {
      "id": "domain-cannot-reach-ui",
      "type": "reachable-dependency",
      "from": "src/domain",
      "to": "src/ui",
      "severity": "warning"
    }
  ]
}
~~~

Rules support new cycles, boundary findings, no-new-finding policy, depth, cohesion, hotspots, blast radius, coverage, confidence, forbidden dependencies, required dependencies, transitive reachability, layer order, and public API enforcement.

When a blocking rule matches evidence below its approved tier, Pulse returns DEGRADED; it does not silently pass and does not pretend low-precision evidence is safe to block.

## Precision adapters

Every edge records how it was obtained.

| Tier | Meaning |
| --- | --- |
| SOURCE_FALLBACK | Conservative source extraction or heuristic resolution |
| AST_VERIFIED | Syntax was read through an available local AST parser |
| RESOLVER_VERIFIED | A repository manifest or available native resolver confirmed the edge |
| INDEX_VERIFIED | Reserved for a future trusted semantic-index adapter; v1.4.1 does not emit this tier |
| EXPLICIT_MANIFEST | The repository explicitly declared the cross-language edge |

v1.4.1 provides comment-aware JavaScript/TypeScript extraction, TypeScript path and workspace-package resolution, Python AST extraction when python3 is available, Go module resolution with optional go list, Rust workspace resolution with optional cargo metadata, JVM package mapping, C# namespace mapping, and explicit cross-language bridges.

Optional tools are invoked with fixed read-only arguments, bounded time and output, and no implicit downloads or network setup. Missing tools remain visible in pulse doctor and resolver provenance.

## Coverage semantics

COMPLETE means the declared source scope was supported, parsed, and internally resolved within the configured limits. Coverage distinguishes:

- supported_in_scope;
- unsupported_in_scope;
- excluded_by_policy;
- external_declared;
- unresolved_internal;
- ambiguous;
- parse_failed.

Policy-excluded docs, assets, generated output, vendor trees, and Pulse's own runtime artifacts do not inflate or destabilize source coverage. Unsupported source inside a source directory or explicit include scope makes the scan DEGRADED.

## Baselines and compatibility

v2 baselines store the stable finding catalog and split:

- analysis_config_digest, which controls comparability;
- policy_digest, whose drift is reported but does not erase architectural history.

The npm package version is provenance, not a compatibility gate. Graph, metric, extractor, and resolver semantic versions control compatibility.

Baseline creation is immutable by default. An existing trusted baseline file is never overwritten silently; advancing history requires a new reviewed baseline name.

v1 baselines are readable but cannot be compared silently with v2. baseline migrate --dry-run previews recoverable identities and requires a reviewed fresh v2 baseline.

## Waivers

A waiver is exact and temporary. It requires a finding fingerprint, owner, reason, approver, creation and expiry timestamps, optional issue, and SHA-256 integrity. Expired, future-dated, malformed, or tampered waivers fail closed. There is intentionally no CI command to create or renew one.

## Bounded evidence and cache

The scanner applies file, byte, artifact, shard, and end-to-end deadline limits. If an inline result exceeds its artifact budget, graph, inventory, and large diagnostic collections are split into digest-addressed bounded shards while the summary remains self-validating and readable.

The local diagnostic cache is disabled by default and keyed by repository identity, source digest, analysis configuration, and analyzer semantic versions. A cache hit is always `DEGRADED` with `CACHE_NON_AUTHORITATIVE`; it cannot create or verify a baseline, drive a policy check, or serve as base/head evidence. Those governed paths always analyze fresh source. A missing or tampered entry is ignored and recomputed.

## Agent workflow

For architecture-sensitive work:

1. Run pulse diff or a task-bound scan before the first write wave.
2. Run it again after a meaningful implementation wave.
3. Run the final task-bound check after tests and final review.
4. Attach the current artifact to the task report or Change Passport.

Do not reuse evidence after the commit or worktree changes. Pulse artifacts become STALE.

## Evaluation

npm run eval:pulse executes the checked-in polyglot golden graph and mutation gates. It reports dependency-edge precision and recall, deterministic digests, seeded blocking-finding detection, truthful unsupported-scope behavior, elapsed time, and heap use.

The bundled corpus proves only those fixtures. Performance and blocking thresholds must be calibrated against representative repositories before broader enforcement.

## Limits

- Source analysis cannot prove every dynamic import, reflection target, generated binding, runtime route, service call, event, or data dependency.
- Resolver availability differs by host and is always reported.
- Large graphs use bounded blast-radius sampling and return DEGRADED.
- A passing policy is not security, runtime reliability, maintainability, or production-readiness proof.
- Pulse never rewrites architecture automatically, downloads tools, creates waivers in CI, sends source to a hosted scanner, or replaces human review.
