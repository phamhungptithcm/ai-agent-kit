# Definition Of Done

Completed AI-assisted engineering work must be able to answer:

- What business requirement was implemented or analyzed?
- What changed from the user, operator, or system perspective?
- Which components changed and why?
- What tests were added or updated?
- Which commands ran, and what were the actual results?
- What is the status and evidence for each required quality gate?
- Did authorization, PII, secrets, validation, or data retention behavior change?
- Did queries, network calls, memory usage, concurrency, or transaction boundaries change?
- What logs, metrics, traces, or other evidence can verify behavior?
- Does deployment require configuration, migration, sequencing, or communication?
- How can the change be rolled back?
- Are there approved-safe memory candidates, or is the answer explicitly `None`?
- What remains uncertain or unverified?
