# AI Agent Kit Product Contract

Document ID: AAK-PRODUCT-001. Revision: 3. Scope: the local CLI and bundled engineering policy in this repository. Status: implemented behavior with verification scoped by the [delivery record](PRODUCT_DELIVERY.md); this document is not a release approval. Authority: user-approved closure of the review/evidence/release gaps and a visible product flow usable by novices. Product/release sign-off for a future published candidate remains a separate recorded decision.

## Users and outcome

Developers use the kit to install consistent repository policy and safely update customized installations. Team leads use task/context/assignment records to coordinate bounded work. Reviewers and QA use recorded acceptance and review cycles to assess a candidate. Release operators use package checks and artifact identity to prepare an authorized npm release. Presenters use the synthetic Agent Department timeline to explain local coordination; native AI-host behavior requires separate live evidence.

The supported outcome is a reviewable local engineering workflow with explicit evidence limits. A generated instruction file cannot guarantee host obedience, correct business decisions, or production success. CLI usage is documented in [README](../README.md); system boundaries are in [High-Level Design](HIGH_LEVEL_DESIGN.md).

## Business rules and behavioral acceptance

### BR-01 — Installation preserves application and Git ownership

Trigger: bootstrap in a target repository. The kit may write its managed policy/adapters and installation state. It must preserve existing application source, Git HEAD, branch and staged changes. It must not stage, commit, push, create a PR, publish or deploy. Dry-run previews work without applying it. Conflicting project-owned content must remain reviewable rather than silently overwritten.

SPEC-01 / AC-01: given a fixture containing application files and existing instructions, bootstrap leaves protected content and Git identity unchanged and installs the selected adapter's managed files. Dry-run does not create installation state. Negative coverage includes unsafe paths and conflicting ownership. Implementation: [bootstrap](../src/bootstrap.mjs), [update](../src/update.mjs). Executable acceptance: [bootstrap tests](../test/bootstrap.test.mjs), [packed smoke](../scripts/smoke-packed.mjs).

### BR-02 — Coding authority stays within the approved scope

Trigger: a protected write or command action. The action must match the applicable capability, paths, approval and policy; denied authority must remain denied. Missing repository indexes must be disclosed and replaced with bounded source evidence when sufficient, rather than invented indexed facts. Approval of implementation does not authorize external publication.

SPEC-02 / AC-02: approved in-scope actions may proceed; out-of-scope or disallowed actions produce a denial with an explainable reason. Implementation: [action gateway](../src/action-gateway.mjs), [governed runtime](../src/governed-runtime.mjs), [context compiler](../src/context-compiler.mjs). Acceptance: gateway/context coverage in [bootstrap tests](../test/bootstrap.test.mjs). Limitation: repository policy and host hooks must actually be loaded by the execution host; source presence does not prove enforcement in every host.

### BR-03 — Coordination has one writer and independent review

Trigger: task creation and workcell execution. Select the smallest appropriate workcell. Assign dependency-bounded tasks with structured handoffs, one application write owner and a separate reviewer. A blocking assurance/review finding reopens implementation and downstream verification; it cannot disappear by marking the task done.

SPEC-03 / AC-03: concurrent write ownership is rejected; incomplete dependencies/handoffs block completion; blocking findings force a fix and fresh review. Implementation: [orchestrator](../src/team-orchestrator.mjs), [team review](../src/team-review.mjs). Acceptance: [orchestrator tests](../test/team-orchestrator.test.mjs), [proof-loop tests](../test/team-proof-loop.test.mjs). Schema-v2 final review uses the same repository-trusted identity and independent-review policy; v1 remains legacy declared history.

### BR-04 — A passing review is bound to a candidate

Trigger: final review record and task handoff. Record requirement match, security, code quality, failure paths, error handling, production readiness and trade-offs. Changed code invalidates the prior candidate review; a tampered chain is rejected. Preserve prior blocking findings across review cycles.

