# Threat Model: Governed Shared Memory v1.3.0

Status: implementation assurance artifact. Reassess for every remote adapter,
new data class, identity provider, cryptographic key system, or retention rule.

## Assets And Trust Boundaries

Protected assets are approved repository knowledge, lifecycle authority, ACLs,
source/evidence bindings, signing keys, receipts, migration backups, and tenant
isolation. Trust boundaries exist between subagents, Team Lead, Memory Approver,
local process, filesystem/SQLite, Git history, signed packs, remote transport,
remote store, and the context consumer.

Prompts, handoffs, memory candidates, imported packs, connector responses,
remote capability claims, and historical JSONL are untrusted until the matching
validation and authorization gate passes.

## Threats And Controls

| ID | Threat | Primary controls | Release blocker |
| --- | --- | --- | --- |
| SM-01 | Persistent prompt injection stored as memory | Forbidden field/content scanner; candidates treated as data; no executable memory | Any approved injected instruction |
| SM-02 | Poisoned or false learning | Evidence hashes, reachable commit, Team Lead review, separate approver, conflicts blocked | Unauthorized/unsupported promotion |
| SM-03 | Stale authority reused | Review date, expiry, source reachability, branch/module/task scope, revocation and supersession | Stale entry selected |
| SM-04 | Cross-tenant/repository leakage | Stable organization/repository identity, ACL before ranking, repository-bound packs | Any foreign retrieval/import |
| SM-05 | Pack tampering or replay | HMAC-SHA256, entries hash, expiry, nonce ledger, timing-safe verification | Tampered/replayed pack accepted |
| SM-06 | Conflict suppression | Same title/scope content conflict detection; evidence-bound team conflict decision | Conflicted entry selected/promoted |
| SM-07 | Orphaned writer publishes memory | Completed current acknowledged handoff and assignment state required | Timed-out/cancelled/orphaned output promoted |
| SM-08 | Concurrent lost update | SQLite WAL transactions, busy retry, optimistic revision, idempotent IDs/receipts | Any bounded-profile lost update |
| SM-09 | Path/symlink/database substitution | Repository-contained regular paths, symlink rejection, SQLite integrity check | Unsafe path/database accepted |
| SM-10 | Migration overwrites customized state | Full preview, backup, conflict stop, unchanged-revision rollback | Silent overwrite or irreversible apply |
| SM-11 | Sensitive data persistence | Field denylist, secret/PII/log patterns, bounded records, quarantine status | Secret, credential, PII, regulated data persisted |
| SM-12 | Remote capability spoofing/downgrade | Protocol negotiation; required encryption/ACL/audit/retention/replay claims; separate write authorization | Silent capability downgrade |
| SM-13 | Remote outage becomes authority bypass | Explicit `DEGRADED`, local read fallback, no trust inference | Policy bypass during outage |
| SM-14 | Receipt leaks source or reasoning | IDs/hashes/scores/reason codes only; no content, prompt, or chain-of-thought | Sensitive receipt payload |

## Residual Risk

Pattern scanning cannot prove that arbitrary prose contains no sensitive or
regulated information. HMAC packs require secure key distribution and do not
provide asymmetric non-repudiation. A custom remote adapter can make dishonest
capability claims unless its deployment, TLS, storage encryption, audit system,
and retention behavior are independently verified. These remain deployment
and operational gates, not capabilities proven by local code.
