# Architecture Pulse

Architecture Pulse is an optional, local-first structural evidence source for AI-assisted changes.

- Inventory source from Git with explicit path, symlink, hard-link, file-count, byte, and time limits.
- Keep unsupported, excluded, generated, unreadable, and unresolved inputs visible in coverage.
- Resolve same-language dependencies conservatively; require explicit manifest evidence for cross-language edges.
- Report cycles, condensation depth, cohesion, boundaries, hotspots, and bounded blast radius with supporting graph evidence.
- Bind baselines to repository identity, source/config digests, tool/extractor/metric versions, and integrity.
- Treat `STALE`, `UNTRUSTED`, and `DEGRADED` as non-passing evidence states.
- Do not create a baseline from degraded evidence; bounded sampling or resource exhaustion must remain visible.
- Keep the aggregate Pulse index diagnostic. Only named, configured rules and deltas may block.
- Preserve existing task, approval, policy, and runtime authority. Pulse reports evidence; it does not approve work.
- Operate offline without telemetry or implicit network access.

Use `ai-agent-kit pulse scan` for diagnosis, `pulse baseline create|verify` for comparison state, `pulse check` for explicit policy, and `pulse explain` for a concise evidence view. Bind a result to a task with `--task-id`; do not reuse an unbound or foreign artifact in a task report or Change Passport.

Architecture Pulse is a clean-room, first-party AI Agent Kit module with no Sentrux code, package, binary, service, telemetry, asset, or runtime dependency.
