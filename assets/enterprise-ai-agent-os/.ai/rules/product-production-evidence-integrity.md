# Product Production Evidence Integrity

1. Evidence is an immutable receipt, not a free-form reference. Bind repository identity, current full commit, regular-file path and SHA-256 when local, provider run/deployment/environment identity when remote, collection time, expiry, status, trust level, limitations, and receipt hash.
2. Reject missing, duplicate, secret-bearing, path-escaping, symlinked, hard-linked, oversized, expired, future-dated, foreign-repository, commit-drifted, file-drifted, mixed-environment, or insufficient-trust evidence.
3. `SELF_DECLARED`, `LOCAL_VERIFIED`, and `REPOSITORY_BOUND` receipts never authorize a provider or production claim. `PROVIDER_VERIFIED` and `SIGNED_ATTESTATION` require an authorized verifier adapter; fields alone cannot elevate trust.
4. Convergence requires a clean tracked worktree, current full commit, existing code/test files with measured hashes, current approved baselines, and current evidence receipt IDs.
5. Release readiness requires provider-bound CI/CD, observability, incident, backup/restore, rollback, analytics, and support evidence. Applicability rationale may narrow non-core controls but cannot waive security, environment identity, rollback, or production truth.
6. A release candidate binds all current artifact, approval, convergence, evidence, repository, and environment hashes. Any material successor or drift invalidates it.
7. Documents, schemas, fixtures, local runs, synthetic rehearsals, and provider-ready configuration are not proof of production deployment or live outcomes.
