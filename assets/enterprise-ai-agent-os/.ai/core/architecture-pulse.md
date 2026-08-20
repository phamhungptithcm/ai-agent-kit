# Architecture Pulse

Architecture Pulse is an optional, local-first structural evidence source for AI-assisted changes. Use it as change assurance, not as an architecture oracle.

## Required trust model

- Inventory source from Git with explicit containment, link, file, byte, artifact, shard, and end-to-end time limits.
- Keep supported, unsupported, policy-excluded, external, unresolved, ambiguous, parse-failed, and sampled inputs distinct.
- Record a stable fingerprint and evidence tier for every actionable finding.
- Compare finding identity as new, unchanged, updated, or fixed. Never infer safety from unchanged aggregate counts.
- Bind a baseline to repository identity, analysis configuration, analyzer semantic versions, source evidence, and integrity.
- Record policy drift independently; changing a rule must not erase architectural history.
- Treat STALE, UNTRUSTED, and DEGRADED as non-passing evidence states.
- Never create or refresh a baseline or waiver in CI.
- Never overwrite an existing trusted baseline silently; use a new reviewed name to advance history.
- Require an exact, approved, integrity-bound, unexpired waiver; invalid or expired waivers fail closed.
- Keep the aggregate Pulse index diagnostic. Only a named configured rule with an approved evidence tier may block.
- Preserve task, approval, policy, and runtime authority. Pulse reports evidence; it does not approve work.
- Operate offline without telemetry, implicit downloads, hosted analysis, or automatic architecture rewrites.

## Agent checkpoints

For architecture-sensitive work:

1. Record a base/head diff or task-bound scan before the first implementation wave.
2. Recheck after a meaningful write wave when dependencies or boundaries changed.
3. Run the final task-bound check after tests and final review.
4. Attach only current digest-valid evidence to the task report or Change Passport.

Evidence becomes stale when the repository commit or worktree changes.

## Precision

Edges declare one tier: SOURCE_FALLBACK, AST_VERIFIED, RESOLVER_VERIFIED, or EXPLICIT_MANIFEST. INDEX_VERIFIED is reserved for a future trusted semantic-index adapter and is not emitted by v1.4.1. Optional local resolvers use fixed read-only commands with bounded output and no downloads. Missing resolver capability remains visible.

If a blocking match is below the configured minimum tier, return DEGRADED. Do not pass it and do not promote heuristic evidence into blocking authority.

## Operations

Use:

- pulse doctor before adopting blocking rules;
- pulse diff for base/head change review;
- pulse baseline create, verify, and inspect for reviewed comparison state;
- pulse baseline migrate --dry-run for v1 evidence;
- pulse policy validate before CI;
- pulse check for named policy;
- pulse explain for witnesses and evidence quality;
- pulse sarif for code-scanning interoperability;
- pulse trend record/show for local append-only history.

Start in shadow mode, move to warnings for exact new findings, and enable blocking only after representative precision and false-block evidence has been reviewed.

Architecture Pulse is a clean-room, first-party AI Agent Kit module with no Sentrux code, package, binary, service, telemetry, asset, or runtime dependency.
