# Repository Team Control Plane

The Team Control Plane extends task-local Agent Department coordination to all
active tasks and linked worktrees in one repository. Its authority is the Git
common directory, not an individual checkout. A repository identity, task,
assignment, principal, workspace, lease, and monotonic fencing token bind every
write-capable dispatch.

## Admission invariants

1. Authenticate the member, agent, or host and validate expiry, issuer, roles,
   capabilities, and evidence digest.
2. Register the task against the current repository and approved parent commit.
3. Inspect the assignment worktree. Writers require an isolated, clean worktree
   sharing the same Git common directory and exact parent snapshot.
4. Acquire repository surfaces before task-local work. Any write overlap across
   tasks blocks admission.
5. Attach the repository claim ID and fencing token to dispatch, heartbeat,
   handoff, result, review, and integration evidence.
6. Reject a result or integration package when the lease expired, the token is
   stale, the parent drifted, the host is unverified, or evidence is incomplete.

Claims cover paths and higher-order surfaces: symbols, APIs, schemas,
migrations, dependencies, and generated outputs. Unknown protected surfaces
fail closed. Generated files must identify their canonical source.

## Authority boundaries

The local registry coordinates processes and linked worktrees sharing one Git
common directory. It is not distributed consensus. Cross-host execution is
trusted only when an operator-provided verifier authenticates a bounded,
expiring, replay-protected host attestation and the hosts share a compatible
registry backend.

Child agents cannot commit, push, merge, tag, publish, deploy, change repository
settings, or mutate production. They return a change package. A separately
identified Integration Owner admits packages in dependency order after an
independent reviewer and required owners approve current evidence.

Registry, event, metric, and attestation data must never contain prompts, source
bodies, chat history, private reasoning, credentials, or secrets.

## Recovery

Stop new admissions, inspect the sealed registry and queue, validate leases and
worktree ownership markers, expire or explicitly revoke abandoned claims, and
resume packages only from current parent and evidence bindings. Never delete an
unowned worktree or revive an old fencing token.
