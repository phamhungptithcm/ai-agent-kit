# AI Agent Team Guide

This repository uses a shared AI agent operating model for Claude Code and OpenAI Codex. The durable policy lives in `.ai/`; platform-specific files are thin adapters.

## What Is Shared

- `.ai/core/` defines mission, precedence, risk, workflow, code quality intelligence, quality gates, memory policy, definition of done, and output contract.
- `.ai/context/` records repository facts, build/test commands, ownership, architecture notes, and glossary.
- `.ai/rules/` defines engineering, security, testing, API, database, observability, dependency, git/PR, and documentation rules.
- `.ai/workflows/` defines reusable task flows.
- `.ai/skills-src/` is the canonical source for reusable skills.
- `.ai/guards/` and `.ai/evals/` define policy checks and consistency measurement.
- `.ai/templates/memory-entry.yaml` defines the canonical schema for durable repository memory candidates.
- `.ai/PROMPTS.md` gives copy-ready prompts for daily team workflows.
- `.ai/docs/agent-adapter-strategy.md` explains how this repository can route the same policy to future AI-agent adapters.
- `.ai/quality-profiles/` defines language-aware, platform/domain-aware, and cross-cutting quality profiles for code review, implementation, and handoff.

## Platform-Specific Files

- `AGENTS.md` routes Codex to shared policy.
- `CLAUDE.md` routes Claude Code to shared policy.
- `.agents/skills/` contains generated Codex skill copies.
- `.claude/skills/` contains generated Claude skill copies.
- `.codex/` contains Codex project config, custom agents, command rules, and hooks.
- `.claude/` contains Claude commands, rules, agents, settings, and generated skills.

Generated skill copies must not be edited directly. Update `.ai/skills-src/<skill>/SKILL.md`, then run:

```bash
python .ai/scripts/sync_agent_assets.py
python .ai/scripts/validate_agent_config.py
```

## First 10 Minutes

1. Run `npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --yes` inside the target repository for fast policy setup.
2. Open `.ai/PROMPTS.md` or run `npx --yes @hunpeolabs/ai-agent-kit@latest prompts`.
3. Pick one prompt by work type: `start-task`, `plan-change`, `implement-approved`, `fix-bug`, `code-quality-review`, `review-pr`, `investigate-incident`, or `prepare-handoff`.
4. Paste the ticket, PR, bug, or incident context into the selected prompt.
5. For existing-system changes, approve the generated change-impact plan before implementation starts.
6. Before handoff, require quality gates and memory candidates or `None`.

For full repository intelligence, first run `npx --yes @hunpeolabs/ai-agent-kit@latest tools plan`. After reviewing the pinned commands, run `tools install --apply`, then `bootstrap --refresh-indexes`. The bootstrap command and `--deep` never install global tools. Large repositories should use fast bootstrap first, then index before risky implementation, impact analysis, or PR/MR review.

## Starting Work

Every repository task starts with the Repository Intelligence Gate. Run `.ai/scripts/check-repository-intelligence.py`; CodeGraph and CocoIndex must both be installed, configured, indexed for the current checkout, and health-checked before brainstorming, planning, review, QA analysis, documentation analysis, or implementation. Use `.ai/scripts/refresh-repository-index.py` explicitly when the gate reports stale indexes.

Use CodeGraph first for structural evidence and impact. Use CocoIndex second for semantic retrieval across code, specs, docs, runbooks, tests, ADRs, and similar implementations. For multi-agent work, the Team Lead Orchestrator creates a shared `.ai/templates/repository-intelligence-brief.md` brief before assigning specialists.

Use the prompt catalog in `.ai/PROMPTS.md` or the universal task contract in `.ai/prompts/task-contract.md`. At minimum, provide the task, business outcome, scope, constraints, acceptance criteria, and evidence.

Common examples:

- Analyze a new ticket: ask the agent to use the `start-task` skill and return understanding, current flow, impacted components, facts vs assumptions, risk, smallest safe change, test strategy, and execution plan.
- Implement a feature: use `implement-feature` after the plan and acceptance criteria are clear. For existing-system changes, first use `change-impact-plan` and approve the plan explicitly.
- Fix a bug: use `fix-bug`; require first incorrect state, root cause, and a regression test when feasible. Existing-system fixes must stop after the impact plan until approval evidence exists.
- Review a pull request: use `code-review`; require severity, location, production impact, evidence, and correction.
- Investigate a production incident: use `production-incident`; require timeline, observed impact, evidence, mitigation, permanent correction, and prevention.

## Persona Composition Matrix

Use these persona bundles when the team wants a familiar role rather than a single skill:

