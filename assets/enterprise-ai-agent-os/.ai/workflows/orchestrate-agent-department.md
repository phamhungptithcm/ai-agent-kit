# Orchestrate Agent Department

1. Complete the repository intelligence brief once.
2. Run `ai-agent-kit team plan --id <task-id>` after task creation and inspection.
3. Review team type, reason codes, budgets, dependencies, write ownership, and approval boundary.
4. Run `team start` with the active adapter. Dispatch native subagents when supported; otherwise execute assignments as serial personas.
5. Run `team context` and give each specialist only its assignment, brief hash, approved scope, dependency handoffs, and role-specific evidence.
6. Claim each assignment with `team claim` and the current revision. Parallelize only independent read work. Never duplicate a live claim or overlap write scope.
7. Publish facts, findings, risks, tests, paths, questions, and evidence with `team handoff`. Sync and retry if optimistic concurrency rejects a stale revision.
8. If handoffs conflict, run `team conflict`; the Team Lead records the evidence-bound choice with `team decide`. Open conflicts block readiness.
9. Record each assignment result with its latest handoff and evidence hashes. Record timeout, rejection, or blocker honestly.
10. If independent review reports findings, return them to the implementation owner, fix, publish a new handoff, verify, and review again.
11. Run `team report`. Do not issue successful final evidence until shared context is current, conflicts are resolved, review independence is verified, and the latest review is clean.
