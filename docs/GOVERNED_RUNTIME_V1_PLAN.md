# Governed Runtime V1 Plan

Release target: `0.4.0`

## Outcome

Turn AI Agent Kit from instruction-led governance into a local, deterministic, model-independent runtime that improves agent planning, grounding, self-correction, memory quality, and auditability without enabling autonomous critical operations.

## Included

- Goal and acceptance-criteria task contracts.
- Sequential task state machine with evidence-required transitions.
- Short-lived, path/tool/domain/risk/action-bounded capabilities.
- Deterministic `allow`, `ask`, and `deny` policy decisions.
- Hash-linked evidence receipts and independent integrity verification.
- Sourced facts, explicit assumptions, and trigger-based adaptive plan revisions.
- Human-promoted, provenance-aware local repository memory.
- Privacy-minimized OpenTelemetry-compatible JSON spans.
- MCP trust registry, sandbox and secret-broker contracts.
- Behavioral safety cases and task-intelligence scorecard.
- SPDX SBOM generation and package integration.

## Acceptance Criteria

- Existing bootstrap and lifecycle commands remain backward compatible.
- Runtime requires no model credential, hosted service, database, or new dependency.
- Critical mutation remains denied and review-required actions return `ask`.
- Unsourced facts, approval mismatch, capability tampering, and evidence-chain tampering fail closed.
- Proposed memory cannot be retrieved before human approval.
- `npm run check` and `npm run release:dry-run` pass for version `0.4.0`.

## Explicit Exclusions

- Hosted control plane.
- Production deployment or autonomous infrastructure/database mutation.
- Storage of prompts, raw source, raw command output, secrets, or chain-of-thought.
- Automatic Git push, package publish, merge, Jira update, or external messaging.
