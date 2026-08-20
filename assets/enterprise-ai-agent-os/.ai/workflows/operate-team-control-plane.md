# Operate the Repository Team Control Plane

1. Complete repository intelligence and implementation approval gates.
2. Bootstrap or inspect repository-trusted Ed25519 public keys. Keep private
   signing material outside repository state. Use bounded delegated identities
   and short-lived signed actions for mutations.
3. Plan the team with repository control enabled and bind the approved parent
   commit.
4. Register the task in the repository registry.
5. Plan and explicitly provision one isolated branch/worktree per writer.
6. Dispatch only after parent, identity, workspace, task-local claim, and
   repository-surface admission all pass.
7. Heartbeat both claims. An expired repository lease becomes
   `EXPIRED_PENDING_RECOVERY`; keep it blocking until an operator supplies
   takeover evidence and receives a new fencing token.
8. Validate the write fence, accept the result, and freeze its worktree diff and
   evidence as `RESULT_READY` without releasing the integration fence.
9. Establish a candidate commit and create a package whose actual Git ancestry,
   paths, binary diff, claim coverage, receipt, evidence, and rollback reference
   all verify.
10. Run independent review against the exact input hash and authenticate every
    required CODEOWNERS approval.
11. Preview Integration Owner admission, sign the exact decision action, then
    apply. Recompute dependencies, parent, Git, review, conflicts, and fence in
    the same SQLite transaction that records the decision.
12. Export ledger-derived privacy-safe metrics and evaluate SLOs. Missing samples remain
    `INSUFFICIENT_EVIDENCE`.
13. Recover by stopping admission, checking `registry-health`, inspecting
    transactional state, resolving orphaned workspaces and claims, and resuming
    only current packages. Legacy JSON migration is preview-first, backed up,
    retained, and applied once.
