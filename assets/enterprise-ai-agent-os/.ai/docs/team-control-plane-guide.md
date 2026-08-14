# Team Control Plane Operator Guide

Use repository control mode when more than one task, member, process, or linked
worktree can edit the same repository. Task-local mode remains available for
backward compatibility but cannot prevent conflicts created by another task.

## Safe operating model

- The Team Lead owns task registration and scope decomposition.
- Each writer receives a unique branch and linked worktree.
- The repository registry owns cross-task surface leases and fencing tokens.
- Agents return structured results and change packages; they do not integrate.
- An independent reviewer cannot share the author's principal or subject.
- Required owners approve protected surfaces.
- The Integration Owner alone records package admission.

Identity files are HMAC-authenticated and expiring. Prepare the bounded identity
payload with an authentication `key_id` and `nonce`, keep the signing key in the
approved secret store, and sign through an environment-variable name rather
than writing key material into a command or file:

```bash
ai-agent-kit team identity-sign --file identity-input.json --identity-key-env AAK_IDENTITY_KEY > identity.json
ai-agent-kit team identity-verify --file identity.json --identity-key-env AAK_IDENTITY_KEY
```

Use a distinct operator-managed key per trust domain. Possession and role scope
of signing keys remain an operator responsibility; rotate a compromised key and
reject identities issued by it.

The file registry under the Git common directory is suitable for local
processes and linked worktrees. For agents on separate machines, install a
compatible shared backend and authenticated host bridge. Without both, report
cross-host enforcement as unverified.

## Failure recovery

- Registry lock exists: wait for a live transaction; recover only after the
  bounded stale interval and record recovery.
- Lease expired: never renew the old writer; acquire a new token after reviewing
  workspace state.
- Parent drifted: rebase or rebuild the package outside the child-agent runtime,
  rerun evidence, and request review again.
- Writer vanished: mark the task-local writer orphaned, inspect the isolated
  worktree, revoke/expire its repository claim, and decide whether to salvage.
- Partial worktree creation: use `git worktree list --porcelain`, verify the
  kit-owned marker in the Git common directory, then retry or explicitly clean.
- Queue blocked: inspect dependencies, fence, parent, review, owners, conflict
  analysis, and rollback evidence in that order.

## Migration from v1.4

Existing task-local plans keep working with control mode disabled. To opt in,
create an authenticated identity, enable `--control-plane` during planning,
provide the identity again at start/dispatch/heartbeat/ingest, and dispatch each
writer against an isolated worktree. Do not copy old live claims into the new
registry; allow them to finish or cancel them before migration.
