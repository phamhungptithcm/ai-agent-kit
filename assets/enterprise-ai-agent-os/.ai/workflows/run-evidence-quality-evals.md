# Run Evidence Quality Evaluations

1. Run the Repository Intelligence Gate and record READY or DEGRADED.
2. Select versioned fixtures matching the changed behavior, adapter, model family, and policy revision.
3. Replay recorded Claude Code and Codex trajectories offline. Do not require production credentials or provider calls in default CI.
4. Fail approval, scope, denied-action, missing-evidence, outcome, cost, latency, and action-budget violations independently of final test status.
5. Compare the candidate against the named baseline with material thresholds and 95% confidence intervals where sample size supports them.
6. Generate the evidence-native PR package and fail when approval-to-diff scope does not match.
7. Score labeled review fixtures using explicit numerators, denominators, sample size, disagreement, and noise penalties.
8. Keep raw repository content and logs outside portable baselines. Store aggregate results, hashes, and bounded references.
9. Report PASSED, REGRESSION, FAILED, or NOT_MEASURED without converting missing evidence into success.
