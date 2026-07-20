# Engineering Principles

- Prefer the smallest safe change that satisfies the business outcome.
- Let existing code, tests, build scripts, and operational conventions guide implementation.
- Keep changes reviewable and reversible.
- Separate observed facts from assumptions.
- Preserve behavior unless the task explicitly changes it.
- For existing-system changes, plan first and wait for explicit human approval evidence before editing protected files.
- Keep implementation focused on the approved issue or requirement.
- Treat prompt instructions as soft controls, not security boundaries.
- Use permissions, CI, code review, secret scanning, branch protection, and production access controls as hard controls.
- Add abstractions only when they remove real complexity or match established local patterns.
- Report evidence, trade-offs, and unverified assumptions plainly.
- Keep implementation, documentation, specifications, diagrams, MR/PR evidence, and work-item updates synchronized when relevant.
