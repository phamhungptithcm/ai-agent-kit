# Implement Feature Workflow

Use this workflow after the business outcome, acceptance criteria, and scope are clear.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Load applicable rules, context, approved plan, and repository intelligence brief.
3. Query CodeGraph for changed-symbol impact and exact files/functions expected to change.
4. Query CocoIndex for similar existing implementations, specs, tests, docs, and reusable patterns.
5. Confirm contracts, data ownership, authorization, compatibility, and operational impact.
6. Verify explicit approval evidence for existing-system changes before editing protected files.
7. Detect language/version/framework/tooling and application/platform/domain, then apply `.ai/core/code-quality-intelligence.md` plus selected `.ai/quality-profiles/`.
8. Implement the smallest safe change inside the approved scope.
9. Add or update tests for expected behavior and important failure paths.
10. Update documentation or operational notes when needed.
11. Run focused validation and complete `.ai/core/quality-gates.md` plus `.ai/templates/code-quality-review.md` with status and evidence.
12. Compare actual diff to approved scope, refresh CodeGraph/CocoIndex indexes, and re-run the gate.
13. Review security, data, performance, concurrency, memory/resource lifecycle, deployment, and rollback.
14. Report memory candidates under `.ai/core/memory-policy.md`, or state `None`.

Do not add dependencies, broaden scope, or change public contracts without explicit rationale and review.
