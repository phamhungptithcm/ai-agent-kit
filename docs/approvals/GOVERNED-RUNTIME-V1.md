# Implementation Approval Record

Plan ID/version: GOVERNED-RUNTIME-V1

Repository intelligence gate status: READY

Indexed analysis reviewed: Root CodeGraph and CocoIndex analysis refreshed for the governed runtime architecture.

Approval status: APPROVED

Approver: repository owner (`phamhungptithcm`)

Approval timestamp or task reference: unified release approval in the active Codex task on 2026-07-26

Approved scope:

- Release every previously proposed governance phase together as `0.4.0`.
- Add a deterministic task state machine and transition evidence requirements.
- Add task-scoped capabilities, policy decisions, reason codes, expiry, risk ceilings, tool/path restrictions, and action budgets.
- Add a local tool-execution gateway that records allow/ask/deny receipts without autonomously executing protected external operations.
- Add a hash-linked evidence ledger, independent verification, export, and replay-safe inspection.
- Add privacy-safe OpenTelemetry-compatible JSON telemetry.
- Add MCP trust registry, sandbox/secret-broker contracts, governance maturity profiles, SBOM and supply-chain checks.
- Expand deterministic and recorded-response behavioral evaluations.
- Integrate CLI, scaffold manifest, adapters, documentation, tests, CI, changelog, package metadata, release notes, and generated distribution artifacts.

Approved paths:

- `.github/**`
- `assets/enterprise-ai-agent-os/**`
- `bin/**`
- `dist/**`
- `docs/**`
- `scripts/**`
- `src/**`
- `test/**`
- `CHANGELOG.md`
- `README.md`
- `package.json`
- `package-lock.json`

Required constraints:

- One release and one tag: `v0.4.0`.
- No runtime service, paid-model call, production credential, database migration, or autonomous production mutation.
- No new runtime dependency unless essential and separately surfaced.
- Policy evaluation and verification must be deterministic and model-independent.
- Evidence and telemetry must avoid prompts, source contents, secrets, and raw command output by default.
- Critical-risk execution remains forbidden.
- Backward compatibility for existing bootstrap and lifecycle commands.

Explicit exclusions:

- Hosted control-plane service.
- Production deployment.
- Automatic Jira, messaging, merge, or infrastructure mutations.
- Storage of chain-of-thought or secrets.

Delta approval required when:

- A path outside this record is required.
- A runtime dependency, hosted service, schema migration, or production integration becomes necessary.
- Critical operations become executable.
