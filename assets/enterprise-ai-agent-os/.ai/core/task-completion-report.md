# Task Completion Report

Every governed task should finish with one evidence-derived report covering:

- weighted acceptance-criterion progress;
- completed and remaining criteria;
- current quality-gate results;
- Git worktree cleanliness and current commit;
- known issues limited to the checks actually executed;
- fail-closed production readiness and blockers;
- final implementation-review decision, cycle count, reviewed dimensions, findings from every cycle, fixes, residual risks, and limitations;
- provider-reported token usage when available;
- API-equivalent estimated cost when an exact, effective pricing entry exists.

Use the runtime ledgers instead of estimating progress or remembering command
results from conversation context. `NOT_RUN`, `STALE`, missing, failed, or
commit-mismatched evidence never counts as passed. Do not say that code has no
issues; say that no known issues were found within the executed checks.

Before the final response:

1. Record each acceptance criterion status with `runtime criterion record`.
2. Record each applicable quality gate with `runtime check record`.
3. Record provider usage with `runtime usage record` when stable usage metadata
   is available. Never parse or store prompt, response, transcript, secret, API
   key, chain-of-thought, personal identifier, or raw tool output.
4. Run `final-implementation-review`, fix approved in-scope findings, re-run affected checks, and record the current JSON review with `runtime review record`.
5. Run `runtime task report --format text`.
6. Include the rendered report, or its compact form, in the final response. Do not produce a success handoff unless the final review is current and `PASSED`.

If an adapter does not expose token usage, report `Unavailable`; never infer
zero. If the task uses a subscription, credits, negotiated pricing, tools, or
taxes, label the monetary value as an API-equivalent estimate and keep actual
billed cost `Unavailable`.

Report rendering is fail-open, but final success handoff and production readiness
are fail-closed. Neither may pass without a current final implementation review
and current evidence for every configured required gate.
