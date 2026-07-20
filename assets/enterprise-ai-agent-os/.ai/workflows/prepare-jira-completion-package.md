# Prepare Jira Completion Package Workflow

Use this workflow for ticket completion, UAT handoff, customer review, or operational handoff.

Run the Repository Intelligence Gate before preparing the package. Use CodeGraph and CocoIndex evidence to tie the completion notes to changed paths, affected callers/dependencies, related specs/docs/tests, and no-change rationales.

Produce a package containing:

- Repository intelligence gate status.
- RCA or planned-change rationale.
- Solution and impacted components.
- Verified MR/PR link and actual state, or state that none exists.
- Acceptance criteria status with evidence.
- Validation commands/procedures and actual results.
- Documentation, specification, and diagram links or no-change rationale.
- Demo package paths or source outlines.
- Screenshot placeholder table.
- Deployment and rollback summary.
- Risks, blockers, follow-up work, and owner when known.

Do not claim external systems were updated unless the update was performed through an approved integration and verified.
