---
name: final-implementation-review
description: Run the mandatory evidence-backed review after implementation and before the final developer handoff. Use whenever an AI agent finishes code, configuration, infrastructure, tests, migrations, or other production-relevant changes. Verify requirement match, security, code quality, non-success paths, error handling, production readiness, and trade-offs; fix in-scope defects, re-review, and block final success output until the review passes.
---

# Final Implementation Review

Act as the final engineering gate, not as a summary writer. Review the actual diff and repository behavior after implementation is complete and before producing the final response.

## Gate sequence

1. Re-read the approved goal, acceptance criteria, constraints, and explicit out-of-scope behavior.
2. Compare the actual diff to approval. Stop and request delta approval for material scope drift.
3. Inspect changed execution paths and affected callers, consumers, contracts, data, configuration, and operations.
4. Apply `code-review` and `code-quality-review`. Apply `write-product-content` whenever user-facing text, accessible text, or displayed-data meaning changed. Apply `security-review`, `database-change`, `performance-investigation`, `observability-review`, or other domain skills when their risks are present.
5. Review every required dimension in `.ai/templates/final-implementation-review.json`:
   - requirement and acceptance-criterion match;
   - security, privacy, authorization, secrets, dependency, and abuse paths;
   - correctness, maintainability, compatibility, and code quality;
   - invalid input, empty state, partial failure, timeout, retry, cancellation, concurrency, and dependency-failure paths;
   - error propagation, cleanup, rollback, operator visibility, and user-safe messages;
   - product-language agreement with behavior and business meaning, all eight mandatory Human Interface principles, target-platform fit, applicable UI states, natural respectful tone, accessibility, localization, displayed-data semantics, and current in-context evidence;
   - production configuration, migration, observability, deployment, and rollback readiness;
   - material trade-offs, limitations, accepted risks, and deferred work.
6. Run the smallest sufficient focused and regression checks. A passing happy-path test never substitutes for failure-path review.
7. Record findings with severity, location, evidence, production impact, and correction.
8. Enter the review loop. Fix every actionable finding whose correction stays inside approved scope, re-run affected checks, then start a new independent review cycle against the complete current diff. Never mark a finding fixed from code inspection alone when executable verification is available.
9. Repeat `review → fix → verify → review again` until a fresh cycle passes every required dimension. There is no success shortcut and no fixed retry count. Never weaken a control, test, requirement, or review threshold to make the gate pass.
10. If a cycle cannot progress because a fix is out of scope, destructive, production-impacting, or requires missing authority/evidence, record `BLOCKED` and ask for the exact approval or input needed. A blocked handoff is not a successful final output.
11. Record every cycle, including blocked cycles before fixes and the final passing cycle:

   ```sh
   ai-agent-kit runtime review record --id TASK-ID --file final-review.json
   ```

   Prefer an ignored task-local path such as `.ai-agent-kit/runtime/review-inputs/TASK-ID.json` so the evidence input does not make the application worktree dirty.

12. Render the final task report. Return a successful final handoff only when the newest recorded cycle is current and `PASSED`. Preserve earlier findings and fixes in the report.

## Decision rules

- `PASSED`: every dimension is `PASSED` or truthfully `NOT_APPLICABLE`, no critical/high finding remains open, and evidence matches the current commit.
- A review containing changed product language or displayed-data semantics cannot be `PASSED` when `.ai/templates/product-content-review.md` is missing, stale, failed, based only on isolated resource strings, missing any required Human Interface principle status, or lacks target-platform evidence.
- `BLOCKED`: any required dimension failed or was not run, evidence is insufficient, scope drift needs approval, or a critical/high finding remains open.
- Never claim production readiness solely because this review passes. The final report must also satisfy acceptance, quality, Git, release, deployment, and environment evidence required by the task.
- Preserve medium/low residual risks and accepted-risk rationale in the report; do not hide them to obtain a pass.
- Never loop silently on the same unresolved blocker. Continue fixing while safe progress is possible; otherwise return a precise blocked result and request the smallest required decision.

## Final handoff

Include:

- review decision;
- dimensions reviewed and evidence used;
- findings discovered;
- defects fixed and checks rerun;
- unresolved risks, limitations, and blockers;
- production-readiness status from the evidence-derived final task report.

Do not emit a success-style final response before this gate completes.
