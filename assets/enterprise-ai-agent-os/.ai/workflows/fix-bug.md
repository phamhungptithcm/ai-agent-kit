# Fix Bug Workflow

Use this workflow for defects, regressions, failed tests, incidents with known code symptoms, or unexpected runtime behavior.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Use CodeGraph to locate the failing flow, callers, callees, impacted symbols, and regression surface.
3. Use CocoIndex to find related specs, test scenarios, similar failures, docs, and historical notes.
4. Gather evidence and reproduce when feasible.
5. Separate indexed facts, source-code verified facts, and assumptions.
6. Trace the execution path to the first incorrect state, not only the final error.
7. Classify likely cause across data, code, configuration, dependency, concurrency, and infrastructure.
8. Identify root cause and contributing factors.
9. Detect language/version/framework/tooling and application/platform/domain, then select quality profiles for the affected path.
10. Propose the smallest safe fix.
11. Add a regression test when feasible.
12. Refresh CodeGraph/CocoIndex indexes after approved changes.
13. Validate the fix, relevant adjacent behavior, and selected code-quality profile checks.

Do not hide symptoms with generic retries, unexplained null checks, broad catches, or unrelated refactoring.
