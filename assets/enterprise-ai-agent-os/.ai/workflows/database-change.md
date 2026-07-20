# Database Change Workflow

Use this workflow for schema changes, SQL changes, migrations, data migrations, query tuning, database diff scripts, or datafix procedures.

1. Run the Repository Intelligence Gate and stop if it is blocked.
2. Use CodeGraph to identify affected data-access paths, callers, jobs, services, and consumers.
3. Use CocoIndex to find related schema docs, migrations, datafix procedures, runbooks, specs, and historical notes.
4. Identify affected tables, views, procedures, jobs, and consumers.
5. Classify data sensitivity and business criticality.
6. Detect language/framework/database-access tooling and application/platform/domain, then apply `.ai/quality-profiles/database.yaml` plus the matching language and platform/domain profiles.
7. Review connection/session/cursor lifecycle, locking, transaction, query-plan, index, and rollback implications.
8. Reject `repository.save()` inside large loops unless unavoidable and explicitly approved with transaction size, flush/clear behavior, locking risk, and retry/idempotency evidence.
9. Prefer backward-compatible migrations for rolling deployments.
10. Separate additive schema changes from destructive cleanup.
11. Include validation queries and expected row counts when applicable.
12. Prepare rollback or compensation steps.
13. Require explicit approval for destructive changes or production datafixes.
14. After approved changes, refresh CodeGraph/CocoIndex indexes and re-run the gate.

Never run a production datafix autonomously.
