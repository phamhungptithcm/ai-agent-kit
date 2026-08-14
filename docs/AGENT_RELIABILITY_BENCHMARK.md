# Agent Reliability Benchmark

The benchmark answers a bounded question: under the same recorded fixture,
host, model, settings, environment, and date, what changed when the governed
runtime was used?

```bash
ai-agent-kit benchmark reliability --fixture benchmark.json
```

## Required evidence

- Configuration and completed/failed/timed-out run counts.
- Requirement numerator and denominator.
- Regressions and escaped findings.
- Trace numerator and denominator.
- Recovery attempts and successes.
- Elapsed time, tokens, and cost when observable.
- Environment, model, host, settings, date, limitations, and manual assistance.

Unknown cost remains `null`. Timeouts stay in the denominator. The evaluator
does not reward prose volume or hidden reasoning.

Results apply only to the fixture and environment that produced them. Public
claims must include raw redacted results, reproduction commands, sample size,
variance, failures, and limitations. They must not claim universal product,
model, or agent superiority.
