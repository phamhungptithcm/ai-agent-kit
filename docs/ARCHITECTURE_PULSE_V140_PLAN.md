# Architecture Pulse v1.4.0 Implementation Plan

Plan ID: `AAK-ARCH-PULSE-NATIVE-V1`

Base: `hunpeolabs/v1.3.0-governed-shared-memory` at `069b4c6`

Target branch: `hunpeolabs/v1.4.0-architecture-pulse`

## Objective

Add a clean-room, first-party Architecture Pulse module that deterministically inventories a repository, extracts bounded polyglot dependency evidence, builds an explainable graph, computes versioned structural signals, compares trusted baselines, evaluates explicit regression rules, exposes local CLI workflows, and binds results into governed evidence.

## Verified integration surface

- `src/cli.mjs` owns the public command dispatcher and stable exit behavior.
- `src/task-report.mjs` assembles final governed task evidence.
- `src/change-passport.mjs` signs the final repository and proof integrity envelope.
- `scripts/build.mjs` copies canonical `src/` and `bin/` sources into generated `dist/`.
- `scripts/smoke-packed.mjs` verifies the npm tarball rather than source-only behavior.
- Canonical installed governance content lives under `assets/enterprise-ai-agent-os/.ai/`; generated adapter surfaces are not required for a core documentation addition.

## Delivery sequence

1. Define versioned contracts, stable serialization, reason codes, confidence, coverage, and comparison statuses.
2. Implement a Git-aware, contained and resource-bounded scanner.
3. Implement conservative extractors for JavaScript/TypeScript, Python, Go, Rust, Java/Kotlin, and C#.
4. Build evidence-backed dependency graphs, SCCs, condensation depth, cohesion, boundary, hotspot and blast-radius signals.
5. Bind baselines to repository/source/config/tool/metric state and reject drift or tampering.
6. Evaluate explicit named rules and deltas; keep aggregate scores diagnostic only.
7. Add `pulse scan`, `baseline create|verify`, `check`, and `explain` CLI workflows with human and JSON output.
8. Attach verified Pulse evidence to task reports and Change Passports without changing approval authority.
9. Add adversarial, deterministic, polyglot, cross-platform, compatibility and packed-package coverage.
10. Update canonical docs, README, changelog, package metadata and generated `dist` output.

## Preserved behavior

- Existing v1.3 memory, runtime, team, adapter, bootstrap, update, proof and release behavior remains backward compatible.
- Pulse is read-only unless the user explicitly creates a baseline or report artifact.
- Missing or weak evidence yields `STALE`, `UNTRUSTED`, or `DEGRADED`, never a fabricated passing result.
- Existing runtime policy remains the authority boundary; Pulse only supplies evidence.

## Validation

- Targeted v1.4 tests during implementation.
- Lint and syntax/type checks.
- Full `npm test` plus repository eval and conformance gates.
- Build, package boundary inspection, and packed smoke.
- Approval-to-diff validation from base `069b4c6`.
- Final implementation review covering requirements, security, failure paths, compatibility, performance and release readiness.
