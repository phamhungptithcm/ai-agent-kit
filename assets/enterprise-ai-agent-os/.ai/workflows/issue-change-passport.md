# Issue a Change Passport

1. Reach a fresh passing final review and `READY` Agent Proof.
2. Preview the Failure Lab manifest with `failure plan`.
3. After approval, run it with `failure run --apply --output ...`.
4. Fix failures, rerun checks, and repeat final review until current evidence passes.
5. Issue the passport with a repository-trusted key and explicit `--apply`.
6. Verify the saved passport independently. Accept only `VERIFIED`.
7. Report the passport hash, failure-case count, evidence limits, and any work not proven.

Issuing or verifying a passport never commits, pushes, deploys, publishes, or releases.
