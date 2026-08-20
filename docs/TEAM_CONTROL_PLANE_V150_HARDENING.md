# Repository Team Control Plane v1.5.0 hardening

Status: local implementation on `hunpeolabs/v1.5.0-team-control-plane`. This is not publication, deployment, or production evidence.

## Problem being solved

Parallel agents fail in practice when ownership, freshness, review, and integration are separate conventions instead of one enforceable state machine. A fast writer can finish against an old parent, a timed-out writer can return after its lease, a reviewer can approve different bytes from the bytes admitted, and two JSON files can each be valid while jointly representing an impossible state.

v1.5.0 hardens the local repository control plane around four invariants:

1. One transactional authority owns tasks, claims, completion receipts, packages, reviews, decisions, replay keys, trust policy, and the hash-linked event ledger.
2. A writer loses write authority when its result is frozen, but the integration fence remains valid until admission, rejection, or explicit operator revocation.
3. Review and admission bind the exact parent commit, candidate commit, actual Git diff, evidence set, policy digest, and optional Architecture Pulse evidence.
4. Release-grade mutations require a repository-trusted Ed25519 principal and a short-lived signed action envelope; a reusable HMAC identity is reported as legacy degraded trust.

## State model

```text
CLAIM_ACTIVE
  -> RESULT_READY
  -> PACKAGE_QUEUED
  -> REVIEWED
  -> ADMITTED | REJECTED | REVOKED
```

`RESULT_READY`, `PACKAGE_QUEUED`, and `REVIEWED` are frozen states. They preserve the integration fence but cannot be used for more writes or heartbeats. A normal release cannot skip directly from `ACTIVE` to `RELEASED` after a completed writer result.

An elapsed lease becomes `EXPIRED_PENDING_RECOVERY`. It continues blocking overlapping work until an operator or team lead supplies a SHA-256 recovery evidence digest and creates a replacement claim with a larger fencing token. Expiry alone is not takeover authority.

## Transactional authority

The SQLite database lives below the Git common directory:

```text
<git-common-dir>/ai-agent-kit/team-control/<repository-id>.sqlite3
```

Linked worktrees therefore resolve the same authority. Initialization fails closed on an unsafe path, symlink, hard-linked database, foreign repository binding, newer schema, unexpected trigger/view, or schema mismatch.

Runtime settings:

- WAL journal mode
- `synchronous=FULL`
- foreign keys enabled
- `trusted_schema=OFF`
- five-second busy timeout plus bounded busy retry
- `BEGIN IMMEDIATE` for state mutations
- parameterized SQL only
- bounded table and event budgets

The current schema separates repository metadata, tasks, claims and claim surfaces, packages and dependencies, reviews, decisions, completion receipts, events, idempotency keys, nonces, trusted keys, host attestations, and migration receipts. Registry and integration transitions now commit or roll back together.

## Trust and authorization

A trusted key policy binds:

- key ID and public Ed25519 key;
- issuer and principal;
- allowed roles and capabilities;
- maximum identity lifetime;
- validity window and active/revoked status.

Private keys are never stored in repository state. Initial trust bootstrap requires explicit approval evidence. Later trust changes require an active operator or team-lead identity with `trust.admin`.

An identity is a bounded delegation certificate. A signed action envelope proves use of that identity for one operation. It binds repository, optional task, operation, expected repository revision, payload hash, principal, key ID, nonce, issue time, and an expiry no longer than five minutes. The SQLite nonce table makes replay fail across processes.

HMAC identities remain readable for compatibility and focused migration tests. They are labeled `LEGACY_DEGRADED_HMAC` and cannot pass CLI release-grade admission.

## Git, review, and integration gates

Package creation and every admission recheck use Git itself to verify:

- both objects are commits;
- the candidate descends from the declared parent;
- the actual `parent..candidate` changed paths;
- a binary/full-index diff digest;
- declared path coverage;
- repository claim coverage;
- CODEOWNERS requirements loaded from the exact parent commit;
- current integration parent has not drifted.

A completion receipt freezes the claim, fencing token, principal, workspace snapshot, output commit if available, actual worktree diff digest, and evidence digests. The later committed package must have the same diff digest.

Review input is the digest of package, parent, candidate, Git diff, evidence, policy, and Pulse evidence. Changing any input makes the review stale. CODEOWNERS is read from the exact parent commit using normal repository-location precedence and last-match-wins evaluation; its requirement digest is rechecked during admission. Owner approval strings are not sufficient; an approval must include an authenticated matching identity and evidence digest.

Protected API, schema, migration, dependency, or generated surfaces require current Pulse evidence or an explicit human protected-surface review. Generated output without a canonical source remains unknown and blocks admission.

