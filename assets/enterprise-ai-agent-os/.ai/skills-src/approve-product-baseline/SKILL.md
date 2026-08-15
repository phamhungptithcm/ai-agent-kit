---
name: approve-product-baseline
description: Prepare and verify a human approval gate for Product Genesis artifacts. Check completeness, traceability, contradictions, unresolved critical decisions, reviewer authority, scope, and artifact hashes before recording an approved BRD, specification, or delivery baseline; never self-approve.
---

# Approve Product Baseline

Follow `.ai/rules/product-approval-integrity.md` and `.ai/workflows/establish-product-baseline.md`.

1. Identify the exact artifact versions and hashes under review.
2. Validate required fields, requirement quality, trace coverage, risks, and unresolved decisions.
3. Classify unresolved items as blocking or accepted residual risk.
4. Present a concise decision package: scope, non-goals, trade-offs, cost/time range, evidence limits, and downstream impact.
5. Require a named human approver, authority basis, timestamp, decision, constraints, and rationale.
6. Record `APPROVED`, `CHANGES_REQUESTED`, or `REJECTED` using `.ai/templates/product-baseline-approval.schema.json`.

An agent recommendation is not approval. Approval of one version does not approve later changes. Only `APPROVED` artifacts with valid traceability may advance to delivery planning.
