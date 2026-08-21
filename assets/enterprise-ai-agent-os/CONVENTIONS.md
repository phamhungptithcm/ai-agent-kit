# Aider Repository Conventions

Use `.ai/` as the durable source of truth for repository policy, workflow, quality profiles, and evidence.

Before Repository Intelligence, run `.ai/core/conversation-entry-gate.md`; raw ideas and active Product Workspaces automatically enter `run-product-genesis` without a skill or version prefix. Existing-system work then follows `.ai/core/required-workflow.md` and the Repository Intelligence Gate, and must stop after a concrete impact plan until the approval evidence required by `.ai/guards/implementation-approval-gate.yaml` exists.

Use `.ai/PROMPTS.md` for task entry points. Apply `.ai/core/quality-gates.md` and the mandatory `final-implementation-review`; successful handoff requires a current passing review. Render `.ai/core/task-completion-report.md` with reviewed areas, findings and fixes, progress, remaining work, production readiness, token usage, cost status, and validation evidence. Do not commit, push, open a pull request, update a ticket, deploy, access production, or perform destructive work without explicit user authorization.

When user-facing text, accessibility text, or displayed-data meaning changes, apply `write-product-content` and `.ai/quality-profiles/product-content.yaml`, map Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft, and Delight, verify target-platform fit, then complete `.ai/templates/product-content-review.md` with rendered or otherwise current in-context evidence. Isolated string review, incomplete principle evidence, or generic Apple-like styling cannot pass the gate.
