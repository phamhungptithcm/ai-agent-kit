---
name: assure-product-trust
description: Complete accessibility, market-specific privacy/legal, threat modeling, security findings, data classification, retention, migration, retained-data validation, and deletion planning. Use before the investment or production gate, for sensitive products, or when trust and data obligations are incomplete.
---

# Assure Product Trust

Use `product-trust-compliance.schema.json`, `product-data-lifecycle.schema.json`, and matching security/privacy/accessibility profiles.

1. Identify actual markets, users, interfaces, sensitive data, abuse cases, trust boundaries, third parties, retention, and deletion obligations.
2. Produce a separate accessibility review. `NOT_APPLICABLE` requires an explicit product-surface rationale.
3. Record privacy/legal review per market with a named accountable owner; do not provide or fabricate legal sign-off.
4. Create a threat model and tool-bound security finding ledger. Threat modeling cannot be waived; unresolved Critical/High findings block advancement unless a named human formally accepts the exact risk.
5. Define data classes, retention, migrations, retained-data validation, deletion workflows, rollback, and evidence requirements.
6. Verify referenced receipts and run `product analyze --gate INVESTMENT_DECISION`.

Keep credentials, personal data, exploit payloads, and hidden reasoning out of portable artifacts.
