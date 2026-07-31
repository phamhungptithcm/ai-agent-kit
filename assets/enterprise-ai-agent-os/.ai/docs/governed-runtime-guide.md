# Governed Runtime Guide

Use the package CLI from the repository root:

```bash
ai-agent-kit runtime task create --id TASK-123 --goal 'Ship the approved change' --acceptance 'Tests pass' --approval-hash SHA256 --risk medium --tool read --tool edit --path 'src/**'
ai-agent-kit runtime task transition --id TASK-123 --to ANALYZE
ai-agent-kit runtime context add --id TASK-123 --kind fact --statement 'Call path inspected' --source codegraph://call-path
ai-agent-kit runtime plan revise --id TASK-123 --trigger 'Repository evidence collected' --step 'Implement approved scope' --step 'Verify behavior'
ai-agent-kit runtime task transition --id TASK-123 --to PLAN_READY --evidence repository_intelligence=READY
ai-agent-kit runtime policy evaluate --id TASK-123 --tool edit --path src/example.ts
ai-agent-kit runtime evidence verify --id TASK-123
ai-agent-kit runtime evidence export --id TASK-123
ai-agent-kit runtime eval score --id TASK-123
ai-agent-kit runtime memory propose --id TASK-123 --title 'Verified convention' --content '...' --source TASK-123 --confidence 0.9
ai-agent-kit runtime memory approve --id TASK-123 --memory-id HASH --approver 'Repository Owner'
ai-agent-kit runtime memory query --query convention
```

Runtime state is local under `.ai-agent-kit/runtime/`. Receipts and telemetry are privacy-minimized JSONL. The gateway evaluates and records decisions; it does not autonomously run production, infrastructure, database, release, Git, or messaging mutations.

Before completion, record acceptance, quality, and provider usage evidence, then
render the final task report:

```bash
ai-agent-kit runtime criterion record --id TASK-123 --criterion 1 --status verified --source test://acceptance
ai-agent-kit runtime check record --id TASK-123 --gate tests --status passed --source command://test --exit-code 0
ai-agent-kit runtime usage record --id TASK-123 --provider openai --model gpt-5.6-terra --usage-source provider_response --input-tokens 1000 --cached-input-tokens 500 --output-tokens 100
ai-agent-kit runtime task report --id TASK-123 --format text
```

Token usage and cost reporting are fail-open. Production readiness is
fail-closed and requires current evidence for every configured required gate.

Treat `ask` as a stop for human confirmation and `deny` as final unless policy or capability is changed through a new reviewed approval.

Facts require sources. Assumptions remain separate. Replanning requires an explicit trigger and produces a hash-linked revision. Memory is append-only and proposed entries remain invisible to queries until a human approver promotes them.
