# Agent Department Proof Loop

Agent Department is useful when it makes coordination inspectable, not merely
when it starts more agents. Its proof loop has four separate layers:

1. The team contract is authoritative state: roles, dependencies, budgets,
   claims, approval, lifecycle, and evidence bindings.
2. The content-minimized event journal is an append-only audit chain. Each event
   binds its predecessor. Recovery reconciles journal gaps without pretending
   that the local filesystem is a distributed queue.
3. The timeline renders the journal as JSON, text, and standalone HTML for
   review, demos, and incident reconstruction.
4. Conformance and benchmark artifacts control what can be claimed publicly.

## Fast proof

```bash
ai-agent-kit team demo
```

The demo uses a temporary repository and no external model. It exercises the
actual planner, parallel discovery wave, approval block, recorded approval,
single writer, assurance rejection, fix loop, downstream rerun, and fresh
independent review. Outputs are marked `synthetic` and
`non_production_evidence`.

## Live host proof

```bash
ai-agent-kit team conformance-template --adapter codex > conformance.json
# Populate from the actual host lifecycle.
ai-agent-kit team conformance --file conformance.json
```

Passing evidence must bind the task and run, host version, observed lifecycle,
structured results, file evidence hashes, write-assignment ids, approval before
write dispatch, and current journal head. Results must follow a matching host
dispatch in timestamp order. A declared adapter capability is not the same as
observed live conformance.

## Comparative proof

```bash
ai-agent-kit team benchmark-template > benchmark.json
# Record all three modes under fixed conditions.
ai-agent-kit team benchmark --fixture benchmark.json
```

The three modes are single agent, ungoverned multi-agent, and Agent Department.
The evaluator reports completion and evidence ratios with explicit numerators,
denominators, and sample sizes; it also reports escaped defects, scope
violations, duplicate scans, tokens, duration, and review cycles. It refuses a
measured conclusion when the task, repository commit, host, or model differs or
required values are missing. Each case requires the declared equal repetition
count for all three modes, with at least three repetitions per mode.

This separation keeps the marketing story strong and defensible: show the
control plane immediately, verify providers independently, and publish
performance claims only after comparable measurements exist.
