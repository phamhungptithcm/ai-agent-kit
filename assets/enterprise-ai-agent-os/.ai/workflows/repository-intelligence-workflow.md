# Repository Intelligence Workflow

Use this workflow before brainstorming, planning, impact analysis, code review, QA analysis, documentation analysis, or implementation.

1. Run `.ai/scripts/check-repository-intelligence.py`.
2. If indexes are stale, run `.ai/scripts/refresh-repository-index.py` explicitly, then re-run the gate.
3. If the gate is `BLOCKED`, stop all application work and troubleshoot only CodeGraph/CocoIndex setup.
4. Query CodeGraph first for structural location, entry points, symbols, callers, callees, dependency paths, and impact areas.
5. Query CocoIndex second for semantic matches, requirements, specs, docs, runbooks, ADRs, tests, contracts, and similar implementations.
6. Open only the highest-value paths and exact sections returned by those indexes.
7. Verify critical conclusions against the actual source code.
8. Record a shared repository intelligence brief using `.ai/templates/repository-intelligence-brief.md`.
9. Reuse the brief across specialist agents; subagents query indexes only for role-specific gaps.
10. During brainstorming, distinguish indexed facts, source-code verified facts, assumptions, unknowns, alternatives, smallest safe solution, long-term solution, regression risks, and recommended direction.
11. Before implementation, identify exact files/classes/functions, direct and indirect callers, API/event/database/config dependencies, tests, and preserved behavior.
12. After implementation, compare actual diff to approved scope, query CodeGraph for changed-symbol impact, refresh both indexes, and re-run the gate.

Do not silently replace CodeGraph with CocoIndex or CocoIndex with CodeGraph. CodeGraph is the structural evidence source; CocoIndex is the semantic and documentation evidence source. Source code remains authoritative for critical behavior.
