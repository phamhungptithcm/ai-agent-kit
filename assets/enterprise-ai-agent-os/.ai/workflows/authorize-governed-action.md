# Authorize a Governed Action

1. Create and approve a governed runtime task with explicit tools, paths,
   domains, risk, action budget, repository commit, policy revision, and adapter.
2. Set `AI_AGENT_KIT_TASK_ID` and `AI_AGENT_KIT_ADAPTER` for the governed agent
   session.
3. Normalize each tool request into the universal action envelope.
4. Call `runtime gateway authorize` before execution.
5. Execute only an `allow` decision using the unchanged envelope and exact
   decision token.
6. Record execution and independent verification receipts.
7. Stop when task state, approval, commit, policy, expiry, adapter, or capability
   binding changes.

`ask` requires explicit human confirmation and a renewed binding. `deny` is not
overridable inside the governed session.
