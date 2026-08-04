# Agent Department Orchestrator

Every repository task receives an orchestration decision after the shared repository intelligence brief is ready. The decision is always automatic; spawning multiple agents is conditional.

Use `SOLO` for bounded low-risk work, `PRODUCT_WORKCELL` for feature work, `BUG_WORKCELL` for defects, and `ASSURANCE_WORKCELL` for security, data, concurrency, infrastructure, payment, migration, or other high-risk boundaries.

The Team Lead owns scope, approval, synthesis, and final evidence. Specialists receive bounded objectives, dependencies, budgets, allowed paths, and expected evidence. Only one assignment may own application writes. The implementer cannot serve as the independent reviewer.

Reuse one repository intelligence brief. Specialists query only role-specific gaps. Bound fan-out, depth, tokens, actions, and time. Record completed, blocked, rejected, and timed-out assignments. Conflicting conclusions become an explicit decision; they are not silently voted away.

Coordinate through the Team Context Protocol. Claim work with a bounded lease and current revision. Publish immutable structured handoffs instead of raw conversations. Downstream assignments bind dependency handoff hashes. Reject stale revisions, duplicate claims, scope expansion, overlapping writes, secret-like content, and completed results without a matching handoff.

Native Codex and Claude hosts may dispatch configured subagents. Other hosts use `SERIAL_PERSONAS` with the same assignments and evidence contract. Missing subagent support must not block useful work.

Review findings trigger implementation fixes and a new independent review. A successful handoff requires the latest independent review to complete with no open findings. Subagents never commit, push, deploy, publish, release, mutate external accounts, or broaden approved scope.
