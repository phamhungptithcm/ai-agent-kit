# Aider Repository Conventions

Use `.ai/` as the durable source of truth for repository policy, workflow, quality profiles, and evidence.

Before analysis or implementation, follow `.ai/core/required-workflow.md` and run the Repository Intelligence Gate. Existing-system changes must stop after a concrete impact plan until the approval evidence required by `.ai/guards/implementation-approval-gate.yaml` exists.

Use `.ai/PROMPTS.md` for task entry points. Apply `.ai/core/quality-gates.md` and the mandatory `final-implementation-review`; successful handoff requires a current passing review. Render `.ai/core/task-completion-report.md` with reviewed areas, findings and fixes, progress, remaining work, production readiness, token usage, cost status, and validation evidence. Do not commit, push, open a pull request, update a ticket, deploy, access production, or perform destructive work without explicit user authorization.
