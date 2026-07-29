# Gemini CLI Repository Instructions

Use `.ai/` as the durable source of truth for repository policy and workflow.

@./.ai/core/required-workflow.md
@./.ai/core/instruction-precedence.md
@./.ai/core/quality-gates.md
@./.ai/core/output-contract.md

Run the Repository Intelligence Gate before analysis or implementation. For existing-system changes, stop after a concrete impact plan until the approval evidence required by `.ai/guards/implementation-approval-gate.yaml` exists. Use `.ai/PROMPTS.md` for task entry points. Do not commit, push, open a pull request, update a ticket, deploy, access production, or perform destructive work without explicit user authorization.
