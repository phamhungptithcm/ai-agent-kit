---
name: resume-and-recover-run
description: Safely inspect, recover, and resume an interrupted AI agent run. Use after a crash, context loss, stale session, partial implementation, parent-branch change, missing evidence, or any request to continue previous agent work without duplicating or corrupting it.
---

# Resume and Recover Run

Reconstruct state from evidence before performing new writes.

## Workflow

1. Inspect the run envelope, decision chain, worktree, parent branch, claims, handoffs, checks, failures, and plugin receipts.
2. Classify the run as `RESUMABLE`, `NEEDS_APPROVAL`, `CONFLICTED`, or `UNRECOVERABLE`.
3. Produce a recovery preview with completed work, incomplete work, stale assumptions, changed dependencies, and the exact next action.
4. Revalidate scope and approval. Parent drift, protected actions, or material scope expansion require human approval.
5. Resume only with explicit apply authorization. Append a recovery event; never replace history.
6. Re-run checks affected by elapsed time, changed code, changed tools, or changed branch state.

## Safety

- Do not infer completion from files alone.
- Do not repeat an action whose receipt proves it already succeeded.
- Do not trust stale indexes or unverifiable handoffs.
- Do not pull, merge, rebase, commit, push, deploy, or release without separate authority.

## Output

Return recovery status, trusted checkpoint, drift summary, deduplicated remaining work, approval need, and next safe command.
