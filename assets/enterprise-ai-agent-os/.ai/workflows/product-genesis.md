# Product Genesis Workflow

Use this workflow when no codebase or approved product baseline exists.

1. Run `start-product`; record idea version 1 without implementation.
2. Run `discuss-product-idea` until the problem, people, outcome, constraints, scope, and unknowns are decision-ready.
3. Run `research-product-opportunity` for material desirability, viability, feasibility, risk, cost, privacy, legal, or alternative questions.
4. Run `write-business-requirements`; obtain named human BRD approval through `approve-product-baseline`.
5. Run `write-product-specification`; compose system-design, security, data, UX, operations, and test capabilities; obtain named human specification approval.
6. Run `plan-product-delivery`; produce an MVP, traceable backlog, milestones, estimates, Definition of Ready, and Definition of Done.
7. Obtain implementation approval, then use existing engineering skills to build and verify each slice.
8. Run `review-product-outcome` before release and after meaningful production evidence.
9. Route every material deviation through `control-product-change`.

At each step, persist a successor artifact, its parents, hash, author, time, status, evidence, decisions, and approval state. Never skip a gate because an agent can generate the next document.
