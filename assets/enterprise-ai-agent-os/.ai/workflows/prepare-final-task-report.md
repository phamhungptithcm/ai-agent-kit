# Prepare Final Task Report

1. Confirm the governed task ID and current repository commit.
2. For every acceptance criterion, record `VERIFIED`, `IN_PROGRESS`, `PENDING`,
   `BLOCKED`, `FAILED`, or `NOT_APPLICABLE` with evidence or rationale.
3. Record every required quality gate as `PASSED`, `FAILED`, `NOT_RUN`,
   `NOT_APPLICABLE`, `BLOCKED`, or `STALE`. A passing record requires an
   evidence reference and is bound to the current commit.
4. If the provider exposes stable usage metadata, normalize and record token
   counts. Prefer a provider event ID for idempotency. Use cumulative mode only
   with a session ID; the ledger stores only its hash.
5. Generate the report:

   ```bash
   ai-agent-kit runtime task report --id TASK-ID --format text
   ```

6. Include the report in the final response. For a shorter footer:

   ```bash
   ai-agent-kit runtime task report --id TASK-ID --format compact
   ```

7. Treat `READY` as evidence for the configured repository gates only. It does
   not prove that a deployment occurred or that an external production
   environment is healthy.
