# System Design

Status: `READY_FOR_REVIEW | NEEDS_DECISION | INSUFFICIENT_EVIDENCE | CONSTRAINTS_CONFLICT`

This is an authoring aid, not production acceptance. Record design ID/revision, owner, source candidate, BR/SPEC/AC references, current versus proposed behavior, reviewer/approval reference and superseded design. Apply `.ai/core/product-delivery.md` and reuse the project's existing canonical architecture document.

## Recommendation

State the selected option and why it best fits the current stage, target constraints, cost boundary, and team.

## Targets and evidence

| Constraint | Value | Scope/horizon | Source | Confidence |
| --- | --- | --- | --- | --- |

## Assumptions, conflicts, and unknowns

Keep only architecture-changing items.

## Architecture

Include one readable Mermaid diagram and one end-to-end request/data flow.

Show actual service/module ownership, trust boundaries, identity, persistence and external dependencies. Describe critical sequences including permission denial, timeout, partial failure, retries/idempotency and recovery. Link API/event schemas and state/data invariants. Identify selected alternatives and why rejected options do not fit the approved requirements.

## Capacity and cost

Show launch, target, and extreme scenarios; formulas, dominant drivers, evidence gaps, pricing status, and sensitivity.

## Failure and security boundaries

Describe overload, dependencies, data integrity, recovery, trust boundaries, threats, controls, and verification.

## Evolution triggers

| Trigger | Evidence | Next change | Migration/rollback |
| --- | --- | --- | --- |

## Validation plan

List benchmark, load, resilience, recovery, security, cost, and observability evidence required before implementation or production claims.

Map each applicable AC/NFR to implementation tasks, measurement procedure, required environment and executed evidence. Specify rollout/migration order, backward compatibility, known-good rollback target, irreversible effects, operational owner, telemetry/alerts and post-release sanity. Missing critical decisions or live evidence block the corresponding acceptance stage; design approval does not prove production readiness.

## Open decisions

List owner, deadline, options, and consequence of delay.
