---
name: trace-decisions-and-runs
description: Record recoverable engineering decisions and traceable agent runs. Use when work includes an approved plan, material decision, implementation phase, verification evidence, failed attempt, handoff, or final report that must remain explainable later.
---

# Trace Decisions and Runs

Preserve why the work happened, what changed, and what proved the result.

## Workflow

1. Create or reuse a stable decision ID and run ID.
2. Record the goal, scope, constraints, alternatives, assumptions, approver, and approval reference before protected work.
3. Append phase events instead of rewriting history.
4. Link code, checks, findings, plugin receipts, blockers, and failed attempts by stable references. Do not embed secrets or sensitive values.
5. Record corrections as new events. Never silently edit prior evidence.
6. Before final output, inspect the chain and ensure the report cites the latest verified state.

Use `ai-agent-kit decision ...` and `ai-agent-kit run ...`. Keep local runtime state under `.ai-agent-kit/`; export a redacted `.aakrun` bundle only when portable evidence is needed.

## Stop Conditions

- Stop if approval evidence is missing for protected work.
- Stop if an append would break the previous hash, reuse an event ID, or expose sensitive data.
- Mark unknown evidence as unavailable; never invent a successful check.

## Output

Return decision ID, run ID, current phase, evidence references, unresolved blockers, and the next safe action.
