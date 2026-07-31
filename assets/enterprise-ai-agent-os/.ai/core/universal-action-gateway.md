# Universal Action Gateway

Governed mode routes every supported action through one normalized action
envelope and one decision engine before execution.

## Required bindings

- task state and task ID;
- capability hash and action budget;
- approval hash;
- repository commit;
- policy revision;
- adapter identity;
- tool, path, network domain, command, and risk.

An `allow` decision is not an execution credential by itself. Execution must
present the unchanged envelope and the exact decision token. Changed
envelopes, expired capabilities, changed commits, changed policy, changed
approval, and adapter mismatch fail closed.

Receipts are emitted for allow, ask, deny, execution result, and verification
result. Denied action receipts contain hashes and bounded metadata, never raw
commands, paths, domains, parameters, or secrets.

When `AI_AGENT_KIT_TASK_ID` is set, adapter PreToolUse hooks activate governed
mode. Missing gateway runtime or invalid task context denies the action. Without
that explicit task binding, existing bootstrap and approval behavior remains
unchanged.
