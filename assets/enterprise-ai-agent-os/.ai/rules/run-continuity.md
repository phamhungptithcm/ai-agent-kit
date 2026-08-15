# Run Continuity

- Recover from the run envelope, decision chain, receipts, worktree, and parent snapshot before continuing.
- Preview recovery and deduplicate completed actions before any write.
- Revalidate stale assumptions, affected checks, approvals, and parent-branch drift.
- Resume by appending a recovery event; never reconstruct history as if interruption did not occur.
- Protected action, material scope expansion, conflict, or parent drift requires explicit human approval.
- Never use resume authority to pull, merge, rebase, commit, push, deploy, publish, or release.
