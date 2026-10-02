# Product Delivery Contract

For end-to-end product requests, follow `.ai/workflows/develop-product.md`.
Start or resume the actual CLI product flow and show `delivery view` when the
host can open it. The active coding agent performs each step; the CLI validates
state and evidence. See `.ai/docs/product-flow-guide.md` for contract, command,
review identity and release formats. Explain what, why, actual output path,
next action, review loop and evidence limits at each handoff. Do not make a
novice operate internal controls or write their own technical specifications.

This is the canonical documentation contract for production product work. It applies to requirements, business rules, specifications, system design, implementation, release, and demonstrations. Use the project's existing authoritative documents; do not create a parallel documentation tree. Templates are authoring aids, never evidence of completion.

## One maintained delivery index

At intake, identify the product, users, business outcome, current candidate, accountable decision makers, and canonical documents. Maintain one index linking business rules, specifications, design/ADRs, tasks, acceptance evidence, operations, release, and demo. Every document has an ID, revision, scope, owner or explicitly unassigned owner, status, source references, and last verified candidate. Do not invent names, approvals, dates, results, targets, or production topology.

Document status is `PROPOSED`, `IN_REVIEW`, `APPROVED`, `IMPLEMENTED`, `VERIFIED`, `SUPERSEDED`, or `BLOCKED`. Approval records identify who approved which revision and under what authority. `APPROVED` means a decision was accepted; `IMPLEMENTED` means the behavior exists; `VERIFIED` requires executed acceptance evidence. An unknown owner or unresolved launch-critical decision blocks the relevant transition.

## Outputs and their consumers

| Output | Required content | Consumer and acceptance |
| --- | --- | --- |
| Business rules | Stable BR IDs; source/decision; actor; trigger; preconditions; decision table; permissions; invariants; exceptions; consequences; examples | Product/domain reviewer resolves ambiguity; specifications reference BR IDs |
| Behavioral specification | Stable SPEC/AC IDs; rule references; observable success/failure; interface and data semantics; permission/state matrix; measurable applicable NFRs | Implementer can code without inventing behavior; QA can determine pass/fail without asking the implementer |
| System design | Current versus target; linked specs; boundaries; sequence/data flows; contracts; alternatives; capacity/cost assumptions; failure/recovery; deployment and operations | Architecture/security/operations review determines feasibility and risks; tasks reference selected design decisions |
| Task assignment | Linked spec/AC/design revisions; bounded change; dependencies; one write owner; expected evidence; reviewer; done condition | Executor knows the authorized work; reviewer compares resulting behavior with the same baseline |
| Acceptance record | AC ID; candidate identity; environment; command/procedure; actual versus expected; result; timestamp; evidence location/hash; limitations | QA/reviewer verifies behavior, detects stale evidence, and reopens failures |
| Release record | Immutable artifact identity; accepted requirements; review; target environment; rollout; migration; rollback; owners; stop conditions | Authorized release operator can execute and recover; no release approval from document completeness alone |
| Demo record | Audience/outcome; verified user journey; exact candidate; setup/reset; script; real captures; evidence-backed claims; data disclosure; rehearsal result | Another presenter can reproduce the demonstration and explain its limits |

## Traceability and change control

Maintain `BR → SPEC → AC → design decision → task → code/PR → executed evidence → release → demo claim` for each delivered requirement. A design decision may be a link to an existing pattern with a concrete no-change rationale; do not force an RFC for a trivial fix. A rule with no business-rule impact must have a reviewed rationale instead of a made-up rule. Code and test links alone are not executed evidence.

Record discussions as concise decisions: issue, options, rationale, decision maker, date, affected IDs, approved revision, and consequences. Preserve rejected options only when they explain a trade-off. Do not store raw conversations. Unresolved material disagreement blocks the dependent work.

When a rule/spec/design changes, enumerate affected tasks, code, tests, runbooks, release checks, and demo claims. Mark affected approvals and verification `STALE`; revise the baseline, obtain required approval, and rerun affected checks. An unchanged candidate hash does not preserve acceptance when the acceptance contract changed. Reconcile documentation with actual behavior in the same change set. Archive superseded documents with replacement links; do not leave two active authorities.

## Acceptance stages

| Stage | Exit condition | Must block on |
| --- | --- | --- |
| Ready to implement | Business decisions and observable acceptance agreed; applicable design reviewed; dependencies and scope explicit | Ambiguous behavior, unowned critical decision, unapproved material design/scope |
| Ready to review | Behavior and docs synchronized; AC mapping complete; relevant positive, negative, permission, retry/data-integrity checks executed | Missing coverage, unexplained deviations, fabricated or stale evidence |
| Ready to demo | Named journey rehearsed on exact candidate/environment; data labeled; captures and claims match executed behavior; reset/fallback tested | Unrehearsed journey, unavailable dependency, claim exceeding evidence |
| Ready to release | Required acceptance and independent review pass; artifact frozen; environment and operator verified; applicable rollout/rollback/migration/recovery checks pass | Launch-critical open findings, missing live evidence, unresolved operational owner, stale candidate or baseline |
| Live verified | Released artifact read back; sanity checks pass in target environment; required telemetry observed for the agreed window | Version mismatch, critical journey failure, privacy/security failure, unhealthy operational signals |

Demo readiness and release readiness are independent. A labeled synthetic demonstration can pass its rehearsal while production remains blocked. A successful publish/deploy is not `Live verified`. Runtime `READY` is one input to release review, not a substitute for this contract's target-environment acceptance.

## Production checks must be specific

Define applicable SLOs and launch load from approved needs, with measurement method and recovery objective. Cover authentication/authorization, identity/account lifecycle, data correctness, privacy/retention/deletion, dependency failures, retries/idempotency, backups/restore, migration compatibility, cost boundaries, alerts, support, rollback, and abuse/security controls where relevant. Use `NOT_APPLICABLE` only with a reviewed product-specific rationale. Do not invent a universal latency, availability, RTO, RPO, or cost target.

Every operational procedure records prerequisites, environment/account, required authority, exact command or action, expected observable result, stop condition, recovery action, and executed evidence. Go-live checks identify candidate digest, spec revision, environment, result, time, executor, and evidence. A successful local/fixture test cannot pass a live provider/account or production check.

## Keep documentation useful

Use the smallest complete set. Combine short business rules and specifications in one canonical document when useful. Create a document only when it has a named consumer and a decision, implementation, test, operation, or presentation use. Prefer diagrams of actual boundaries and failure flows to decorative diagrams. Remove empty optional sections; preserve unresolved required content as explicit blockers with the decision/evidence needed to close them. Never fill placeholders to make a package look complete.

Use `.ai/templates/business-rules.md`, `behavioral-specification.md`, `system-design-report.md`, `production-release.md`, and `product-demo.md` only for missing content. Do not instantiate all templates automatically. The delivery index points to existing project documents and records acceptance stage, blockers, and exact next owner action.

## Production harness

Production product work uses contract v2 and AAK-PRODUCTION-1. Follow `.ai/docs/production-harness.md`: bind all document, budget, timeline, story/task and engineering controls; declare the real stack and measurable performance/memory budgets. Show missing rules, actual source paths, current checks and evidence limits. V1 is legacy/local only; it cannot authorize production release. Select stack-specific quality profiles, run applicable checks, assess their adequacy independently and reopen stale evidence.