SPEC-04 / AC-04: missing/incomplete review cannot pass; modifying reviewed code reports `STALE`; all unresolved v2 findings prevent `PASSED`; a later clean cycle must account for prior blocking findings. Implementation: [final review](../src/final-review.mjs). Acceptance: [final-review tests](../test/final-review.test.mjs). V2 resolves actual hashed files and candidate-bound command receipts, verifies reviewer signatures and rejects replay, self-review and revoked authority. V1 is retained for history and cannot establish production readiness. Signatures prove identity/input binding, not the correctness of a reviewer conclusion. Acceptance: [product-flow regression](../test/product-flow.test.mjs).

### BR-05 — Architecture claims preserve uncertainty

Trigger: capacity/cost modeling or architecture verification. Separate declared constraints, modeled calculations and benchmark-backed measurements. Do not present an unsupported estimate as measured production capacity, a partial cost as complete cost, or a stale artifact as current evidence.

SPEC-05 / AC-05: contradictory requests are rejected; benchmark evidence binds to its normalized request; artifact modification/staleness is detected; unsupported production claims fail evaluation. Implementation: [system design](../src/system-design.mjs). Acceptance: [system-design tests](../test/system-design.test.mjs). The supported design output remains a review input until product-specific live acceptance is executed.

### BR-06 — Demo, release and live verification are different decisions

Trigger: presentation or release preparation. Synthetic evidence may explain actual local control-plane behavior when explicitly labeled. It cannot prove native host execution, production integrations, customer outcomes, performance improvement or a published candidate's acceptance. Publishing must follow the authorized release workflow; production acceptance additionally requires readback and target-environment sanity.

SPEC-06 / AC-06: `team demo` produces an explicitly synthetic timeline and reaches local `READY` only after its simulated assurance/fix/review sequence completes. An empty live conformance template remains `NOT_RUN`. Implementation: [demo](../src/team-demo.mjs), [conformance](../src/team-conformance.mjs). Acceptance: [proof-loop tests](../test/team-proof-loop.test.mjs). The [npm workflow](../.github/workflows/npm-publish.yml) freezes one archive, publishes that archive and requires exact registry readback and clean-install sanity. This mechanism has deterministic negative coverage in [published-package tests](../test/published-package.test.mjs); live registry execution and operational observation are not claimed by local tests.

### BR-07 — Product documentation reaches the execution context

Trigger: installing this revised kit and compiling a task context. Product work follows the canonical [Product Delivery Contract](../assets/enterprise-ai-agent-os/.ai/core/product-delivery.md). Documents carry business/spec/acceptance/design/task/evidence links; baseline changes reopen affected downstream acceptance. Missing product facts remain explicit blockers.

SPEC-07 / AC-07: bootstrap installs the contract and authoring aids, and context compilation includes the contract as mandatory governed context rather than depending on keyword matching. Implementation: [compiler](../src/context-compiler.mjs), [required workflow](../assets/enterprise-ai-agent-os/.ai/core/required-workflow.md). Executable acceptance: installation and context tests in [bootstrap tests](../test/bootstrap.test.mjs). Limit: document semantics, decision-maker authority and live acceptance require review; the compiler does not automatically validate all BR/SPEC links or perform deployment.

### BR-08 — A novice sees actionable progress and truthful outputs

Trigger: start/resume a product goal. The agent proposes sourced rules/specs, concrete design and a reviewable plan, performs already authorized work, and explains what/why/output/path/next. Required decisions block implementation; document presence is DOCUMENTED, never proof of behavior. Every coding task links an AC and declared checks.

SPEC-08 / AC-08: start shows discovery with expected paths without creating fake completed documents; next provides a trusted control objective with untrusted user context; view escapes user content; contracts reject missing/stale hashes, broken references and task cycles. Latest failed executions defeat older passes. Changed docs or out-of-scope writes invalidate progress. Implementation: [product flow](../src/product-flow.mjs), [execution evidence](../src/delivery-evidence.mjs), [host workflow](../assets/enterprise-ai-agent-os/.ai/workflows/develop-product.md). Acceptance: [product-flow tests](../test/product-flow.test.mjs), clean-installed product commands in [packed smoke](../scripts/smoke-packed.mjs).

