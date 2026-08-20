# Traceable Plugin Runtime

## Product invariants

- Every decision should be recoverable.
- Every run should be traceable.
- Everything may be extended as a plugin, but no plugin is above governance.

## Canonical records

Decision and run records are append-only, monotonically ordered, hash chained,
repository-bound, and free of raw prompts, source bodies, secrets, credentials,
personal data, and hidden reasoning. Corrections create explicit supersession,
revocation, or invalidation events. Derived indexes, dashboards, and exports can
always be rebuilt from canonical records.

## Resume and recovery

Inspecting or exporting a run is read-only. Resume and recovery are previews
until a human approves mutation. Immediately before writes, recheck repository,
worktree, branch, commit, parent baseline, policy, approval, plugin hashes, and
open blockers. Recovery restores reviewed intent; it never performs a hidden Git
reset or silently overwrites files.

## Plugin authority

Effective plugin authority is the intersection of the plugin manifest, task
scope, adapter capability, policy, capability token, and human approval. An
empty or unsupported intersection denies execution. Publisher identity,
popularity, or installation success never proves safety.

Plugins declare surfaces, host compatibility, permissions, dependencies,
conflicts, provenance, signature, checksum, and SBOM. Lifecycle changes are
previewable and produce receipts. Drift after verification quarantines the
plugin before invocation.

## Learning and observability

Repeated evidence may create a proposal. It must not silently promote a memory,
rule, skill, profile, plugin, or policy. External telemetry is opt-in; local
canonical records do not depend on an exporter or hosted service.

## Claims

TraceLab is synthetic offline evidence. Benchmarks describe only their pinned
fixture, model, host, settings, date, sample size, failures, variance, and cost
method. Neither can establish universal superiority or production readiness.
