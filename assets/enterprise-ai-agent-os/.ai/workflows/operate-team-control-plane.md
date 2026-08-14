# Operate the Repository Team Control Plane

1. Complete repository intelligence and implementation approval gates.
2. Create or inspect authenticated principal and host attestations. Keep signing
   material outside repository state and pass it through the approved secret
   mechanism.
3. Plan the team with repository control enabled and bind the approved parent
   commit.
4. Register the task in the repository registry.
5. Plan and explicitly provision one isolated branch/worktree per writer.
6. Dispatch only after parent, identity, workspace, task-local claim, and
   repository-surface admission all pass.
7. Heartbeat both claims. Treat an expired repository lease as an irreversible
   stale-writer boundary; the old token never becomes current again.
8. Validate the current fence before accepting a handoff or result.
9. Create a change package with surface inventory, evidence, rollback reference,
   dependencies, author identity, parent, claim, and fencing token.
10. Run structured conflict analysis, independent review, and required-owner
    escalation.
11. Let the Integration Owner admit packages in dependency order. Record every
    blocked or accepted decision and never merge from a child-agent session.
12. Export privacy-safe metrics and evaluate SLOs. Missing samples remain
    `INSUFFICIENT_EVIDENCE`.
13. Recover by stopping admission, inspecting sealed state, resolving orphaned
    workspaces and claims, and resuming only current packages.