| Persona | Composed skills |
| --- | --- |
| Solution Architect | `start-task` + `repository-intelligence` + `design-document` + `architecture-review` |
| Senior Backend Engineer | `implement-feature` + `database-change` + `code-review` + `code-quality-review` |
| Production SRE | `production-incident` + `performance-investigation` + `observability-review` |
| Security Engineer | `security-review` + `threat-model` + `code-review` |
| QA Lead | `test-strategy` + `code-quality-review` + `delivery-documentation` |
| Release Manager | `release-readiness` + `delivery-documentation` + `jira-completion-package` |
| Tech Lead | `change-impact-plan` + `architecture-review` + `repository-health` |
| Web Growth Engineer | `start-task` + `design-taste-website` + `animation-design-engineering` + `seo-geo-website` + `implement-feature` + `code-quality-review` + `test-strategy` |

## Risk Gates

Low-risk documentation, tests, and internal tooling changes can be implemented and prepared for review.

Medium-risk business logic, SQL, dependencies, background jobs, or cache behavior require tests, operational analysis, and human review.

High-risk authentication, authorization, payment, PII, public API, schema migration, infrastructure, IAM, encryption, or key-handling work requires explicit human review before merge.

Critical-risk production datafixes, secret access, destructive production operations, financial adjustments, regulated-data deletion, or disabling security controls must not be executed autonomously. Agents may analyze and prepare a reviewed procedure only.

## Never Autonomous

Agents must not access production systems, run datafixes, rotate credentials, disable audit/security controls, alter release infrastructure, make destructive changes, or commit secrets without explicit authorization and a reviewed human procedure.

## Approval Gate

Existing-system changes require the Repository Intelligence Gate, indexed analysis, multi-agent brainstorming, a concrete impact/implementation plan, and explicit human approval before protected files are edited. Use `.ai/templates/repository-intelligence-brief.md`, `.ai/templates/change-impact-plan.md`, and `.ai/templates/implementation-approval-record.md`. A vague assignment, branch creation, or request like "start working" is not approval.

## Documentation And Traceability

Every implementation should update affected docs, specs, diagrams, runbooks, API contracts, or ADRs in the same change set, or include a specific no-change rationale. Diagrams should be text-based source such as Mermaid when practical.

For review handoff, use `.ai/workflows/prepare-pr-or-mr.md`. For Jira handoff, use `.ai/workflows/prepare-jira-completion-package.md`. Jira must not be updated unless an approved authenticated connector, verified issue key, permission, and successful response exist; otherwise prepare copy-ready text only.

Demo-required changes should use `.ai/scripts/generate_delivery_artifacts.py` to create a Jira completion summary, PPTX deck, XLSX evidence workbook, and manual screenshot placeholders.

## Quality Gates

Every completion must report `.ai/core/quality-gates.md` with `PASSED`, `FAILED`, `NOT_APPLICABLE`, or `NOT_RUN`, plus evidence command/result or rationale. The required gates are compilation, unit tests, integration tests where applicable, static analysis, architecture checks, security checks, database migration validation, API compatibility review, observability impact review, and diff self-review.

## Code Quality Intelligence

Agents must detect the project language, version, framework, build tool, test tool, runtime, and application/platform/domain before implementation, bug fix, review, or handoff. They must apply `.ai/quality-profiles/universal.yaml` plus matching language profiles such as Go, Java, Python, TypeScript/JavaScript, frontend HTML/CSS, platform/domain profiles such as web app, mobile app, desktop app, infrastructure, and DevOps, plus cross-cutting profiles for API, database, concurrency, and memory risk.

The goal is language and platform-aware review discipline: clean code, best practices for the detected version and delivery surface, API compatibility, performance, app lifecycle, release safety, connection/session lifecycle, transaction safety, thread/goroutine/task leaks, deadlock risk, and heap/resource memory leaks.

## Memory Governance

Durable repository memory follows `.ai/core/memory-policy.md` and `.ai/guards/memory-governance.yaml`. Agents may propose memory candidates in the output contract, but default retrieval is approved-only. Memory must not contain secrets, credentials, PII, PHI, PCI, production customer data, or unapproved sensitive logs.

Governance roles:

- Module Context Owner verifies module-scoped memory and context against current source and ownership.
- Memory Approver approves, rejects, supersedes, or marks memory stale.
- Skill Maintainer keeps skills, prompts, adapters, and validators aligned with approved policy.
- Quarterly Review performs stale-memory and policy drift review.

## Reporting Problems

If an agent result conflicts with policy, lacks evidence, broadens scope, or makes unsafe assumptions, record the prompt, files touched, commands run, and observed issue in the PR or ticket. Maintainers should update `.ai/evals/golden-cases.yaml` when a bad result reveals a reusable failure pattern.

## Maintaining Policy

Policy, skills, guards, and adapters are reviewed like source code. Prefer small changes with rationale, owner, validation output, and rollback notes. Version meaningful policy changes in PR descriptions and update `.ai/references.md` when external reference behavior changes.
