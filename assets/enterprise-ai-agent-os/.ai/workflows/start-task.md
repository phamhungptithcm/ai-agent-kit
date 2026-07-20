# Start Task Workflow

Use this workflow when a request is incomplete, broad, ambiguous, high-risk, or requires codebase discovery before edits.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Restate the business outcome.
3. Identify acceptance criteria and scope.
4. Use CodeGraph to identify structural location, likely modules, entry points, callers, callees, and impact.
5. Use CocoIndex to find related terminology, requirements, specs, docs, tests, and similar implementations.
6. Create or update a repository intelligence brief from `.ai/templates/repository-intelligence-brief.md`.
7. Inspect only the files, tests, config, and docs needed to verify indexed evidence.
8. Trace the current execution path.
9. Separate indexed facts, source-code verified facts, and assumptions.
10. Identify impacted modules, contracts, data, dependencies, and operators.
11. Classify risk.
12. Propose the smallest safe change.
13. Identify tests and validation evidence.
14. Stop before editing if the task is high or critical risk and approval is missing.

Output: repository intelligence gate status, indexed facts, source-code verified facts, understanding, current flow, impacted components, assumptions, risk, smallest safe change, test strategy, execution plan.
