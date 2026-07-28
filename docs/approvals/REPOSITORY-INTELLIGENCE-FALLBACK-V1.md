# Implementation Approval Record

Plan ID/version: REPOSITORY-INTELLIGENCE-FALLBACK-V1

Repository intelligence gate status: READY

Approval status: APPROVED

Approver: repository owner (`phamhungptithcm`)

Approval timestamp or task reference: active Codex task on 2026-07-27

Approved scope:

- Fix dot-prefixed path normalization so `.ai/local/repository-intelligence-state.json` is excluded from the worktree signature.
- Add regression coverage proving state writes do not invalidate the signature.
- Make missing, stale, unhealthy, or un-installable CodeGraph/CocoIndex report `DEGRADED` without blocking repository work.
- Define bounded native fallback evidence and preserve human-approval and critical-change gates.
- Synchronize generated adapter skills, distribution files, documentation, and tests.

Approved paths:

- `assets/enterprise-ai-agent-os/**`
- `dist/**`
- `docs/approvals/REPOSITORY-INTELLIGENCE-FALLBACK-V1.md`
- `src/templates.mjs`
- `test/bootstrap.test.mjs`

Required constraints:

- CodeGraph and CocoIndex remain preferred when ready.
- Installation and refresh are attempted at most once before fallback.
- Degraded mode must disclose unavailable evidence and avoid unsupported completeness claims.
- Human approval, sensitive-data, and critical-change protections remain fail-closed.
- No dependency, hosted service, production mutation, or release action.

Delta approval required when:

- A path outside this record is required.
- A security or approval gate is weakened.
- A package version, tag, publish, or deployment action is proposed.
