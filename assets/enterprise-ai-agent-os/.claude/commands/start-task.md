---
description: Analyze a request into an engineering task contract before editing.
argument-hint: "[task]"
---

Read `CLAUDE.md`, `.ai/guards/repository-intelligence-gate.yaml`, `.ai/workflows/repository-intelligence-workflow.md`, `.ai/core/required-workflow.md`, `.ai/core/risk-model.md`, and `.ai/workflows/start-task.md`.

Use the `repository-intelligence` skill first, then the `start-task` skill. Do not edit files.

Return repository intelligence gate status, indexed facts, source-code verified facts, understanding, current flow, impacted components, assumptions, risk classification, smallest safe change, expected files/classes/functions, documentation/specification/diagram impact, deployment/rollback impact, test strategy, execution plan, and approval request when needed.

For existing-system changes, stop after the change-impact plan and do not edit protected files until explicit approval evidence exists.
