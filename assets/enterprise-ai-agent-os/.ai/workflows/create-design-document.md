# Create Design Document Workflow

Use this workflow for RFCs, architecture proposals, cross-module changes, high-risk changes, and unclear implementation paths.

Run the Repository Intelligence Gate before drafting. Use CodeGraph to identify architecture, modules, entry points, dependencies, and impacted symbols. Use CocoIndex to retrieve related requirements, ADRs, specs, runbooks, previous designs, and similar implementations. Verify important claims against source paths.

Include:

- Repository intelligence gate status
- Indexed facts
- Source-code verified facts
- Context
- Goals
- Non-goals
- Current state
- Options considered
- Decision
- Architecture
- Data model
- APIs and contracts
- Security and privacy
- Performance and scalability
- Observability
- Rollout
- Rollback
- Testing
- Risks
- Unresolved questions

Mark unknowns with `TODO(owner): ...` and avoid inventing project facts.
