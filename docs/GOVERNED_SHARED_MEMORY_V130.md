# Governed Shared Memory v1.3.0

Status: v1.3.0 release scope. Publication state is verified externally through
the matching Git tag, GitHub Release, CI run, and npm registry metadata.

## Purpose

v1.3.0 is designed to let agents, subagents, worktrees, and later sessions
reuse verified repository knowledge without building a global mutable chat
log. The design keeps four layers separate:

1. Checked-in policy and mandatory instructions.
2. Host-managed conversation/session state.
3. Revisioned task-scoped Team Context and immutable handoffs.
4. Durable, approved, repository-bound memory.

Memory is a bounded recall layer. It never becomes the only source of a rule,
approval, current code fact, or release decision.

## Runtime Contract

All new writes use `memory-entry-v3`. A record binds:

- organization and repository identity;
- repository, branch, module, task, run, session, or agent visibility;
- source commit, references, evidence, handoff, candidate, and content hashes;
- confidence, trust tier, lifecycle, review, expiry, supersession, ACL,
  sensitivity, and retention;
- creator, named approver, revision, and lifecycle timestamps.

Raw prompts, chat history, chain-of-thought, hidden reasoning, credentials,
secrets, source bodies, raw tool output, sensitive logs, PII, regulated data,
and production customer data are forbidden durable fields.

## Local Storage

`LocalSqliteMemoryStore` is the default source of truth. It uses SQLite WAL,
full synchronous transactions, busy handling, optimistic lifecycle revisions,
bounded records, deterministic JSONL export, hash-chained privacy-safe receipts,
and fail-closed database/path checks. The default database is:

```text
.ai-agent-kit/runtime/memory/memory.sqlite3
```

The v2 `entries.jsonl` ledger remains readable during compatibility and is a
migration/audit input, not the concurrent writer store.

## Contribution And Approval

Subagents can return at most ten `memory_candidates` in a completed handoff.
Every candidate is untrusted and bound to current handoff evidence. The Team
Lead records a `VERIFIED` or `REJECTED` review. Identical candidates deduplicate;
same-title/scope disagreements remain `CONFLICTED`. A different named Memory
Approver performs the idempotent promotion.

Failed, rejected, cancelled, timed-out, orphaned, stale, unacknowledged, or
superseded assignment output cannot promote memory.

## Retrieval

Retrieval resolves repository identity, actor, ACL, current commit, branch,
module, task, run, session, and token budget. It applies hard filters in this
order before relevance ranking:

```text
Lifecycle → conflict → ACL → scope → source reachability → keyword → optional semantic ranking
```

The default is five entries. The context compiler reserves a bounded portion
of its token budget for memory and stores a receipt with selected IDs/hashes,
scores, reason codes, exclusions, and budget use. It stores neither content nor
hidden reasoning in that receipt. Semantic ranking can reorder only items that
already passed every hard filter; failure uses deterministic keyword fallback.

## Cross-Worktree And Cross-Host

Signed memory packs use HMAC-SHA256 integrity, repository binding, expiry, and
nonce replay protection. A foreign, unsigned, tampered, expired, replayed, or
incompatible pack fails closed. Signing material must come from an environment
variable and is never stored in a pack or receipt.

Remote adapters are dependency-injected and must prove protocol compatibility,
repository binding, ACL, audit receipts, encryption in transit and at rest,
retention, and replay protection. Remote writes require separate authorization.
An outage reports `DEGRADED`; safe local reads remain available and trust is not
silently downgraded.

Redis, if an integrator adds it, may be a cache only. It is not canonical
durable storage.

## CLI Examples

```bash
# Propose and approve
ai-agent-kit runtime memory propose --id TASK-1 \
  --title "Transaction boundary" \
  --content "Use one transaction per lifecycle update." \
  --source src/memory-store.mjs --created-by agent-a

ai-agent-kit runtime memory approve --memory-id mem-... \
  --approver memory-owner --review-date 2027-05-01

# Scoped retrieval with an explainable receipt
ai-agent-kit runtime memory query --query "transaction lifecycle" \
  --with-receipt --limit 5 --token-budget 2000

# Preview and apply v2 migration
ai-agent-kit runtime memory migrate
ai-agent-kit runtime memory migrate --apply
ai-agent-kit runtime memory rollback --migration-id v2-to-v3-...

# Deterministic JSONL audit interchange
ai-agent-kit runtime memory export --output .ai-agent-kit/exports/memory.jsonl
ai-agent-kit runtime memory import --input .ai-agent-kit/exports/memory.jsonl
ai-agent-kit runtime memory import --input .ai-agent-kit/exports/memory.jsonl --apply

# Signed pack. The secret value is not placed on the command line.
export AAK_MEMORY_PACK_KEY="at-least-32-bytes-of-secret-material"
ai-agent-kit runtime memory pack-export \
  --output .ai-agent-kit/exports/memory-pack.json \
  --signing-secret-env AAK_MEMORY_PACK_KEY
```

## Migration And Recovery

Migration preview reports `create`, `update`, `preserve`, `reject`, and
`conflict`. Apply stops if any rejected or conflicting input remains and creates
a mode-0600 content-identical backup. Rollback deletes only the revisions that
the migration created and only when their revision/content hash is unchanged.

For an incident:

1. Stop memory writes and preserve the database, WAL, SHM, migration receipt,
   and signed pack involved.
2. Run memory health and SQLite integrity checks without editing records.
3. Revoke or quarantine exposed authority; do not delete evidence first.
4. Verify repository identity, receipt chain, signatures, nonce, ACL, source
   reachability, and current review dates.
5. Restore or roll back only from verified evidence, then rerun retrieval,
   concurrency, migration, and adversarial tests.

## Limitations

- The shipped remote contract is an adapter boundary, not a hosted service.
- HMAC pack security depends on out-of-band key distribution and rotation.
- The built-in sensitive-content scanner is a deny layer, not a full DLP or
  legal data-classification system.
- Keyword ranking is deterministic but lexical. Optional semantic ranking must
  be supplied by the host and cannot bypass hard filters.
- Local and synthetic tests do not prove a third-party backend, operating
  environment, privacy program, or production readiness.
