# Implementation Approval Record

Plan ID/version: AAK-TEAM-CONTROL-PLANE-V150-HARDENING-002

Repository intelligence gate status: READY — CodeGraph and CocoIndex were refreshed at commit `4d44e3b88eda4b97699046d9949f65f3797abded`; direct source, Git history, CLI, lifecycle, security-boundary, persistence, metrics, benchmark, and GitHub issue evidence was also inspected.

Approval status: APPROVED

Approver: Hung Pham

Approval timestamp or task reference: explicit approval in the active Codex task on 2026-08-19 and instruction to continue implementation on `hunpeolabs/v1.5.0-team-control-plane`.

Approved scope:

- Safely realign the current branch with the official v1.4.0 history when concurrent WIP permits it without overwrite or destructive Git operations.
- Replace split JSON coordination writes with a transactional SQLite control-plane store in the Git common directory, including bounded migration, backup, health, recovery, and idempotency evidence.
- Add repository-scoped Ed25519 trust policy, revocation, constrained roles and capabilities, signed action envelopes, nonce replay protection, and explicit legacy-HMAC degraded status.
- Implement the complete claim-to-integration lifecycle: active claim, frozen result, queued package, exact-input review, admission or rejection, and terminal claim release.
- Verify actual Git commits, parent ancestry, changed paths, claim and approved-scope coverage, owner review requirements, stale inputs, dependencies, conflicts, and protected semantic evidence at admission time.
- Derive coordination metrics from the durable ledger and require signed runtime receipts before a benchmark can be classified as measured.
- Add operator CLI actions, deterministic tests, migration and recovery documentation, cross-platform CI coverage, canonical assets, and regenerated distribution artifacts.

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

- Preserve every pre-existing or concurrently-created worktree change; specifically do not overwrite, stage selectively into this change, or regenerate over the active product-content work.
- Do not force a merge with `origin/main` while overlapping WIP makes that unsafe; disclose the deferred realignment and complete it only after the worktree boundary is safe.
- Use the already-declared `better-sqlite3` dependency; add no new runtime dependency.
- Use parameterized SQL, `BEGIN IMMEDIATE`, WAL, full synchronous durability, foreign keys, a bounded busy timeout, strict schema validation, and forward-only migrations with backup and documented rollback.
- Keep secrets, private keys, raw prompts, source contents, chat history, credentials, and chain-of-thought out of repository-tracked state, events, metrics, and benchmark receipts.
- A self-declared role, caller-provided digest, elapsed lease, plain hash, or synthetic fixture cannot authorize admission or support a release-grade/world-class claim.
- Preserve compatibility through explicit migration and legacy/degraded modes; do not silently reinterpret old records as trusted evidence.
- Do not commit, push, open or merge a pull request, tag, publish, create a GitHub Release, deploy, change rulesets, or mutate external infrastructure without separate authorization.

Explicit exclusions:

- Hosted or multi-tenant control-plane service.
- Autonomous merge, push, release, deployment, repository-setting, issue-state, or messaging mutations.
- Production credentials, production data, external consensus, and claims of cross-host safety without an authenticated compatible shared backend.
- Fabricated benchmark results or claims that local tests alone prove production readiness.

Delta approval required when:

- A path outside this record, a new dependency, a hosted service, production access, destructive migration, or external mutation is required.
- A child agent or untrusted identity is allowed to self-authorize, integrate, release, or weaken repository protections.
- The storage, trust, public-contract, deployment, or validation boundary changes materially beyond this record.
