---
name: release-readiness
description: Assess whether a change or release is ready to ship, including validation, compatibility, deployment, rollback, observability, docs, and stakeholder handoff.
---

# Release Readiness

Use this skill before merge, deployment, package publication, or production rollout.

## Required Checks

- Approved scope matches actual diff.
- Acceptance criteria are verified with evidence.
- Quality gates and code-quality review are complete.
- Tests, static analysis, security checks, migration validation, and compatibility review are complete or explicitly not run with risk.
- Deployment sequence, feature flags, config, environment variables, and rollout plan are documented.
- Rollback or compensation plan is realistic and owned.
- Observability, dashboards, alerts, logs, audit events, and runbooks are ready.
- Documentation, specs, diagrams, PR/MR, Jira, and customer/internal communication are updated or have a no-change rationale.

## Output

Return `READY`, `READY_WITH_RISK`, or `NOT_READY`, followed by blockers, evidence, risks, rollout plan, rollback plan, and required owner follow-up.