### BR-09 — Release acceptance names the artifact and environment

SPEC-09 / AC-09: release and sanity require a current authenticated review, current checks, signed operator authority, matching input/artifact/environment, real hashed evidence and a completed observation interval. Mismatch/staleness/replay are rejected. Fixture attestation remains OPERATOR_ATTESTED_FIXTURE; production is LIVE_ATTESTED, not independently verified live proof. Correctly recorded completion transitions next action to observation/incident feedback. Acceptance: signed positive/negative fixtures in product-flow tests. Target production deployment is NOT_TESTED.

## Design decisions and current work

DEC-01: keep one shared contract under `.ai/core/` and load it as mandatory task context. Consumers are planners, implementers, QA/review, release operators and presenters. Copying separate policies into each skill would create conflicting authorities.

DEC-02: retain reusable authoring aids, but never instantiate them automatically. Existing product documents remain canonical; small projects can combine rules/specs in one file, as this product does.

DEC-03: reuse repository trust and signed-action policy for v2 final review and operator release/sanity records. Preserve v1 readability but fail closed on production acceptance. Keep local executed checks separate from operator-attested environment claims.

DEC-04: the CLI derives the next product step and writes a visible snapshot; the active coding host executes it. Do not ship a pretend autonomous background agent or invent confidence percentages.

| Task | Contract | Output | Done condition |
| --- | --- | --- | --- |
| DOC-01 | BR-07 / SPEC-07 / AC-07 | Canonical delivery policy, authoring aids and workflow/skill integration | Installed files and mandatory context verified; mirrors synchronized |
| DOC-02 | BR-01–07 | This product contract, existing design and delivery record | Source/test references resolve; actual behavior and limitations agree |
| DEMO-01 | BR-03, BR-06 | Synthetic local timeline and presenter procedure | Actual command rehearsed; output inspected; reset/repeatability checked; claim scope disclosed |
| FLOW-01 | BR-04, BR-08–09 | Product step state, resolved command/review evidence and signed release/sanity | Regression and packed-install acceptance; truthful local/attested boundaries |
| RELEASE-01 | BR-06 | Future frozen artifact and target-environment acceptance | BLOCKED until authorized release, readback, clean installation, required host/platform checks and release-owner decision |

Changes to these rules require a revision, rationale, affected AC/task/design IDs and invalidation of affected evidence. Reviewers must assess executable behavior against this contract, not merely count completed documents.

## BR-10 — Production controls are explicit and evidence bounded

Authority: user's production harness request on 2026-10-02. Trigger: production document/engineering planning or production release record. Contract v2 binds AAK-PRODUCTION-1 controls for documents, business rules, budget, system design/stack, specs, plan/timeline, stories/tasks, conventions/maintainability, APIs, performance/memory, security, persistence and review/operations. Sources and numeric budgets must be current; missing controls, invalid cross-references, capacity/dependency errors and forecast above ceiling reject binding. Required executable controls link to AC checks; reports distinguish MISSING, DOCUMENT_BOUND, NOT_TESTED, LOCAL_EXECUTED and justified exclusions.

SPEC-10 / AC-10: v1 remains readable/local but PRODUCTION release is rejected even with clean signed review. V2 rejects missing rules, stale sources/stack, placeholders, unmapped checks, unowned story/tasks and invalid budgets/schedules; changed documents invalidate acceptance. Implementation: [production harness](../src/production-harness.mjs) and [flow](../src/product-flow.mjs). Acceptance: production policy tests in [product-flow tests](../test/product-flow.test.mjs). Policy and standard scope: [harness guide](../assets/enterprise-ai-agent-os/.ai/docs/production-harness.md). Field presence is not prose approval, and a passing receipt does not prove check adequacy or production capacity.
