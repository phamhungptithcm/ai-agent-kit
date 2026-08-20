---
name: write-product-specification
description: Translate an approved business-requirements baseline into a versioned product and system specification. Define user journeys, functional and non-functional requirements, acceptance criteria, data and API boundaries, security, operations, observability, rollout, and traceability without starting implementation.
---

# Write Product Specification

Require an approved BRD baseline. If it is missing or stale, return `BLOCKED_BY_BRD_GATE`.

Use `.ai/templates/product-specification.schema.json` and `.ai/templates/product-design-bundle.schema.json`. Assign stable `FR-*`, `NFR-*`, `AC-*`, `DATA-*`, and `INT-*` identifiers. Specify:

- personas, end-to-end journeys, failure paths, permissions, and UI states
- functional behavior and business-rule mapping
- measurable performance, reliability, security, privacy, accessibility, and operability requirements
- data lifecycle, integrations, APIs, migrations, observability, support, rollout, and rollback
- acceptance scenarios in Given/When/Then form where useful
- trace links from every spec item to BRD requirements and planned verification

Separate mandatory constraints from candidate design decisions. Produce a risk-adaptive design bundle: `LEAN` requires UX, architecture, and test; `STANDARD` also requires domain, data, security, operations, and rollout; `HIGH_ASSURANCE` adds privacy, compliance, capacity, and disaster recovery. A `NOT_APPLICABLE` track requires rationale. Compose `design-scalable-systems`, `threat-model`, and domain profiles when relevant.

Record both `specification` and `design`, then run `product analyze --gate SOLUTION_BASELINE`. Finish at `SOLUTION_READY_FOR_APPROVAL`; do not authorize implementation.
