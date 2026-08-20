# Architecture Pulse v1.4.1 Implementation Plan

Plan ID: AAK-ARCH-PULSE-V141

Status: approved for implementation on 2026-08-20.

## Objective

Turn Architecture Pulse from count-oriented structural diagnostics into change-aware structural assurance that identifies exact new and fixed findings, explains affected components, and exposes evidence quality before a rule can block agent work.

## Phase 1 — correctness and honest evidence

- Stable edge and finding fingerprints.
- Finding catalog with new, unchanged, updated, and fixed.
- Identity-based cycle and boundary comparison.
- Truthful supported, unsupported, excluded, external, unresolved, ambiguous, and parse-failed scope.
- Split analysis and policy digests.
- Semantic compatibility matrix independent of package version.
- One deadline, bounded writer, graph shards, and explicit v1 migration boundary.

Acceptance gates:

- Replacing one cycle with another is REGRESSED.
- Unsupported in-scope source cannot report full coverage or COMPLETE.
- A writer never creates an artifact larger than its own reader limit.

## Phase 2 — precision engine

- Adapter evidence tiers and provenance.
- Comment-aware JS/TS extraction and tsconfig/workspace resolution.
- Python AST extraction when available.
- Optional local Go and Cargo resolver evidence.
- JVM, C#, component, layer, public API, typed edge, and explicit bridge evidence.
- No dependency installation, downloads, telemetry, or implicit network.

Acceptance gates:

- Checked-in seven-language golden graph.
- Measured precision and recall with explicit denominators.
- Missing optional resolvers remain visible.

## Phase 3 — change-first workflow

- Git base/head and working-tree diff.
- Added and removed edges.
- New, fixed, updated, and unchanged findings.
- Affected components and dependency witness paths.
- Content-addressed non-authoritative cache.

Acceptance gates:

- A seeded new cycle appears in base/head findings and SARIF identity.
- Cache tampering is ignored and recomputed.
- Repeated scans remain deterministic.

## Phase 4 — policy and adoption

- Forbidden, required, transitive, layer, public API, and no-new-finding rules.
- Evidence-tier threshold for blocking.
- Exact, integrity-bound, expiring waivers.
- Baseline inspect/migrate, policy validate, doctor, explain, SARIF, and trends.
- Task report and Change Passport compatibility.
- Shadow-to-blocking adoption guidance and benchmark.

Acceptance gates:

- Low-tier blocking matches return DEGRADED, not pass.
- Expired or tampered waivers fail closed.
- CI cannot create baselines.
- SARIF fingerprints and append-only trend chains verify.

## Release composition

v1.4.1 also includes the separately approved, verified Product Language Gate and natural UI/UX writing skill from the parallel task. Only that task's canonical/generated skill changes may be integrated; unrelated Team Control Plane or Product Genesis work is excluded.

## Verification

- Targeted v1.4.0 regression suite.
- v1.4.1 mutation and trust suite.
- Polyglot Pulse benchmark.
- Full npm run check.
- Generated adapter and dist parity.
- Packed-install smoke test.
- Fresh final implementation review.
