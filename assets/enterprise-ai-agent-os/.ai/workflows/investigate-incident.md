# Investigate Incident Workflow

Use this workflow for production-like incidents, outages, performance degradation, failed deployments, or urgent operational anomalies.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Use CodeGraph to identify services, jobs, callers, dependencies, and blast-radius candidates related to the symptom.
3. Use CocoIndex to find related runbooks, deployment notes, incident notes, specs, tests, and rollback procedures.
4. Establish timeline and observed impact.
5. Gather logs, metrics, traces, releases, config changes, data samples, and operator actions.
6. Identify the first incorrect state.
7. Distinguish root cause from contributing factors.
8. Assess blast radius, customer impact, data impact, and security impact.
9. Propose immediate mitigation.
10. Propose permanent correction.
11. Define validation and prevention.
12. Document rollback, communication, and unresolved evidence gaps.

Do not invent evidence or claim certainty unsupported by logs, metrics, traces, data, or reproducible behavior.
