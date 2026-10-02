# Product Approval Integrity

- Only a named human with stated authority may approve a product baseline.
- Bind approval to exact artifact IDs, versions, hashes, scope, constraints, timestamp, and rationale.
- Record `APPROVED`, `CHANGES_REQUESTED`, or `REJECTED`; silence, chat sentiment, issue closure, or agent recommendation is not approval.
- An approval cannot cover an unknown future version.
- Material scope, requirement, risk, cost, schedule, architecture, data, security, or operating-model changes invalidate affected approval and require reapproval.
- Never backdate, infer, or fabricate approval evidence.
