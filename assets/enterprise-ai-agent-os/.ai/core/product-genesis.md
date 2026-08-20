# Product Genesis Control Plane

Product Genesis moves a product from a rough idea to an evidence-backed, operable, and retireable product through a durable Product Workspace, experiment-driven discovery, iterative delivery, production evidence, and human-approved baselines.

## Product Workspace

`.ai/products/<product-id>/product.json` is the sealed state pointer. Immutable artifact versions, evidence receipts, environment attestations, iterations, a sealed question ledger, a hash-chained event ledger, analyses, approvals, GitHub previews, sync receipts, convergence reports, and release candidates live beside it. Resume from current heads and cited predecessors; conversation history is never the product record.

The workspace maintains one intent spine:

`idea -> research -> hypothesis/experiment/usability/customer evidence -> viability/trust/data -> BR-* -> RULE-* -> FR/NFR-* -> AC-* -> design -> delivery item -> iteration -> commit/code/test/receipt -> environment -> release candidate -> live outcome -> retirement`

Facts must be labeled `confirmed`, `assumed`, `unknown`, or `changed`. Ask no more than three current decision-unlocking questions. New evidence or changed context invalidates the affected approval hash.

## State machine

`IDEA -> DISCOVERY -> RESEARCHED -> EXPERIMENTING -> ALPHA_REVIEW -> ALPHA_APPROVED -> INVESTMENT_REVIEW -> INVESTMENT_APPROVED -> BRD_DRAFT -> BRD_APPROVED -> SPEC_DRAFT -> DESIGN_DRAFT -> SPEC_APPROVED -> DELIVERY_PLANNED -> ITERATING -> IMPLEMENTING -> VERIFIED -> PRODUCTION_REVIEW -> RELEASE_CANDIDATE -> RELEASE_DECISION -> OPERATING -> MONITORING -> RETIREMENT_REVIEW -> RETIRED`

Allowed exception states are `NEEDS_DECISION`, `CHANGES_REQUESTED`, `PAUSED`, `REJECTED`, and `RETIRED`.

Every transition records the source version, successor version, actor, timestamp, evidence, unresolved decisions, and required next gate. Artifact history is append-only. Corrections create successors; they do not overwrite approved evidence.

## Hard gates

- Research cannot be called validation without direct evidence.
- Large requirements work requires an approved Alpha continue decision based on hypotheses and experiments.
- BRD drafting requires approved business viability, accessibility, market privacy/legal, threat/security, and data-lifecycle baselines.
- BRD approval requires a named business authority.
- Specification and design work require the current approved BRD hash.
- Solution approval covers the BRD, business rules, specification, and risk-adaptive design bundle.
- Delivery planning requires the current approved solution hash.
- Implementation requires the approved delivery scope and implementation approval evidence.
- Execution uses capacity-bounded iterations with a goal, progress, acceptance, review, retrospective, and material-change propagation.
- Material changes require impact analysis and reapproval.
- Convergence binds a clean tracked Git commit, current code/test file hashes, current baselines, and current evidence receipts.
- Release readiness requires provider-bound CI/CD, infrastructure/deployment, observability/SLO/incident, migration/retained-data, capacity, restore/rollback, analytics, support, and environment evidence.
- A production claim requires a Production release candidate and provider-verified Production environment attestation. Documents or synthetic evidence are never sufficient.
- Operation feeds live outcomes, support, incidents, cost, and product analytics into successor decisions; retirement separately governs communication, dependency shutdown, and verified data deletion.

Agents may facilitate, draft, challenge, trace, and recommend. Agents may never impersonate an approver, silently advance a gate, or treat a GitHub issue status as approval.

GitHub planning is preview-only by default. External issue creation requires separate write authority, a current named-human `GITHUB_ISSUE_PLAN` approval, its exact approval hash, and explicit apply intent.
