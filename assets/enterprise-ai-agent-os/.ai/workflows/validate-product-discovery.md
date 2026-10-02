# Validate Product Discovery Workflow

1. Require current `DISCOVERY_DECISION` approval.
2. Rank assumptions by consequence and uncertainty; write falsifiable hypotheses with success and failure thresholds.
3. Select the cheapest ethical evidence-producing experiment. Define cohort, method, consent/privacy, duration, stop rule, bias, and decision criterion before execution.
4. Use prototypes only to answer named questions. Record usability task completion, failure/recovery paths, and participant limitations.
5. Record customer and experiment outputs as evidence receipts. Synthetic or generated observations remain explicitly synthetic.
6. Produce `discovery-validation` bound to current idea and research versions.
7. Run `product analyze --gate ALPHA_DECISION`; resolve blockers.
8. A named human chooses `CONTINUE`, `PIVOT`, or `STOP` on the exact Alpha hash. Pivot produces successor hypotheses and invalidates downstream approvals.
