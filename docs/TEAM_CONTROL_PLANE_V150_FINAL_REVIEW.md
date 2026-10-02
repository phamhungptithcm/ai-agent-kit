# Team Control Plane v1.5.0 Final Review Record

Review date: 2026-08-20

Approval: `AAK-TEAM-CONTROL-PLANE-V150-HARDENING-002`, approved by Hung Pham

Branch: `hunpeolabs/v1.5.0-team-control-plane`

Reviewed base: `4d44e3b88eda4b97699046d9949f65f3797abded`

## Result

Implementation review status: `PASSED_WITH_RELEASE_GATES`

Release status: `BLOCKED`

No unresolved P0 or P1 finding remains in the reviewed Team Control Plane
implementation. Canonical generation, packed-package smoke, official v1.4.1
lineage, and supported Node/OS non-publishing CI are complete on the release
candidate. Publication remains blocked by release-owner authorization and the
absence of the real-task comparative benchmark required for outcome claims.

## Reviewed dimensions

- transactional correctness, initialization races, rollback, busy handling,
  fencing, idempotency, and recovery;
- repository trust bootstrap, constrained Ed25519 delegation, revocation,
  signed actions, durable nonce replay, and authorization evidence;
- Git object, ancestry, deletion, rename, binary diff, declared surface, claim,
  completion receipt, parent, and dependency binding;
- independent review, authenticated owner approval, CODEOWNERS precedence and
  parent-commit policy binding;
- integration lifecycle authority and separation of author, reviewer, and
  Integration Owner;
- migration source integrity, backup retention, path safety, bounded reads, and
  rollback documentation;
- ledger-derived privacy boundaries and signed benchmark provenance;
- CLI authorization boundaries, schema contracts, CI hooks, operator guidance,
  and release-claim honesty.

## Findings resolved during review

| ID | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| TCP-001 | P1 | Concurrent first-open could race while creating schema; health threw on canonical tampering. | Added transaction-rechecked bootstrap, existing-schema fast path, structured degraded health, and concurrency/tamper tests. |
| TCP-002 | P1 | Git changed-path collection omitted deletions and did not cover both rename endpoints. | Parse NUL-delimited name-status evidence and bind deletion, rename, and copy paths. |
| TCP-003 | P1 | Generic claim release could synthesize `ADMITTED` or `REJECTED` without integration review. | Reserved those states for integration decisions; frozen claims only allow operator revocation. |
| TCP-004 | P1 | Single-segment path globs were broadened by conservative conflict-prefix logic. | Added a strict admission glob matcher while preserving conservative conflict detection. |
| TCP-005 | P1 | Package verifier accepted unhashed extra fields that were persisted by enqueue. | Reject restricted and unknown fields, bind author trust, and separate immutable package fields from internal lifecycle fields. |
| TCP-006 | P1 | CODEOWNERS `@owner` values failed generic ID validation and policy was read from mutable worktree state. | Added owner-specific validation, exact-parent Git reads, requirement digests, and admission-time drift checks. |
| TCP-007 | P1 | Trust nonce consumption and key mutation were not one atomic transaction; bootstrap evidence was absent from the durable event. | Wrapped authorization and mutation atomically and ledger-bound approval or signed-action evidence. |
| TCP-008 | P2 | Legacy migration could preview, parse, and back up different file contents during a concurrent change. | Added bounded no-follow reads, pre-apply re-hash, and backup of the exact imported buffers. |
| TCP-009 | P1 | A caller-provided public-key string could satisfy benchmark receipt verification. | Require active host-bound Ed25519 key policy, capability, validity window, profile, bounded methodology, and unique case/run IDs. |

## Verification evidence

- Focused Team Control Plane suites: `20/20` passed.
- Full repository test suite after the final review fixes: `214/214` passed.
- Lint passed across 108 files; typecheck passed across 102 files.
- Eval, system-design, team, memory, adapter-conformance, supply-chain, schema
  parse, approval validation, diff check, and high-severity npm audit passed
  during this implementation cycle.
- Final clean release-candidate revalidation passed lint across 121 files,
  typecheck across 114 files, `253/253` tests, canonical evidence checks, build,
  packed-install smoke, Node 20/24, macOS, and Windows transactional recovery.

## Remaining release gates

- Run at least 30 comparable real task cases across all four modes before making
  a productivity, quality, latency, or cost improvement claim.
- Release owner reviews limitations, package contents, CI evidence, and merge
  order with the stacked v1.6.0 candidate.
- Obtain separate authorization for merge, tag, GitHub Release, npm
  publish/provenance, or deployment.

## Known boundary

The bundled SQLite backend coordinates processes and linked worktrees sharing
one Git common directory. It is not distributed consensus for independent
clones or hosts. Cross-host enforcement remains unverified without an
authenticated compatible shared transactional backend.
