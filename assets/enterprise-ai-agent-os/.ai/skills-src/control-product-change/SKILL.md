---
name: control-product-change
description: Evaluate and govern changes after a Product Genesis baseline is approved. Trace the requested change across business requirements, specification, architecture, backlog, tests, cost, schedule, security, and operations; create a new version and require reapproval when the approved meaning changes.
---

# Control Product Change

Use `.ai/templates/product-change.schema.json` and `.ai/rules/product-delivery-integrity.md`.

1. Capture the change request and reason without editing the approved baseline in place.
2. Compute affected requirements, journeys, contracts, data, architecture, backlog, tests, operations, cost, and schedule.
3. Classify as clarification, non-material correction, or material baseline change.
4. Show alternatives, recommendation, compatibility impact, migration/rollback needs, and residual risks.
5. Create a successor artifact version and trace old-to-new IDs.
6. Require named human reapproval for material changes before implementation continues.

Use immutable `product artifact-put` successors. Re-run the affected analysis gate; never manually restore a stale approval.

Return `ACCEPTED`, `CHANGES_REQUESTED`, `REJECTED`, or `NEEDS_DECISION`, plus the exact work that is paused or still authorized.
