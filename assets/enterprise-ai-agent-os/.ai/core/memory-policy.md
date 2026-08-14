# Memory Policy

Repository memory is durable team knowledge. It is not a substitute for reading current source code, tests, approved architecture docs, or task-specific approval evidence.

## Four Different Context Layers

1. Mandatory policy and instructions stay checked in, for example in
   `AGENTS.md` and `.ai/core/`. Durable memory is never the sole source of a
   mandatory rule.
2. Host conversation state belongs to the host session and is not copied into
   repository memory.
3. Team context is task-scoped, revisioned coordination data with immutable
   handoffs.
4. Durable memory contains only reviewed, reusable repository knowledge using
   `memory-entry-v3`.

## Allowed Memory Categories

- Architecture decisions that remain valid across tasks.
- Module ownership and maintainer routing.
- Stable domain vocabulary and business rules verified from approved sources.
- Reusable implementation patterns and integration constraints.
- Testing, release, migration, observability, and operational conventions.
- Known recurring failure modes with validated mitigations.

## Denied Memory Categories

- Secrets, credentials, API keys, tokens, certificates, private keys, or session material.
- Raw PII, PHI, PCI, regulated data, production customer data, or private employee data.
- Temporary incident details that identify customers, accounts, or sensitive operations.
- Speculation, unreviewed chat conclusions, personal preferences, or stale workarounds.
- Information that conflicts with current source, tests, or approved architecture docs.
- Data copied from logs, tickets, emails, or external systems without permission to retain.
- Raw prompts, system prompts, chat history, chain-of-thought, hidden reasoning,
  source bodies, raw tool output, or opaque session material.

## Required Fields

Each memory entry must use `.ai/templates/memory-entry.yaml` and include:

- Title
- Category
- Scope
- Content
- Source
- Confidence
- Status
- Approver
- Review date
- Organization/repository identity and visibility scope
- Provenance/content/evidence hashes
- Sensitivity, ACL, and retention policy

## Approval States

- `PROPOSED`: candidate was reported in an output contract but is not retrievable by default.
- `APPROVED`: reviewed by a Memory Approver and allowed for retrieval.
- `REJECTED`: must not be retrieved or reused.
- `STALE`: requires review before retrieval.
- `SUPERSEDED`: replaced by a newer approved memory entry.
- `REVOKED`: approval was withdrawn with a durable tombstone.
- `EXPIRED`: retention expiry passed.
- `QUARANTINED`: content or provenance requires security/privacy review.

## Source Priority

When sources conflict, trust them in this order:

1. Current source code
2. Tests
3. Approved architecture docs
4. Approved memory
5. Historical discussion
6. Agent inference

## Retrieval Rules

- Retrieve approved memory only after current task context and repository intelligence are known.
- Prefer confidence `>= 0.8`; lower-confidence approved memory requires source re-verification before use.
- Return at most 5 entries by default and never more than 10 entries for one task.
- Apply lifecycle, conflict, ACL, organization/repository identity, visibility,
  and source-reachability filters before keyword or semantic ranking.
- Score retrieval by source priority, scope match, confidence, recency, and stale-review status.
- Verify critical memory-backed claims against source code or approved docs before acting.
- Record selected IDs, hashes, scores, reason codes, exclusions, and token budget
  in a privacy-safe retrieval receipt. Do not record content or hidden reasoning
  in the receipt.
- Optional semantic ranking may reorder only the entries that already passed all
  hard filters. Failure falls back to deterministic keyword ordering.

## Review Cadence

Memory Approvers must run a quarterly stale review for approved entries. Entries past review date become `STALE` until re-approved, superseded, or rejected.

## Lifecycle 3.0

- Approved entries require a future review date and a source commit reachable
  from the current repository history.
- Expired, revoked, stale, superseded, or source-unreachable entries are
  excluded from default retrieval.
- Revocation uses a durable tombstone. Supersession names the approved
  replacement and preserves history.
- Every retrieved result includes source, source commit, approver, confidence,
  and lifecycle state.
- Deterministic scoped retrieval runs before any optional semantic retrieval.
- Memory health reports conflicts and lifecycle exclusions without exposing the
  memory content.

## Storage And Portability 3.0

- Local SQLite with WAL and transactions is the concurrent source of truth.
  JSONL is deterministic audit interchange and v2 compatibility input only.
- Lifecycle writes use optimistic revisions and idempotent receipts. Database,
  symlink, traversal, oversized record, malformed import, and unsafe migration
  errors fail closed.
- v2 migration is previewed before apply, creates a content-identical backup,
  records created/preserved/rejected/conflicting items, and can roll back only
  the unchanged imported revisions.
- Cross-worktree or cross-host import requires matching organization and
  repository identity, signature verification, expiry, nonce replay protection,
  and explicit remote-write authorization.
- A remote adapter must prove ACL, audit, TLS/in-transit encryption, at-rest
  encryption, retention, repository binding, and replay protection capabilities.
  A remote outage reports `DEGRADED` and preserves safe local reads.

## Subagent Promotion

- Subagents may place bounded candidates in completed evidence-bound handoffs.
- The Team Lead verifies or rejects a current candidate. Identical candidates
  deduplicate; conflicting candidates remain blocked until an evidence-bound
  conflict decision exists.
- A named Memory Approver, different from the proposing agent, performs the
  promotion. Promotion is idempotent and never stores prompts, conversations,
  reasoning, credentials, or source bodies in its receipt.
