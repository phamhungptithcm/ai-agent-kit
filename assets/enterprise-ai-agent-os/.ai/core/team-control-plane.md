# Repository Team Control Plane

The Team Control Plane extends task-local Agent Department coordination to all
active tasks and linked worktrees in one repository. Its authority is the Git
common directory, not an individual checkout. A repository identity, task,
assignment, principal, workspace, lease, and monotonic fencing token bind every
write-capable dispatch.

## Admission invariants

1. Authenticate the member, agent, or host through the repository Ed25519 trust
   policy and validate expiry, issuer, delegated roles/capabilities, revocation,
   and evidence digest. Treat legacy HMAC as degraded, not release-grade trust.
2. Register the task against the current repository and approved parent commit.
3. Inspect the assignment worktree. Writers require an isolated, clean worktree
   sharing the same Git common directory and exact parent snapshot.
4. Acquire repository surfaces before task-local work. Any write overlap across
   tasks blocks admission.
5. Freeze a completed writer as `RESULT_READY`; do not release its integration
   fence before the package is admitted, rejected, or explicitly revoked.
6. Derive candidate paths and the binary diff digest from Git, bind the exact
   package inputs to review, and recompute admission inside the decision write.
7. Require a short-lived signed action envelope and durable nonce consumption
   for release-grade Integration Owner decisions.

Claims cover paths and higher-order surfaces: symbols, APIs, schemas,
migrations, dependencies, and generated outputs. Unknown protected surfaces
fail closed. Generated files must identify their canonical source.

## Authority boundaries

The local registry coordinates processes and linked worktrees sharing one Git
common directory. It is not distributed consensus. Cross-host execution is
trusted only when an operator-provided verifier authenticates a bounded,
expiring, replay-protected host attestation and the hosts share a compatible
registry backend.

Child agents cannot push, merge, tag, publish, deploy, change repository
settings, or mutate production. They return a frozen diff and evidence receipt.
A separately identified Integration Owner establishes the candidate commit and
admits its package in dependency order after an independent reviewer and
authenticated required owners approve the exact current inputs.

Registry, event, metric, and attestation data must never contain prompts, source
bodies, chat history, private reasoning, credentials, or secrets.

## Recovery

Stop new admissions, inspect the transactional SQLite authority, run integrity
and migration health, validate leases and worktree ownership markers, and
explicitly take over or revoke abandoned claims with recovery evidence. An
elapsed lease remains `EXPIRED_PENDING_RECOVERY` and continues blocking overlap.
Never delete an unowned worktree or revive an old fencing token.
