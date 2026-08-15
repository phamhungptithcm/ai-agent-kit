---
name: plan-product-delivery
description: Turn an approved product specification into an Agile delivery plan and GitHub-ready backlog. Slice outcomes into MVP increments, epics, stories, enablers, tests, dependencies, risks, milestones, Definition of Ready, and Definition of Done while preserving requirement traceability and approval boundaries.
---

# Plan Product Delivery

Require approved BRD and specification baselines. Use `.ai/templates/product-delivery-backlog.schema.json` and `.ai/workflows/deliver-approved-product.md`.

1. Define the smallest end-to-end MVP that proves the highest-risk value assumption.
2. Slice vertical user outcomes before technical layers.
3. Create stable epic/story/task IDs with linked `BR-*`, `FR-*`, `NFR-*`, and `AC-*` IDs.
4. Include acceptance criteria, test approach, observability, security, documentation, migration, rollout, rollback, dependency, owner role, estimate range, and risk.
5. Mark discovery spikes explicitly; never disguise uncertainty as a committed estimate.
6. Produce GitHub issue drafts or API payloads only. Create external issues only when separately authorized.

Return sequencing, critical path, parallelizable work, milestone exit criteria, Definition of Ready, Definition of Done, and the first implementation-ready slice.
