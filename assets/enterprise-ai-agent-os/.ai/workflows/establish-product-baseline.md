# Establish Product Baseline Workflow

1. Freeze the candidate BRD or specification version and compute its content hash.
2. Validate schema, internal consistency, source links, requirement quality, traceability, testability, and critical unknowns.
3. Create a review package with scope, non-goals, trade-offs, risks, estimate range, evidence limits, and changes from the previous version.
4. Collect reviewer comments as immutable findings and revise through a successor version.
5. Ask a named human with appropriate authority for one explicit decision.
6. Record the decision with artifact hash, approved scope, constraints, rationale, and timestamp.
7. Advance only when the decision is `APPROVED`; otherwise preserve state and route requested changes.

BRD approval authorizes specification work only. Specification approval authorizes delivery planning only. Neither authorizes implementation, deployment, purchase, commit, push, or release.
