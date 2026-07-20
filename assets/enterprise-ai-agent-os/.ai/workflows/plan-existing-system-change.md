# Plan Existing System Change Workflow

Use this workflow before changing an existing application, service, module, function, database flow, runtime configuration, infrastructure component, public contract, or behavior-changing test.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Query CodeGraph for structural location, entry points, callers, callees, dependency paths, data access, contracts, jobs, and impacted symbols.
3. Query CocoIndex for related requirements, specs, ADRs, docs, tests, runbooks, similar flows, terminology, and historical implementation notes.
4. Create or update a repository intelligence brief from `.ai/templates/repository-intelligence-brief.md`.
5. Inspect only the current implementation, tests, configuration, docs, specs, diagrams, recent related changes, and linked work item sections needed to verify indexed evidence.
6. Trace the current end-to-end flow, including callers, consumers, persistence, integrations, failure paths, retries, jobs, and operational behavior.
7. Identify the verified root cause or requirement gap.
8. Detect languages, versions, frameworks, runtimes, package/build tools, application/platform/domain, static-analysis tools, database/API/concurrency/memory-sensitive areas, and selected `.ai/quality-profiles/`.
9. Identify exact modules, classes, functions, SQL, contracts, configuration, tests, documents, and diagrams expected to change.
10. Analyze impact on callers, consumers, data, integrations, security, performance, concurrency, compatibility, operations, deployment, rollback, preserved behavior, and language-specific quality expectations.
11. Propose the smallest safe solution focused only on the issue.
12. Document indexed facts, source-code verified facts, assumptions, unknowns, alternatives, trade-offs, regression risks, smallest safe solution, long-term option, and recommended direction.
13. Define tests, regression strategy, quality profile checks, and code-quality evidence required after implementation.
14. Produce a file-by-file and function-by-function implementation plan.
15. Stop and request developer-team approval.

Do not implement until explicit approval evidence exists. If implementation later requires material scope beyond the approved plan, stop and request approval for a delta-impact plan.
