# Final Implementation Review

1. Run `final-implementation-review` after implementation and validation, before the final response.
2. Compare requirements, approval, and actual diff. Treat scope drift as blocking.
3. Apply the relevant code, quality, security, data, performance, and operations review skills.
4. Exercise both success and material failure paths, including invalid input, partial failure, timeout, retry, cleanup, rollback, and dependency failure where applicable.
5. Record the current cycle and every finding. Fix approved in-scope defects, re-run affected checks, then review the complete current diff again.
6. Repeat the review-fix-verify cycle until a fresh review passes. Do not use a retry limit to turn unresolved findings into success.
7. Complete `.ai/templates/final-implementation-review.json` for every cycle with review evidence, fixed findings, residual risks, and limitations.
8. Record each cycle with `ai-agent-kit runtime review record --id TASK-ID --file final-review.json`.
9. Generate the final task report. Do not produce a success handoff while the newest review is missing, stale, rejected, or blocked. If progress requires new scope or authority, return a precise blocker instead.
