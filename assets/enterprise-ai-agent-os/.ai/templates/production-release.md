# Production Release and Operations

Authoring aid: this record authorizes nothing by itself. Populate from the target product's executed checks and authenticated approvals.

## Release identity and decision

Record release ID/version, source commit and worktree/candidate manifest, immutable artifact digest, spec/design revisions, target environment/account, dependency/configuration versions, release operator, operational owner and approval references. Keep secret values out of the record.

Decision: `BLOCKED`, `READY_TO_RELEASE`, `RELEASED_UNVERIFIED`, `LIVE_VERIFIED`, or `ROLLED_BACK`. State blockers and exact owner actions. Preserve release history when a rollback occurs.

## Requirement and assurance acceptance

Link the BR/SPEC/AC mapping, current independent review, defect resolutions and executed test evidence. Separate local, fixture/emulator, staging, live provider/account and production results.

| Check/AC ID | Required scope/environment | Expected observable result | Actual result/status | Candidate/spec revision | Executor/time | Evidence/hash |
| --- | --- | --- | --- | --- | --- | --- |

Cover applicable end-to-end user journeys, permissions, data integrity, dependency failures, migrations, compatibility, load/cost, security/privacy, retention/deletion, recovery, observability and operational handoff. `NOT_TESTED`, `FAILED`, `STALE`, or `BLOCKED` on a required check prevents readiness. `NOT_APPLICABLE` requires a reviewed reason.

## Rollout procedure

| Step | Prerequisites/authority | Exact action/environment | Expected readback | Stop condition | Recovery action | Executed evidence |
| --- | --- | --- | --- | --- | --- | --- |

Include ordering, flags, migration compatibility, backup/restore evidence and canary/ramp criteria where applicable. Establish baseline telemetry before rollout. Record who decides continue/stop.

## Rollback and support

Identify known-good artifact/configuration, exact reversal procedure, irreversible data effects, recovery limits, verified restore/rollback evidence, escalation route and accountable operator. Do not assert rollback is safe from a script's existence alone.

## Post-release sanity and observation

Read back version/digest from the actual registry/store/runtime. Install or access that artifact in a clean target-compatible environment. Run the named critical user journey, permission/failure checks and applicable data/migration checks. Observe specified logs, metrics, alerts, cost and support signals for the approved window. Record expected/actual results, time, environment, artifact identity and evidence.

Move to `LIVE_VERIFIED` only after required sanity and observation checks pass. If they fail, follow stop/rollback criteria and open a defect with reproduction, root cause investigation, affected ACs, fix verification and a new release record. Feed resolved incidents back into specs, rules and regression checks.
