# Compile Task Context

1. Create or inspect the governed runtime task.
2. Refresh repository intelligence when available. Missing optional index tools
   may produce `DEGRADED`; they must not block read-only context compilation.
3. Run `ai-agent-kit context compile --id TASK-ID`.
4. Review status, provenance, selection reasons, token use, and exclusions.
5. If status is `BLOCKED`, restore missing mandatory policy or increase the
   explicit budget.
6. If implementation requires a READY gate and status is `DEGRADED`, repair or
   refresh repository intelligence before implementation.
7. Preserve the content hash with task evidence so the pack can be replayed.
