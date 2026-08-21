---
name: prepare-production-readiness
description: Build the exact evidence-backed release dossier for CI/CD, infrastructure, deployment, observability, SLOs, incidents, migration, capacity, backup/restore, rollback, analytics, and support. Use after implementation convergence or before any limited or production release decision.
---

# Prepare Production Readiness

Use `.ai/workflows/prepare-product-production.md` and the production-readiness, analytics, support, evidence, environment, and release-candidate schemas.

1. Record immutable provider receipts for CI/test/security/deployment/operations results. Strings, screenshots without binding, expired receipts, foreign commits, mixed environments, and self-declared evidence do not pass.
2. Create a provider-verified environment attestation bound to the current full Git commit and exact environment identity.
3. Require CI/CD, observability, incident readiness, backup/restore, and rollback evidence. Evaluate infrastructure, migrations, retained data, load/capacity, and legal/accessibility applicability by profile and scope.
4. Define product analytics instrumentation, live outcome metrics, support channels, escalation, on-call, runbook, and customer-success workflow.
5. Run `product analyze --gate PRODUCTION_READINESS`; request named-human approval on the exact dossier hash.
6. Generate `product release-candidate`. `PRODUCTION` requires a production environment attestation and clean tracked worktree.

Never equate documents, fixtures, local tests, provider-ready configuration, or synthetic rehearsal with production evidence.
