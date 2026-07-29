---
name: compile-task-context
description: Build a deterministic, task-aware context pack with provenance, token budgeting, and repository-intelligence status.
---

# Compile Task Context

Use this skill after a governed runtime task exists and before detailed planning
or implementation needs a bounded context set.

## Procedure

1. Read `.ai/core/context-compiler.md`.
2. Confirm the task ID and its acceptance criteria.
3. Run `ai-agent-kit context compile --id <task-id> --budget <tokens>`.
4. Review both emitted JSON and Markdown artifacts.
5. Treat `BLOCKED` as a hard stop.
6. Treat `DEGRADED` as usable for inspection only; it does not satisfy a READY
   implementation gate.
7. Record the content hash and any material exclusions in the task evidence.

Do not manually add unapproved memory or remove mandatory policy to fit a budget.
