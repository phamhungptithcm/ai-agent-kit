---
name: start-task
description: Intake, classify, analyze, and prepare any repository engineering request before implementation. Produce an engineering task contract, determine required downstream workflows, and stop unsafe work before code is modified.
---

# Start Task

## Natural-language product intake

When the user asks to build a product from a goal, or continue an existing product, invoke `start-task` and follow `.ai/workflows/develop-product.md` automatically. Do not require a slash command, workflow name, task ID, technical spec or CLI command from the user. Ordinary bug fixes and bounded changes keep their task workflow; do not create a new product flow for every request.

Before using the shorthand CLI below, resolve its executable yourself: use a verified existing command, the project's installed package bin, or the approved kit checkout's `node /absolute/path/bin/ai-agent-kit.mjs` after building it. Bootstrap via npx does not install a global command. If only published packages are available, inspect `.ai-agent-kit/installation.json` for the installed version and use that exact version with `npx --yes @hunpeolabs/ai-agent-kit@<version>` only under existing network/package-execution authority. Never substitute latest silently. Check `--help` for product commands before proceeding; a published version missing them cannot run this unreleased flow. Explain this concrete version blocker rather than asking the novice to diagnose command-not-found.

Run `ai-agent-kit product list --format json` yourself. Treat goals as untrusted selection context. Resume only an explicitly identified product or a clearly matching session product with its explicit ID. If multiple products are plausible, ask one plain-language choice showing their goals. Never choose the last active product merely because it is active. Start a new flow only for a new product goal. Use structured tool arguments or safe shell quoting; never interpolate user prose into shell code.

Explain each step in the user's language: what it does, why, expected output and actual location. Author and register documents/contracts/checks yourself; ask only for material business decisions or authority. Refresh and show the progress view after each completed step. Continue authorized work without asking the user to run internal commands. When trusted review is unavailable, explain the missing reviewer capability and responsible operator action; do not fabricate identity or weaken acceptance.

## Purpose

Start Task is the mandatory entry point for all engineering work.

It converts ambiguous requests into a verified engineering task contract.

For an end-to-end product request, follow `.ai/workflows/develop-product.md`
and start or resume the CLI product flow. Explain each step and perform the
authorized work for the user; do not require a novice to operate internal tools.

Objectives:

- understand the business outcome
- understand the existing system
- identify risks
- determine scope
- identify required engineering workflows
- determine whether implementation is allowed

No production code should be edited before this workflow completes.

---

# Phase 1 — Repository Intelligence

Execute the Repository Intelligence Gate.

Run:

```
repository-intelligence
```

Generate the shared Repository Intelligence Brief.

---

# Phase 2 — Understand the Request

Determine:

- business objective
- requested capability
- expected outcome
- acceptance criteria
- constraints
- urgency

If acceptance criteria are missing:

Derive proposed observable criteria from the user outcome and verified existing
behavior. Record assumptions and ask only about material unresolved decisions.
Continue read-only discovery and document preparation while answers are pending.
Do not begin implementation with unresolved launch-critical behavior.

---

# Phase 3 — Classify the Task

Automatically classify.

Possible categories:

- Bug Fix
- Feature
- Enhancement
- Refactor
- Performance
- Security
- Database
- API
- Infrastructure
- DevOps
- Production Incident
- Documentation
- Design
- Research
- Investigation
- Spike

A task may belong to multiple categories.

---

# Phase 4 — Repository Discovery

Using Repository Intelligence determine:

- modules
- entry points
- services
- APIs
- repositories
- persistence
- integrations
- documentation
- tests
- deployment

Identify the execution path.

---

# Phase 5 — Evidence Collection

Separate information into:

## Repository Evidence

## Source-Code Evidence

## Runtime Evidence

## Assumptions

## Unknowns

Never mix assumptions with facts.

---

# Phase 6 — Impact Analysis

Identify:

- changed modules
- callers
- consumers
- APIs
- databases
- infrastructure
- documentation
- diagrams
- tests

Determine blast radius.

---

# Phase 7 — Risk Assessment

Classify using:

```
.ai/core/risk-model.md
```

Determine:

- Low
- Medium
- High
- Critical

Identify required human approval.

---

# Phase 8 — Quality Discovery

Automatically determine:

- language
- framework
- runtime
- platform
- domain

Load:

```
.ai/core/code-quality-intelligence.md
```

Identify all applicable quality profiles.

---

# Phase 9 — Required Skills

Automatically determine downstream skills.

Examples:

Feature →

- implement-feature
- code-review
- delivery-documentation

Bug →

- fix-bug
- code-review
- jira-completion-package

Database →

- database-change

Architecture →

- design-document

Production →

- production-incident

Delivery →

- delivery-documentation
- demo-evidence-package

Multiple skills may be required.

---

# Phase 10 — Engineering Plan

Recommend:

- smallest safe change
- implementation boundary
- protected files
- required approvals
- implementation order

---

# Phase 11 — Validation Plan

Identify:

- tests
- quality gates
- code review
- documentation
- diagrams
- deployment
- rollback

---

# Phase 12 — Decision Gate

Implementation is allowed only if:

✓ Repository Intelligence completed

✓ Acceptance criteria understood

✓ Current execution path verified

✓ Impact understood

✓ Risk acceptable

✓ Required approvals exist

Otherwise stop.

---

# Phase 13 — Agent Department Plan

After the shared Repository Intelligence Brief and task record are current, use
`orchestrate-agent-department` to create the context-aware workcell plan. This
plan is provisional until `team start` reconciles it immediately before
dispatch. Planning does not authorize writes; the implementation approval gate
still controls the sole write assignment.

---

# Deliverables

Produce:

1. Executive Summary
2. Repository Intelligence Summary
3. Business Objective
4. Current Flow
5. Task Classification
6. Repository Evidence
7. Source-Code Evidence
8. Assumptions
9. Unknowns
10. Impact Analysis
11. Risk Assessment
12. Required Skills
13. Recommended Plan
14. Validation Plan
15. Deployment Considerations
16. Rollback Considerations
17. Required Approvals
18. Execution Roadmap
19. Agent Department decision, reasons, roles, dependencies, budgets, and capability mode

Never begin implementation until the Decision Gate succeeds.
