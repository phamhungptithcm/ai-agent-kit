# Output Contract

Completed engineering work should report:

```text
Summary
Context reviewed
Root cause / rationale
Changes made
Files changed
Tests executed
Validation results
Compatibility impact
Security and performance considerations
Assumptions
Remaining risks
Memory candidates
Final task report
```

## Section Requirements

- Summary: state the user-visible result in one or two sentences.
- Context reviewed: list the source files, tests, docs, work items, CodeGraph facts, CocoIndex facts, and approval evidence actually inspected.
- Context reviewed must include detected language/version/framework/tooling, application/platform/domain, and selected `.ai/quality-profiles/` when code is implemented or reviewed.
- Root cause / rationale: explain the first incorrect state, capability gap, or design reason for the change.
- Changes made: describe behavior changes, implementation approach, and intentional non-changes.
- Files changed: list each file touched and why.
- Tests executed: include commands and actual observed results.
- Validation results: include quality gate status, manual checks, generated artifacts, and anything not verified.
- Validation results must include selected code quality profiles and language-aware checks that passed, failed, were not applicable, or were not run.
- Compatibility impact: cover APIs, data shape, migrations, clients, jobs, integrations, and deployment sequencing.
- Security and performance considerations: cover auth, data privacy, sensitive logging, transactions, concurrency, capacity, observability, and rollback.
- Assumptions: record unverified conditions the reviewer should confirm.
- Remaining risks: record residual risk and follow-up owners.
- Memory candidates: propose reusable learnings only; mark each with category, scope, source, confidence, status, and approver need. Use `None` when no durable team memory should be created.
- Final task report: render `.ai/core/task-completion-report.md` from recorded evidence. Include weighted completion, completed and remaining criteria, quality gates, Git cleanliness, scoped known-issue language, production readiness and blockers, token usage, and cost status.

The agent must not claim a test, MR/PR, Jira update, document, diagram, screenshot, PPTX, or XLSX artifact exists unless it actually verified that evidence.
The agent must not claim zero usage, zero cost, clean code, no issues, or production readiness when the required evidence is unavailable, stale, failed, or was not run.
