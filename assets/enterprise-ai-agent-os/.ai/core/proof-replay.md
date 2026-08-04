# Agent Proof Replay

Agent Proof Replay turns governed runtime evidence into a compact explanation
of what the agent did, why each protected action was allowed or denied, what
verification ran, what review fixed, and whether the result is ready.

The default proof pack is local and contains:

- redacted deterministic JSON;
- one standalone offline HTML page;
- a concise PR proof card;
- a readiness badge derived from current evidence.

Raw prompts, source code, secrets, direct personal identifiers, memory content,
and command logs are excluded. Human-readable goal and finding text is replaced
with hashes or bounded categories. OTLP-compatible export is opt-in and must use
the same redacted proof model.

Proof is explanatory evidence, not an authorization token. It cannot approve a
task, grant a capability, publish an artifact, or make a release ready by
itself. Stale review, missing required gates, or incomplete task state produces
`NOT_READY`.
