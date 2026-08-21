# Gemini CLI Repository Instructions

Use `.ai/` as the durable source of truth for repository policy and workflow.

@./.ai/core/required-workflow.md
@./.ai/core/conversation-entry-gate.md
@./.ai/core/instruction-precedence.md
@./.ai/core/quality-gates.md
@./.ai/core/output-contract.md

Run the Conversation Entry Gate before Repository Intelligence. Raw ideas and active Product Workspaces automatically enter `run-product-genesis`; users do not need to name a skill or version. For existing-system changes, run Repository Intelligence and stop after a concrete impact plan until the approval evidence required by `.ai/guards/implementation-approval-gate.yaml` exists. Use `.ai/PROMPTS.md` for task entry points. Do not commit, push, open a pull request, update a ticket, deploy, access production, or perform destructive work without explicit user authorization.

For any changed user-facing text, accessibility text, or displayed-data meaning, run the mandatory `write-product-content` skill with `.ai/quality-profiles/product-content.yaml`; map all eight Human Interface principles, verify target-platform fit, and complete `.ai/templates/product-content-review.md` from current in-context evidence before handoff. Apple HIG is platform-specific authority on Apple platforms and a quality reference elsewhere, never a license to copy Apple-only expression.
