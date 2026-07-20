# Prepare PR Or MR Workflow

Use this workflow when preparing a pull request, merge request, or review summary.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Inspect the actual diff.
3. Identify linked Jira/work item and approved plan reference when available.
4. Compare approved scope with actual changed files.
5. Query CodeGraph for changed-symbol impact and affected callers/dependencies.
6. Query CocoIndex for docs/specs/tests that need update or no-change rationale.
7. Detect language/version/framework/tooling and application/platform/domain, then complete `.ai/templates/code-quality-review.md` from selected `.ai/quality-profiles/`.
8. Refresh CodeGraph/CocoIndex indexes after approved changes.
9. Identify any plan deviations and re-approval evidence.
10. Verify acceptance criteria evidence.
11. Complete `.ai/core/quality-gates.md` with status and evidence.
12. Verify docs, specs, diagrams, tests, security/privacy, performance/concurrency/memory, deployment, migration, rollback, and risk evidence.
13. Identify memory candidates under `.ai/core/memory-policy.md`, or state `None`.
14. Produce a review-ready description.

Required fields:

```text
Jira issue
Repository intelligence gate status
Approved plan reference and approval evidence
Business outcome
Implementation summary
Acceptance criteria verification
Files and components changed
Approved scope vs actual diff
CodeGraph changed-symbol impact
Related CocoIndex docs/specs/tests
Plan deviations and re-approval evidence
Quality gates
Detected stack/platform/domain and selected quality profiles
Code quality review evidence
API/event/database/configuration impact
Documentation updated
Specifications updated
Diagrams created or updated
Tests and actual results
Security/privacy impact
Performance/concurrency/memory impact
Deployment and migration plan
Rollback plan
Memory candidates
Known risks and follow-up work
```
