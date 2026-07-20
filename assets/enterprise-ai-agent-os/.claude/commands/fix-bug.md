---
description: Diagnose and fix a bug by finding the first incorrect state.
argument-hint: "[issue]"
---

Read `CLAUDE.md`, `.ai/guards/repository-intelligence-gate.yaml`, `.ai/workflows/repository-intelligence-workflow.md`, `.ai/workflows/fix-bug.md`, and applicable `.ai/rules/`.

Use the `repository-intelligence` skill first, then the `fix-bug` skill. For existing-system changes, stop after the change-impact plan until explicit approval evidence exists. Do not hide symptoms with generic retries, unexplained null checks, broad catches, or unrelated refactoring.
