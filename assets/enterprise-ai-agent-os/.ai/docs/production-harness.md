# Production document and engineering harness

Policy: **AAK-PRODUCTION-1**, revision 1. This is the kit's acceptance policy,
not an external certification. The runtime rule catalog is
`src/production-harness.mjs`; `product status --format json` and `product view`
show each rule, bound document, source evidence, missing checks and limitations.
The coding agent authors and maintains the contract; novices state outcomes and
approve material decisions rather than filling engineering forms.

## Meaning of results

- MISSING: no valid v2 control is bound. Legacy v1 cannot authorize a PRODUCTION release.
- DOCUMENT_BOUND: required declarations and actual source hashes resolved. The prose still needs domain/architecture review.
- NOT_TESTED: declared executable control has no current passing receipt.
- LOCAL_EXECUTED: current passing receipts resolve the control's checks. Review must assess whether checks actually cover the assertion and numerical budget.
- EXCLUDED_WITH_RATIONALE: only API or persistence controls may be excluded, with a concrete reason. The independent review must verify exclusion against the actual surface.

No percentage of correctness is invented. A self-authored design used as its
own source is declared evidence, not independent corroboration. Sources must
identify authority, revision, observation date, assumptions and review due date
in maintained documents. File hashes establish freshness, not truth. Contradictory
or unowned launch-critical facts belong in blocking open_decisions. Neither
field presence nor passing an unrelated command proves a document correct.

## Required rules and consumers

| Area | Required rules and contents | Actual consumer/check |
| --- | --- | --- |
| Documents | DOC-PROVENANCE: source authority, assumptions, owner, revision, review due | Domain reviewer verifies facts and resolves conflicts; changed evidence invalidates input |
| Business rules | BR-INVARIANTS: actors, permissions, decision tables, invariants, exceptions, negative cases | Specs and QA derive observable allowed/denied behavior |
| Budget | BUDGET-CONTROL: currency, ceiling, forecast, unit cost, approval and stop condition | Runtime rejects forecast above ceiling; operator tracks real spend separately and stops before unapproved cost |
| System design | DESIGN-STACK and DESIGN-BOUNDARIES: language/runtime/framework versions, source evidence, choice/support policy, dependency direction, ownership, alternatives/recovery | Coding tasks consume chosen stack and boundaries; checks detect violations |
| Specs | SPEC-CONTRACT: validated inputs/outputs, errors, compatibility, positive/negative acceptance | AC-linked executed contract tests |
| Plan | PLAN-DEPENDENCIES: owners, scope, dependencies, risk, rollback, done conditions | Approved coding scope; changes reopen affected tasks |
| Timeline | TIMELINE-CAPACITY: estimates, capacity, critical path, buffers, replan triggers | Every task scheduled once; dependencies finish before successors; sum estimates fits declared capacity |
| Stories/tasks | STORY-VALUE and TASK-READY: actor/outcome/priority, linked ACs, one owner, paths, dependencies, estimate/checks/handoff | Every AC maps to a story; every task serves its story's AC and milestone |
| Implementation | CODE-CONVENTIONS and CODE-MAINTAINABILITY | Stack-specific formatter/lint/type tests; responsibility/complexity/dependency checks and independent review |
| API | API-DESIGN | Interface schema/compatibility, authz negatives, pagination, idempotency, timeout/error/version tests; CLI/IPC contracts also count as API |
| Performance | PERF-BUDGET | Numeric metric/unit/limit/comparison, workload/environment and AC-linked check; latency percentile, throughput, resource and regression limits justified by expected load |
| Memory | MEMORY-LIFECYCLE | Numeric growth/resource budget with check; ownership/cleanup, bounded caches/queues, cancellation and soak window |
| Security | SEC-THREAT, SEC-ACCESS, SEC-DATA | Threat/abuse cases, trust boundaries, least privilege/object authz, secrets/redaction/retention, injection/SSRF and dependency checks |
| Persistence | DATA-INTEGRITY | Atomicity, retry/idempotency, races, migrations and backup/restore acceptance |
| Review/operations | REVIEW-LOOP and OPS-RELEASE | Independent signed review, zero open findings, fixes/rechecks, immutable artifact, alert/rollback/sanity/observation evidence |

Contract v2 extends the existing delivery contract with budget, timeline,
stories and tasks documents and `quality`: policy, controls, stack, budget,
measurements, stories and milestones. Each control references its canonical
kind, concrete named fields, current path/SHA-256 sources, applicability and
AC-linked check IDs where executable. Read `product-contract.schema.json` and
runtime validation together. Bind rejects incomplete controls, placeholders,
stale sources, over-budget forecasts and invalid dependency/capacity schedules.
The schema checks shape; runtime checks cross-references and actual files.

Each stack entry has name, version, rationale and path/hash evidence. Use actual
manifest/lockfile/toolchain/configuration plus source. An absent framework is
recorded as the concrete runtime standard library, not an invented dependency.
Select language/platform profiles from `.ai/core/code-quality-intelligence.md`
and `.ai/quality-profiles/`; do not impose one universal framework or layered
architecture. For JavaScript validate async cleanup/listeners/timers/cache
bounds; for JVM validate pool/transaction/heap lifecycle; for native code use
ownership/lifetime and sanitizer evidence; use actual platform tools and pinned
versions. Unsupported or unavailable checks stay NOT_TESTED.

Measurements record id, PERF-BUDGET or MEMORY-LIFECYCLE control_id, metric,
unit, numeric limit, LTE/GTE comparison, workload, environment and linked
check_id. Both areas need measurements; do not claim receipt validity proves
metric validity. Benchmark tests must read real observations, assert declared
limits, retain redacted observations and repeat under the named workload. Memory
checks include repeated create/use/dispose, timeout/cancel paths, resource counts
and a sufficiently justified steady-state soak. Never treat one RSS sample or
microbenchmark as evidence of absence of all leaks or production capacity.

## Standard references and scope

- [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final): secure development process reference. Record selected practice IDs and actual evidence; this policy does not certify every SSDF practice.
- [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0): application security requirements reference. Pin versioned requirement IDs and applicability/level for the actual application; CLI-only products need their own threat model, not fabricated web controls.
- [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html): selected HTTP contract format when applicable, not a universal or latest-version claim. Validate semantics, authorization and compatibility in addition to schema syntax.
- Clean code, clean architecture and stack conventions are **project policies**, not formal certificates. Pin the selected conventions, dependency rules, tooling and explicit exceptions in design. Prefer justified boundaries over mandatory layers.

## Review and change loop

Before coding, review source-backed business rules/spec/design, estimates,
forecast and scope. After implementation, run each applicable check on the
candidate, retain observed outputs, review their adequacy independently, fix all
findings and rerun affected checks. Changed rules, source files, stack versions,
budgets or schedules require a newer bound revision and affected reapproval;
prior check receipts/review signatures become stale. A production release record
is rejected without v2 and all applicable local evidence, even if legacy review
passed. Actual production authority/readback/observation remain separate gates.

Metric-producing checks write one JSON object to stdout, with measurements entries
containing id, numeric nonnegative value, unit, workload and environment matching
the contract. Put diagnostics on stderr. The bounded runner records these actual
stdout observations in its hashed receipt. Missing/duplicate observations,
context/unit mismatch or exceeded bounds prevent harness acceptance even when
the process exits zero. This validates observed bounds, not the honesty or
adequacy of a measuring program; independent review still inspects it. Task
reports and direct runtime RELEASED transitions enforce the same harness,
preventing an alternate production-readiness route around product release.
Timeline dates are UTC ISO timestamps and invalid calendar dates are rejected.
