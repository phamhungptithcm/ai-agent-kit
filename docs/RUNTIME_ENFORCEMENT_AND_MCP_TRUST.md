# Runtime Enforcement And MCP Trust

Version 0.6 moves governance from decision recording to the actual execution
boundary. It adds one action gateway shared by Claude Code, Codex, the CLI, and
the MCP broker.

## Universal Action Gateway

Every protected operation is normalized into an action envelope containing the
task, adapter, tool, target path, command, network domain, risk, parameters
hash, approval hash, repository commit, policy revision, and capability
identity. Authorization returns `allow`, `ask`, or `deny` with a stable reason
code and a decision token bound to that exact envelope.

Execution requires the matching token and re-evaluates current task and policy
state. Changes to approval, commit, policy revision, capability, expiry,
budget, adapter, or action invalidate the prior authorization. The ledger
records separate decision, execution, and verification receipts. Receipts hash
sensitive action fields and never store raw command output, prompts, source,
credentials, or secrets.

## Zero-Trust MCP Broker

MCP trust defaults to deny. A server is trusted only when its reviewed registry
entry matches its exact executable, arguments, package/version metadata, digest,
transport, and auto-start setting.

Each request is constrained by:

- allowed tools;
- filesystem roots;
- network domains with private and loopback SSRF protection;
- maximum timeout;
- persistent per-server, per-tool rate limits;
- capability and action-gateway policy.

Credentials are requested only after authorization, passed directly to the
executor, and excluded from envelopes, logs, receipts, evidence, telemetry, and
returned results. Registry drift or expired review denies startup. Auto-start
requires explicit trust. Permission expansion returns an approval boundary
instead of silently broadening access.

## Adapter And Bootstrap Behavior

Claude Code and Codex call the same gateway hook. The hook activates only when
`AI_AGENT_KIT_TASK_ID` identifies a governed task. Without governed task
context, existing interactive bootstrap and repository workflows continue
unchanged. When governed mode is active, a missing runtime or malformed action
fails closed.

CodeGraph and CocoIndex remain optional repository-intelligence accelerators.
Missing, stale, unhealthy, or un-installable indexes produce explicit
`DEGRADED` evidence, not a work blocker. Approval, secret, critical-operation,
and execution-boundary controls remain fail closed.

## Local Verification

Before a release candidate is committed or published:

```bash
python3 -B assets/enterprise-ai-agent-os/.ai/scripts/sync_agent_assets.py --check
npm run check
npm pack --dry-run
```

Release, Git, production, infrastructure, database, messaging, and secret
mutations still require their existing explicit human boundaries.
