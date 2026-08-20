---
name: retire-product
description: Plan and govern product retirement, customer communication, dependency shutdown, retained-data validation, deletion, legal holds, rollback windows, and human approval. Use for sunset, end-of-life, tenant exit, market withdrawal, or verified data-deletion work.
---

# Retire Product

Use `product-retirement.schema.json` and `RETIREMENT_DECISION`.

1. State the retirement trigger, scope, accountable owner, affected customers, dependencies, data classes, legal holds, and reversible window.
2. Plan customer communication, export/portability, support, billing/contract handling, traffic shutdown, secret/key revocation, archive, and dependency removal.
3. Define deletion by system and backup, retained-data validation, exceptions, evidence receipts, and rollback limits.
4. Rehearse when feasible. Provider-verified receipts are required for destructive completion claims.
5. Run `product analyze --gate RETIREMENT_DECISION` and bind the named-human decision to the exact plan hash.

Planning or approval alone never proves that customer data was deleted. External deletion requires separate explicit authority.