`integration-admit --apply` recomputes all admission facts inside the same `BEGIN IMMEDIATE` transaction that records the decision and terminates the claim. It also consumes the Integration Owner signed-action nonce in that transaction.

## Operator commands

Read-only inspection:

```bash
ai-agent-kit team registry-health
ai-agent-kit team registry
ai-agent-kit team integration-status
ai-agent-kit team integration-recover
ai-agent-kit team trust-status
ai-agent-kit team metrics-ledger
```

Legacy JSON migration is preview-first:

```bash
ai-agent-kit team registry-migrate
ai-agent-kit team registry-migrate --apply
```

Apply retains the legacy files, writes immutable backup copies below `legacy-backups/<migration-id>`, records a migration receipt, and imports in one database transaction. Rollback before v1.5 activation is: stop writers, retain the SQLite database as evidence, restore the backed-up JSON files to their original names, and run the v1.4 binary. Do not merge new SQLite and legacy writes in both directions.

Recovery takeover:

```bash
ai-agent-kit team claim-takeover \
  --claim <expired-claim-id> \
  --identity-file <operator-identity.json> \
  --recovery-evidence-hash <sha256>
```

Integration is preview then signed apply:

```bash
ai-agent-kit team integration-preview \
  --package-id <id> \
  --identity-file <integration-owner.json>

ai-agent-kit team action-sign \
  --file <action-input.json> \
  --identity-key-env AAK_TEAM_PRIVATE_KEY_PEM

ai-agent-kit team integration-admit \
  --file <preview-decision.json> \
  --identity-file <integration-owner.json> \
  --action-file <signed-action.json> \
  --apply
```

The CLI does not run `git merge`, `git push`, change repository settings, publish, deploy, or operate production infrastructure.

## Metrics and benchmark truth

`metrics-ledger` derives bounded coordination metrics from the transactional event ledger. The caller cannot submit arbitrary values through that command. Event dimensions are repository ID, bounded task class, event type, and timestamps; prompts, source bodies, tool output, credentials, and personal content are excluded.

Benchmark schema v3 requires a unique signed receipt for every run. The receipt binds case, mode, commit, host, model, complete run digest, signing key, timestamp, and `RUNTIME` or `SYNTHETIC` provenance. A fixture boolean cannot turn synthetic data into measured evidence. A release conclusion requires four modes, at least 30 cases, at least three repetitions per mode, trusted signatures, unique run IDs, runtime provenance, and complete comparable bindings. Results include distribution, variance, p95, and a 95% confidence interval.

No 30-case real-world benchmark has been run on this branch. The correct product claim remains “benchmark harness implemented; comparative outcome unavailable.”

## Failure evidence implemented

Focused automated tests cover:

- concurrent process writers without lost tasks;
- process death during an uncommitted transaction;
- canonical-row tampering and structured degraded health;
- explicit expired-claim takeover and stale-fence rejection;
- legacy migration preview, bounded no-follow reads, backup, apply-once, and source retention;
- atomic Ed25519 delegation, revocation, approval evidence, and nonce replay;
- CODEOWNERS precedence, parent-commit binding, and authenticated owner approval;
- actual Git ancestry, deletion/rename facts, strict glob coverage, diff, review input, and admission;
- rejection of unbound integration-package metadata and synthetic terminal decisions;
- completion result freeze instead of premature claim release;
- host-authorized signed runtime benchmark receipts;
- ledger-derived privacy-bounded metrics.

Passing local tests is not proof of deployed availability, independent-clone coordination, production capacity, repository ruleset configuration, or real-world productivity.

## Deployment and rollback constraints

- The backend coordinates local processes and linked worktrees sharing one Git common directory. It is not distributed consensus for independent clones or hosts.
- Cross-host work still needs authenticated host attestation plus a compatible shared transactional backend.
- Do not activate v1.5 writers until `registry-health` is `READY` and any legacy migration is `APPLIED` or `NOT_REQUIRED`.
- Back up the Git common-dir team-control directory before first activation.
- Keep v1.4 writers stopped after v1.5 begins; dual-write is unsupported.
- If schema initialization, integrity, trust, review, Git, or replay checks fail, stop admission and preserve the database, WAL, and operator evidence for diagnosis.

## Remaining release gates

- Safely realign this branch with official `origin/main` after the concurrent product-content worktree changes are separated or completed.
- Rebuild canonical generated assets and `dist` without overwriting concurrent WIP.
- Run the full repository check, packed-package smoke, Node/OS matrix, post-change repository intelligence, and independent final implementation/security review.
- Complete the external release chain only after separate authorization: commit, push, pull request, merge, annotated tag, GitHub Release, npm provenance, and artifact integrity verification.
