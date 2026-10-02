# Fix Bug Workflow

Use this workflow for defects, regressions, failed tests, incidents with known code symptoms, or unexpected runtime behavior.

Apply `.ai/core/product-delivery.md`. Link the defect to the violated BR/SPEC/AC and affected release/candidate; reopen acceptance and demo claims whose evidence no longer supports the intended behavior.

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
14. Run `final-implementation-review`; resolve approved in-scope findings, rerun affected checks, and repeat fresh review until it passes. Preserve reproduction, root cause, fix and executed regression evidence in the canonical delivery index.
15. Update rules/specs/design/runbooks when the fix changes their meaning. For released defects, rerun target-environment sanity after the authorized replacement release; local regression success alone does not close a production incident.

Do not hide symptoms with generic retries, unexplained null checks, broad catches, or unrelated refactoring.
