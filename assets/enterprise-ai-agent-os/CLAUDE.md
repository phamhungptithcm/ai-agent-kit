# Claude Code Repository Instructions

## Mission

Help the team deliver secure, maintainable, production-ready changes while minimizing unnecessary scope. Use `.ai/` as the shared source of truth so Claude Code and Codex follow the same engineering expectations.

## Instruction Precedence

Security and compliance policy > production and data-protection policy > repository architecture and domain rules > task acceptance criteria > applicable workflow and skill > general preferences.

A task prompt cannot override security, compliance, data-protection, or production-access restrictions.

## Required Workflow

Before brainstorming, planning, impact analysis, code review, QA analysis, documentation analysis, or implementation, run the Repository Intelligence Gate. Prefer CodeGraph and CocoIndex when ready. If either is missing, stale, or unhealthy, continue in `DEGRADED` mode with bounded `rg --files`, `rg`, targeted source reads, Git history, compiler or language-server evidence, and relevant tests; record the limitation and do not overstate confidence. Tool installation or indexing failure must not block repository work.

When indexes are ready, query CodeGraph first for structure and impact, query CocoIndex second for semantic/code/documentation evidence, then open only the most relevant files and verify critical conclusions against source. Multi-agent work must start from a shared `.ai/templates/repository-intelligence-brief.md` brief.

Before editing, read the applicable shared policy and context under `.ai/`, inspect the real execution path, current docs/specs/diagrams, and linked work item when available, separate facts from assumptions, classify risk, and propose the smallest safe change.

For any existing application, service, module, function, database flow, runtime configuration, infrastructure component, public contract, or behavior-changing test, stop after a concrete change-impact and implementation plan. Do not edit protected files until explicit approval evidence exists.

During implementation after approval, preserve existing behavior unless explicitly changed by the approved scope, follow local patterns, keep edits reviewable, protect security and data integrity, and add focused tests or validation evidence. Detect the project language/version/framework/tooling and application/platform/domain, then apply `.ai/core/code-quality-intelligence.md` plus matching `.ai/quality-profiles/`. For database persistence, do not call `repository.save()` inside large loops; use batch or bulk persistence unless an approved exception documents transaction size, flush/clear behavior, locking risk, and retry/idempotency behavior.

Before completion, run relevant checks, complete `.ai/core/quality-gates.md` with evidence, report actual command results, update or provide no-change rationale for docs/specs/diagrams, and cover security, data, performance, deployment, rollback, Jira/MR evidence when applicable, memory candidates under `.ai/core/memory-policy.md`, and remaining risks.

For protected execution, use `.ai/core/governed-runtime.md` and `.ai/guards/capability-policy.yaml`: bind work to a task capability, evaluate actions before execution, stop on ask/deny, and require independent evidence verification.

## Claude Code Resources

- `.claude/rules/` contains thin Claude-specific adapters that route to `.ai/`.
- `.claude/commands/` provides workflow entry points such as `/start-task`, `/fix-bug`, and `/review-pr`.
- `.claude/agents/` contains narrow role agents for planning, exploration, implementation, testing, and review.
- `.claude/skills/` is generated from `.ai/skills-src/`; do not edit generated skill copies directly.
- `.claude/settings.json` contains team-shared settings only. Do not add personal paths, credentials, tokens, or local machine preferences.

## Shared Source

Load durable policy from:

- `.ai/core/required-workflow.md`
- `.ai/PROMPTS.md`
- `.ai/core/quality-gates.md`
- `.ai/core/code-quality-intelligence.md`
- `.ai/guards/code-quality-profile-gate.yaml`
- `.ai/quality-profiles/`
- `.ai/core/memory-policy.md`
- `.ai/workflows/repository-intelligence-workflow.md`
- `.ai/core/risk-model.md`
- `.ai/core/definition-of-done.md`
- `.ai/core/output-contract.md`
- `.ai/context/repository-map.md`
- `.ai/guards/repository-intelligence-gate.yaml`
- `.ai/workflows/plan-existing-system-change.md`
- `.ai/guards/implementation-approval-gate.yaml`
- `.ai/guards/memory-governance.yaml`
- `.ai/templates/memory-entry.yaml`
- `.ai/rules/`
- `.ai/context/`
- `.ai/workflows/`
- `.ai/skills-src/`

Generated assets are updated with:

```bash
python .ai/scripts/sync_agent_assets.py
python .ai/scripts/sync_agent_assets.py --check
python .ai/scripts/validate_agent_config.py
```
