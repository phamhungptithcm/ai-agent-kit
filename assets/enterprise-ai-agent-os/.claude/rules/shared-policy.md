# Shared Policy Adapter

Claude Code must use `.ai/` as the shared source of truth.

Before edits, load applicable content from:

- `.ai/guards/repository-intelligence-gate.yaml`
- `.ai/workflows/repository-intelligence-workflow.md`
- `.ai/core/required-workflow.md`
- `.ai/core/risk-model.md`
- `.ai/rules/`
- `.ai/context/`
- `.ai/workflows/`
- `.ai/guards/implementation-approval-gate.yaml`

Generated skill copies under `.claude/skills/` must not be edited directly. Update `.ai/skills-src/` and run `python .ai/scripts/sync_agent_assets.py`.

Before brainstorming, planning, review, QA analysis, documentation analysis, or implementation, run the Repository Intelligence Gate, use CodeGraph first, use CocoIndex second, and verify critical facts against source code.

Existing-system changes require a reviewed change-impact plan and explicit approval evidence before protected files are edited.
