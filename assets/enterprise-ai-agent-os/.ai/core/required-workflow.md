# Required Workflow

## Phase 1 - Analyze The Existing System; Do Not Edit Code

0. Run the Repository Intelligence Gate and stop all application work if CodeGraph or CocoIndex is missing, stale, unconfigured, or failing health checks.
1. Restate the business outcome and exact problem to solve.
2. Query CodeGraph for structural location and impact, then query CocoIndex for related code, requirements, specifications, tests, and documentation.
3. Inspect only the most relevant code, functions, tests, configuration, documentation, specifications, diagrams, recent related changes, and linked work item sections returned by indexed evidence.
4. Trace the real current execution path end to end, including callers, downstream consumers, persistence, integrations, error paths, retries, and operational behavior.
5. Separate indexed facts, source-code verified facts, assumptions, unknowns, and hypotheses.
6. Identify the first incorrect state or precise capability gap.
7. Identify impacted modules, classes, functions, APIs, events, schemas, configuration, data, dependencies, jobs, users, operators, and environments.
8. Determine what existing behavior must remain unchanged.
9. Classify risk and identify regression-sensitive areas.
10. Detect language/version/framework/tooling and select matching `.ai/quality-profiles/` under `.ai/core/code-quality-intelligence.md`.
11. Propose the smallest safe change that addresses only the issue or approved requirement.
12. Identify tests, validation evidence, documentation, specification, diagram, runbook, ADR, API-contract, Jira, deployment, and rollback impacts.

## Phase 2 - Produce A Reviewable Change-Impact And Implementation Plan

Before editing protected existing-system files, produce a plan containing:

```text
Problem statement and business outcome
Current behavior and verified execution flow
Root cause or capability gap
In-scope behavior
Explicit out-of-scope behavior
Proposed solution
Alternative options considered and trade-offs
Exact files/modules/classes/functions expected to change
Change area boundary
Impact boundary
Files explicitly approved for change
Areas requiring developer review before touching
Reason no other area is changed
Change details for each file/function
Callers, consumers, contracts, data, and integrations affected
Existing behavior that must be preserved
Security, privacy, transaction, concurrency, and data-integrity impact
Performance and capacity impact
Backward-compatibility impact
Failure, timeout, retry, and rollback behavior
Test and regression strategy
Detected language/version/tooling and selected quality profiles
Documentation/specification/diagram updates
Deployment or migration steps
Known assumptions, unknowns, and risks
Approval decision requested
```

Stop after presenting the plan. Do not implement until explicit approval evidence exists.

## Phase 3 - Implement Within Approved Scope

1. Confirm the Repository Intelligence Gate is still ready before editing protected files.
2. Preserve existing behavior unless explicitly changed.
3. Follow established repository patterns.
4. Avoid unrelated refactoring.
5. Stay within the approved plan and constraints.
6. Stop for a delta-impact plan and renewed approval if material scope or design changes emerge.
7. Use explicit error handling.
8. Protect authentication, authorization, sensitive data, and transaction integrity.
9. Add tests that demonstrate expected behavior when feasible.
10. Add or update operational telemetry where behavior is production-significant.
11. Keep changes reviewable and reversible.

## Phase 4 - Complete With Evidence And Traceability

1. Run relevant build, unit, integration, static-analysis, and formatting checks.
2. Verify acceptance criteria.
3. Complete the quality gates in `.ai/core/quality-gates.md` with status and evidence.
4. Complete `.ai/templates/code-quality-review.md` using matching `.ai/quality-profiles/`.
5. Review security and data implications.
6. Review performance and concurrency implications.
7. Check compatibility and migration requirements.
8. Update authoritative documentation, specifications, and diagrams or provide a specific no-change rationale.
9. Query CodeGraph for changed-symbol impact and refresh CodeGraph/CocoIndex indexes with `.ai/scripts/refresh-repository-index.py`.
10. Re-run the Repository Intelligence Gate and compare actual diff to approved scope.
11. Prepare PR/MR evidence when requested or when a change is ready for review.
12. Prepare a Jira completion package when the task is tied to a work item.
13. Identify any reusable Memory candidates under `.ai/core/memory-policy.md`, or state `None`.
14. Describe deployment sequencing.
15. Describe rollback.
16. Report commands executed and actual results.
17. Clearly identify anything not executed or not verified.
