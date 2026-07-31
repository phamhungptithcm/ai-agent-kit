# Aider Repository Conventions

Use `.ai/` as the durable source of truth for repository policy, workflow, quality profiles, and evidence.

Before analysis or implementation, follow `.ai/core/required-workflow.md` and run the Repository Intelligence Gate. Existing-system changes must stop after a concrete impact plan until the approval evidence required by `.ai/guards/implementation-approval-gate.yaml` exists.

Use `.ai/PROMPTS.md` for task entry points. Apply `.ai/core/quality-gates.md`, render `.ai/core/task-completion-report.md`, and report actual progress, remaining work, production readiness, token usage, cost status, and validation evidence before completion. Do not commit, push, open a pull request, update a ticket, deploy, access production, or perform destructive work without explicit user authorization.
