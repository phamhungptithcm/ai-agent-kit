# Team Control Plane Operator Guide

Use repository control mode when more than one task, member, process, or linked
worktree can edit the same repository. Task-local mode remains available for
backward compatibility but cannot prevent conflicts created by another task.

## Safe operating model

- The Team Lead owns task registration and scope decomposition.
- Each writer receives a unique branch and linked worktree.
- The Git-common-dir SQLite authority owns cross-task leases, fencing tokens,
  receipts, packages, reviews, decisions, trust, nonces, and event history.
- Agents return structured results and frozen diff receipts; they do not
  integrate or release their own completed claims.
- An independent reviewer cannot share the author's principal or subject.
- Required owners approve protected surfaces.
- The Integration Owner alone records package admission.

Release-grade identity files are Ed25519-authenticated, expiring, and constrained
by a repository public-key trust policy. Keep private keys in the approved
secret store. HMAC identities remain migration-only degraded evidence.

Bootstrap a public-key policy only with explicit approval, then inspect it:

```bash
ai-agent-kit team trust-register --file operator-public-key-policy.json \
  --approved-by <approver> --approval-hash <sha256> --apply
ai-agent-kit team trust-status
```

After bootstrap, every additional or replacement key requires an authenticated
operator identity and a signed `trust.register` action; bootstrap approval flags
cannot bypass the existing trust authority:

```bash
ai-agent-kit team trust-register --file next-public-key-policy.json \
  --identity-file operator.json --action-file signed-trust-action.json --apply
```

Use a distinct operator-managed key per trust domain. Sign each mutating action
with repository, task, operation, revision, payload hash, nonce, and a maximum
five-minute lifetime. Revoke a compromised key immediately; durable nonce
consumption rejects replay across processes.

The SQLite authority under the Git common directory is suitable for local
processes and linked worktrees. It uses WAL, `synchronous=FULL`, foreign keys,
strict schema validation, and immediate write transactions. For agents on
separate machines, install a compatible shared transactional backend and
authenticated host bridge. Without both, report cross-host enforcement as
unverified.

## Failure recovery

- Database busy: retry within the bounded busy budget; do not delete a lock or
  database file. If health is not `READY`, stop admissions and preserve WAL.
- Lease expired: never renew or silently replace the old writer. Keep
  `EXPIRED_PENDING_RECOVERY` blocking until an operator reviews workspace state,
  records recovery evidence, and creates a higher fenced takeover claim.
- Parent drifted: rebase or rebuild the package outside the child-agent runtime,
  rerun evidence, and request review again.
- Writer vanished: mark the task-local writer orphaned, inspect the isolated
  worktree, revoke/expire its repository claim, and decide whether to salvage.
- Partial worktree creation: use `git worktree list --porcelain`, verify the
  kit-owned marker in the Git common directory, then retry or explicitly clean.
- Queue blocked: inspect actual Git evidence, completion receipt, dependencies,
  fence, parent, exact-input review, authenticated owners, Pulse/protected
  surfaces, conflict analysis, and rollback evidence in that order.

## Migration from v1.4

Existing task-local plans keep working with control mode disabled. Before opt-in,
finish or cancel live v1.4 writers. Run `team registry-migrate` as a preview,
apply only after reviewing its source hashes and backup path, then require
`team registry-health` to be `READY`. Keep the retained JSON and SQLite database
for rollback evidence; do not dual-write both formats. Enable `--control-plane`,
provide authenticated identities at lifecycle calls, and dispatch each writer
against an isolated worktree.
