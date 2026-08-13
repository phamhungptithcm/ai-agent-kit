# Generate Agent Proof

1. Build the canonical final task report and reuse its acceptance, Git,
   orchestration, required-gate, evidence, and final-review readiness result.
2. Resolve current policy overlays and memory health.
3. Remove source, prompts, secrets, raw logs, memory content, and direct personal
   identifiers from the proof model.
4. Derive readiness from current evidence; do not accept a caller-supplied
   readiness claim.
5. Generate JSON, standalone HTML, PR card, and trust badge locally.
6. Export OTLP only after explicit approval and only from the redacted model.
7. Rebuild the proof whenever task state, worktree, policy, checks, or review
   evidence changes.
