# Product Genesis Workflow

Use this workflow when no codebase or approved product baseline exists.

1. Run `start-product`; select a risk profile and create Product Workspace idea version 1 without implementation.
2. On every later session run `product resume`, then `product next`; do not reconstruct state from chat.
3. Run `discuss-product-idea` in rounds of at most three decision-unlocking questions. Persist answers and confirmed/assumed/unknown/changed context immediately.
4. Run `research-product-opportunity` for material desirability, viability, feasibility, risk, cost, privacy, legal, or alternative questions. Analyze and obtain the exact discovery decision approval.
5. Run `validate-product-discovery`; record hypotheses, experiments, prototypes, usability/customer receipts, and obtain an exact continue/pivot/stop Alpha approval.
6. Run `assess-product-viability` and `assure-product-trust`; complete business case, unit economics, pricing, go-to-market, accessibility, market privacy/legal, threat/security, and data-lifecycle baselines. Obtain the exact investment approval.
7. Run `write-business-requirements`; produce BRD plus explicit business rules. Analyze and obtain the exact BRD approval.
8. Run `write-product-specification`; produce journeys, failure paths, measurable requirements, acceptance, operations, and a risk-adaptive UX/domain/data/architecture/security/test/rollout design bundle. Analyze and obtain the exact solution-bundle approval.
9. Run `plan-product-delivery`; produce the smallest vertical MVP, traceable backlog, milestones, estimate ranges, Definition of Ready, and Definition of Done. Analyze and obtain the exact delivery approval.
10. Generate a GitHub issue plan in preview. External sync needs its own exact-hash human approval and explicit apply authorization. Ambiguous creates stop for remote reconciliation instead of being retried automatically.
11. Run `run-product-iteration`. Implement only approved capacity-bounded slices; record progress, acceptance, review, retrospective, and material-change propagation.
12. Run convergence on a clean tracked commit with existing code/test paths and current repository-bound receipts.
13. Run `prepare-production-readiness`; bind provider evidence for delivery, operations, data, capacity, restore/rollback, analytics, and support to one environment attestation. Obtain exact readiness approval and create a release candidate.
14. Obtain the exact human release decision. External release/deployment remains separately authorized.
15. Run `operate-product`, feed live outcomes into successor versions, and use `retire-product` for sunset and verified data deletion.

At each step, persist a successor artifact, its parent hash, author, time, status, evidence, decisions, and approval state. Never skip a gate because an agent can generate the next document. `LEAN` shortens documents and optional design tracks; it never removes evidence, traceability, human approval, security, verification, rollback, or release truth.
