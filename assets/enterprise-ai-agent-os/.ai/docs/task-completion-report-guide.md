# Task Completion Report Guide

Create the governed task with explicit acceptance criteria, then record progress
by criterion number:

```bash
ai-agent-kit runtime criterion record --id TASK-123 --criterion 1 --status verified --source test://feature
ai-agent-kit runtime criterion record --id TASK-123 --criterion 2 --status pending --summary "Production E2E remains"
```

Record privacy-minimized quality evidence. Evidence references are hashed and
raw command output is not stored:

```bash
ai-agent-kit runtime check record --id TASK-123 --gate tests --status passed --source command://npm-test --exit-code 0 --summary "128 tests passed"
ai-agent-kit runtime check record --id TASK-123 --gate security --status not_run --summary "Security scan was outside the current environment"
```

Record OpenAI usage. OpenAI input includes cached input, so the runtime derives
uncached input:

```bash
ai-agent-kit runtime usage record --id TASK-123 --adapter codex --provider openai --model gpt-5.6-terra --usage-source provider_response --event-id RESPONSE-ID --input-tokens 153200 --cached-input-tokens 110000 --output-tokens 31120 --reasoning-tokens 12400
```

Record Anthropic usage. Anthropic cache reads and writes are separate input
buckets:

```bash
ai-agent-kit runtime usage record --id TASK-123 --adapter claude --provider anthropic --model claude-sonnet-4-6 --usage-source provider_response --input-tokens 75 --cache-read-input-tokens 200000 --output-tokens 175
```

Render the final report:

```bash
ai-agent-kit runtime task report --id TASK-123 --format text
ai-agent-kit runtime task report --id TASK-123 --format compact
ai-agent-kit runtime task report --id TASK-123 --format json
```

The built-in pricing registry is exact-match and versioned. Unknown models,
unsupported service tiers, and unsupported inference geographies retain token
totals but make cost unavailable. A repository can supply reviewed local rates:

```bash
ai-agent-kit runtime task report --id TASK-123 --registry .ai-agent-kit/pricing.local.json
```

Copy `.ai/templates/model-pricing-registry.json` to an ignored local path and
replace the example entry. Do not commit confidential negotiated pricing.
