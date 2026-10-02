# Behavioral Specification

Authoring aid: reuse the product's canonical specs; do not deliver empty sections as a completed specification.

## Baseline and outcome

Record SPEC ID/revision/status, owner, approval reference, business outcome, actors, linked BR IDs, scope, preserved behavior, exclusions, dependent systems and selected design/ADR revisions.

## Observable behavior

For each journey describe entry/preconditions, inputs, permission decisions, state transitions, externally observable outputs, persisted changes and downstream events. Include failure, timeout, retry, duplicate/concurrent request, partial success and recovery behavior where applicable.

For UI work cover loading, empty, error, success, permission, stale/partial, accessibility and localization states. For API/CLI work specify schema/flags, defaults, validation, compatibility, status/exit codes and stable error meaning. For data specify identity, units, time semantics, ownership, invariants, retention and deletion. Link machine-readable API/schema contracts instead of duplicating them.

## Acceptance criteria

| AC ID | BR/SPEC ID | Given/precondition | When/input | Then/observable result | Failure/boundary case | Verification procedure | Required environment |
| --- | --- | --- | --- | --- | --- | --- | --- |

Criteria must allow a reviewer to independently decide pass/fail. Include exact expected state or threshold and how it is measured. “Tests pass”, “secure”, “fast”, and “production ready” alone are not acceptance criteria.

## Non-functional acceptance

| NFR ID | Approved requirement/source | Target and units | Workload/window | Measurement | Environment | Failure/stop condition |
| --- | --- | --- | --- | --- | --- | --- |

Choose applicable availability, latency, capacity, recovery, privacy, security, compatibility and cost requirements from real constraints. Record missing launch-critical targets as blockers.

## Implementation and verification mapping

| AC/NFR ID | Design/ADR revision | Task/owner/dependencies | Code/PR | Executed evidence/result | Candidate/environment | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |

Record intended deviations explicitly and obtain required approval. Reopen affected criteria after baseline changes; test source or a screenshot is insufficient when behavior requires execution.
