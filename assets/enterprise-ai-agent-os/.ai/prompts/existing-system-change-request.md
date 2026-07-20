# Existing-System Change Request Prompt

```text
Use the change-impact-plan skill.

This is an existing project and the requested behavior already has callers and dependencies. Do not modify code yet.

First inspect the current implementation and return:
1. Current end-to-end flow.
2. Verified root cause or requirement gap.
3. Exact modules, classes, functions, SQL, contracts, configuration, tests, documents, and diagrams expected to change.
4. Impact on callers, consumers, data, integrations, security, performance, concurrency, compatibility, operations, deployment, and rollback.
5. Existing behavior that must remain unchanged.
6. The smallest safe solution focused only on this issue.
7. Alternatives and trade-offs.
8. Detailed test and regression plan.
9. A file-by-file and function-by-function implementation plan.
10. Assumptions, unknowns, and risks.

Stop after presenting the plan and request developer-team approval. Do not implement until explicit approval is provided. If implementation later requires material scope beyond the approved plan, stop and request approval for a delta-impact plan.
```
