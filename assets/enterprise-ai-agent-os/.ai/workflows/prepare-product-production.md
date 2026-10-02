# Prepare Product Production Workflow

1. Require reviewed iteration, current delivery approval, and current convergence.
2. Ingest CI, test, security, accessibility, privacy/legal, infrastructure, deployment, migration, retained-data, load, observability, incident, restore, rollback, analytics, and support receipts through authorized verifiers.
3. Create a current environment attestation. Staging, pilot, and production require provider-verified or signed trust.
4. Build risk-adaptive production-readiness, product-analytics, and support-readiness artifacts. Core CI/CD, observability, incident, backup/restore, and rollback controls cannot be waived.
5. Run `product analyze --gate PRODUCTION_READINESS`; resolve stale, foreign, mixed, or missing evidence.
6. Record named-human `PRODUCTION_READINESS` approval on the exact bundle hash.
7. Generate an immutable release candidate on a clean tracked commit. `PRODUCTION` requires a Production environment attestation.
8. Run `product analyze --gate RELEASE_DECISION`; release remains a separate named-human decision and external execution remains separately authorized.
