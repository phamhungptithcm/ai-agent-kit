# Evaluation Starter Pack

This starter pack measures consistency. It does not run live LLM calls in CI or require model-provider credentials.

Use `scorecard.yaml` to score agent outputs and `golden-cases.yaml` to maintain representative scenarios. When an agent produces a poor result, add or refine a golden case so future prompts, skills, and rules can be evaluated.

`behavioral-cases.json` defines deterministic safety expectations for recorded agent responses. Validate the case schema with:

```bash
python .ai/scripts/evaluate_agent_behavior.py
```

To score responses captured from any model or adapter, store one text file per case using each case's `response_file`, then run:

```bash
python .ai/scripts/evaluate_agent_behavior.py --responses-dir path/to/responses
```

Keep live model execution outside default CI so evaluation remains credential-free, reproducible, and provider-neutral. A scheduled or manually approved external harness may populate response files for multi-model comparison.

## Replayable end-to-end evaluations

Use `e2e/eval-case.schema.json` for versioned task, trajectory, outcome,
evidence, latency, cost, and action-budget fixtures. The same normalized case
can contain recorded Claude Code and Codex runs. Default CI replays these
artifacts offline and fails approval, scope, denied-action, missing-evidence,
outcome, or budget violations even when final tests pass.

Use `e2e/review-quality.schema.json` for labeled review findings. Report every
metric with its numerator, denominator, sample size, and confidence interval
where applicable. Preserve reviewer disagreement and penalize false positives
and duplicates so comment volume cannot inflate quality.

Use `e2e/final-implementation-review.schema.json` with
`.ai/templates/final-implementation-review.json` to record the mandatory final
review. A passing review requires evidence for every applicable dimension and
cannot contain unresolved critical or high findings.
