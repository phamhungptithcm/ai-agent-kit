# Review PR Workflow

Use this workflow for code review, branch diff review, or working-tree review.

Run the Repository Intelligence Gate before reviewing. Use CodeGraph to inspect changed-symbol impact and callers/callees, and use CocoIndex to find related requirements, specs, tests, docs, and similar implementations. Detect language/version/framework/tooling and application/platform/domain, then apply `.ai/core/code-quality-intelligence.md` plus selected `.ai/quality-profiles/`. Verify findings against the diff and source code.

Prioritize findings:

1. Correctness
2. Security
3. Data integrity
4. Concurrency and transaction behavior
5. Backward compatibility
6. Reliability and failure handling
7. Performance
8. Observability
9. Testing
10. Language/version best practices
11. Platform/domain best practices
12. Resource lifecycle, heap retention, and leak risk
13. Maintainability

Each finding must include severity, location, problem, production impact, reproduction or evidence, and recommended correction.

Report selected quality profiles and any missing quality evidence. Do not produce style-only noise unless it hides a real maintainability or correctness issue.
