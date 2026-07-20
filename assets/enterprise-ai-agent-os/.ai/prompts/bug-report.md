# Bug Fix Prompt

```text
Use the fix-bug skill.

Investigate before proposing a fix.

Required process:
1. Separate observed facts from assumptions.
2. Reconstruct the execution flow.
3. Identify the first incorrect state, not only the final error.
4. Determine whether the issue is caused by data, code, configuration, dependency, concurrency, or infrastructure.
5. Identify root cause and contributing factors.
6. Propose the smallest safe fix.
7. Identify regression risks.
8. Add a test that fails before the fix and passes afterward when feasible.
9. For existing-system code changes, produce a change-impact plan and wait for explicit approval before editing protected files.

Do not hide the error, add a generic retry without proving retry safety, add null checks without explaining why the null state exists, or perform unrelated refactoring.

Issue:

Evidence:
```
