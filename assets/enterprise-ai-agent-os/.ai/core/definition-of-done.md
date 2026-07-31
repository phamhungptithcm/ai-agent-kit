# Definition Of Done

Completed AI-assisted engineering work must be able to answer:

- What business requirement was implemented or analyzed?
- What changed from the user, operator, or system perspective?
- Which components changed and why?
- What tests were added or updated?
- Which commands ran, and what were the actual results?
- What is the status and evidence for each required quality gate?
- Did authorization, PII, secrets, validation, or data retention behavior change?
- Did queries, network calls, memory usage, concurrency, or transaction boundaries change?
- What logs, metrics, traces, or other evidence can verify behavior?
- Does deployment require configuration, migration, sequencing, or communication?
- How can the change be rolled back?
- Are there approved-safe memory candidates, or is the answer explicitly `None`?
- What remains uncertain or unverified?
- What percentage of weighted acceptance criteria is verified, what is complete, and what remains?
- What provider-reported token usage is available, and is monetary cost estimated, partial, actual, or unavailable?
- Is the current Git worktree clean, and are passing quality records bound to the current commit?
- Is production readiness `READY`, `NOT_READY`, `NOT_ASSESSED`, or `NOT_APPLICABLE`, and which blockers support that status?
- For public web changes, are canonical/indexing intent, crawler policy, structured data integrity, content claims, and verification evidence explicit?
- For user-facing visual changes, are audience, design direction, existing-system fidelity, responsive composition, UI states, accessibility, motion, and screenshot or browser evidence explicit?
- For material animation changes, are purpose, frequency, timing, reduced-motion behavior, interruption, cancellation, gesture parity, performance, compatibility, cleanup, and trace or browser evidence explicit?
