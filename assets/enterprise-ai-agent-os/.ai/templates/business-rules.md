# Business Rules

Authoring aid: replace instructions with verified project content; reuse an existing canonical rulebook. This file is not an approved product artifact.

## Baseline

Record product/scope, document ID/revision, status, accountable domain owner, source decisions, approval of this revision, and superseded revision. Identify intended actors, business outcome and vocabulary. Unknown launch-critical decisions are blockers.

## Rule register

For each stable `BR-ID`, state source/authority, actor and permissions, triggering event, preconditions, decision, invariants, consequences/side effects, exceptions and escalation. Record effective version and linked SPEC/AC IDs. State how conflicts between rules are resolved.

| BR ID | Inputs/preconditions | Decision and observable outcome | Invalid/exception outcome | Source/decision | SPEC/AC IDs |
| --- | --- | --- | --- | --- | --- |

Use decision tables for combinations, boundary values and precedence. Specify units, time zone, rounding, allowed transitions, duplicate requests, missing/stale data, and authority where relevant. Include valid, denied and boundary examples with expected outcomes. Do not replace exact rules with “handle properly”.

## Decisions and changes

| Decision ID | Question/options | Chosen rule and rationale | Decision maker/approval reference | Affected IDs/revision | Unresolved consequence |
| --- | --- | --- | --- | --- | --- |

## Domain acceptance

Record executed walkthrough of examples by the domain reviewer, contradictions resolved, remaining blockers, and downstream specs/tasks/evidence invalidated by this revision. Approval of a rule is not proof that code implements it.
