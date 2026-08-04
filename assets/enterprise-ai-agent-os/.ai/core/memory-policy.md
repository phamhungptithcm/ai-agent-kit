# Memory Policy

Repository memory is durable team knowledge. It is not a substitute for reading current source code, tests, approved architecture docs, or task-specific approval evidence.

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

## Approval States

- `PROPOSED`: candidate was reported in an output contract but is not retrievable by default.
- `APPROVED`: reviewed by a Memory Approver and allowed for retrieval.
- `REJECTED`: must not be retrieved or reused.
- `STALE`: requires review before retrieval.
- `SUPERSEDED`: replaced by a newer approved memory entry.

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
- Score retrieval by source priority, scope match, confidence, recency, and stale-review status.
- Verify critical memory-backed claims against source code or approved docs before acting.

## Review Cadence

Memory Approvers must run a quarterly stale review for approved entries. Entries past review date become `STALE` until re-approved, superseded, or rejected.

## Lifecycle 2.0

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
