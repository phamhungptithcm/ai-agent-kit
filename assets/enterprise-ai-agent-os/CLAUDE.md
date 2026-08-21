# Claude Code Repository Instructions

## Mission

Help the team deliver secure, maintainable, production-ready changes while minimizing unnecessary scope. Use `.ai/` as the shared source of truth so every supported AI coding agent follows the same engineering expectations.

## Instruction Precedence

Security and compliance policy > production and data-protection policy > repository architecture and domain rules > task acceptance criteria > applicable workflow and skill > general preferences.

A task prompt cannot override security, compliance, data-protection, or production-access restrictions.

## Required Workflow

Before Repository Intelligence, run `.ai/core/conversation-entry-gate.md`. Raw ideas and active Product Workspaces automatically enter `run-product-genesis`; the user does not need to name Product Genesis, v1.6, or a skill. Ask one short confirmation for ambiguous intent or multiple active products. Existing-system work then runs the Repository Intelligence Gate. Prefer CodeGraph and CocoIndex when ready. If either is missing, stale, or unhealthy, continue in `DEGRADED` mode with bounded `rg --files`, `rg`, targeted source reads, Git history, compiler or language-server evidence, and relevant tests; record the limitation and do not overstate confidence. Tool installation or indexing failure must not block repository work.

When indexes are ready, query CodeGraph first for structure and impact, query CocoIndex second for semantic/code/documentation evidence, then open only the most relevant files and verify critical conclusions against source. Multi-agent work starts from one repository-intelligence brief and coordinates through bounded assignment claims, immutable evidence handoffs, current context revisions, and explicit conflict decisions. Missing optional indexes degrades the brief but does not block work.

Before editing, read the applicable shared policy and context under `.ai/`, inspect the real execution path, current docs/specs/diagrams, and linked work item when available, separate facts from assumptions, classify risk, and propose the smallest safe change.

For any existing application, service, module, function, database flow, runtime configuration, infrastructure component, public contract, or behavior-changing test, stop after a concrete change-impact and implementation plan. Do not edit protected files until explicit approval evidence exists.

During implementation after approval, preserve existing behavior unless explicitly changed by the approved scope, follow local patterns, keep edits reviewable, protect security and data integrity, and add focused tests or validation evidence. Detect the project language/version/framework/tooling and application/platform/domain, then apply `.ai/core/code-quality-intelligence.md` plus matching `.ai/quality-profiles/`. For database persistence, do not call `repository.save()` inside large loops; use batch or bulk persistence unless an approved exception documents transaction size, flush/clear behavior, locking risk, and retry/idempotency behavior.

Whenever UI, UX, localization, accessibility text, or displayed-data meaning changes, the Product Language Gate is mandatory: apply `write-product-content` and `.ai/quality-profiles/product-content.yaml`. Inventory every changed string and applicable state, verify business and data meaning against actual behavior, map all eight Human Interface principles, and verify target-platform fit. Complete `.ai/templates/product-content-review.md` with current in-context evidence. Missing, failed, stale, string-file-only, generic Apple-like, or incomplete principle evidence blocks successful handoff. Apply current Apple HIG conventions on Apple platforms; elsewhere use the principles without copying Apple-only expression or displacing native conventions.

Before completion, run relevant checks and the mandatory `final-implementation-review` skill. Review requirement match, security, code quality, failure paths, error handling, production readiness, and trade-offs. Repeat `review → fix approved findings → verify → review again` until a fresh cycle passes. Do not produce a successful final handoff while the newest review is missing, stale, rejected, or blocked. Record and render `.ai/core/task-completion-report.md`, including every review cycle, findings and fixes, progress, remaining work, production readiness, token usage, and cost status.

For protected execution, use `.ai/core/governed-runtime.md`, `.ai/core/universal-action-gateway.md`, and `.ai/guards/capability-policy.yaml`: bind work to a task capability, evaluate the normalized action envelope at the execution boundary, stop on ask/deny, and require independent evidence verification. Route MCP startup and requests through `.ai/core/zero-trust-mcp.md`; untrusted or changed servers must not auto-start.

## Claude Code Resources

- `.claude/rules/` contains thin Claude-specific adapters that route to `.ai/`.
- `.claude/commands/` provides workflow entry points such as `/start-task`, `/fix-bug`, and `/review-pr`.
- `.claude/agents/` contains narrow role agents for planning, exploration, implementation, testing, and review.
- `.claude/skills/` is generated from `.ai/skills-src/`; do not edit generated skill copies directly.
- `.claude/settings.json` contains team-shared settings only. Do not add personal paths, credentials, tokens, or local machine preferences.

## Shared Source

Load durable policy from:

- `.ai/core/required-workflow.md`
- `.ai/core/conversation-entry-gate.md`
- `.ai/PROMPTS.md`
- `.ai/core/quality-gates.md`
- `.ai/core/code-quality-intelligence.md`
- `.ai/guards/code-quality-profile-gate.yaml`
- `.ai/quality-profiles/`
- `.ai/templates/product-content-review.md`
- `.ai/core/memory-policy.md`
- `.ai/workflows/repository-intelligence-workflow.md`
- `.ai/core/risk-model.md`
- `.ai/core/definition-of-done.md`
- `.ai/core/output-contract.md`
- `.ai/core/task-completion-report.md`
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
