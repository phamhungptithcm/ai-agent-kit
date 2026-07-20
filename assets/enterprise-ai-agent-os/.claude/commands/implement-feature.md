---
description: Implement an approved feature using shared policy and focused validation.
argument-hint: "[feature request]"
---

Read `CLAUDE.md`, `.ai/guards/repository-intelligence-gate.yaml`, `.ai/workflows/repository-intelligence-workflow.md`, `.ai/workflows/implement-feature.md`, and applicable `.ai/rules/`.

Use the `repository-intelligence` skill first, then the `implement-feature` skill. For existing-system changes, verify approval evidence before editing protected files. Keep edits within approved scope, add focused tests or validation evidence, refresh CodeGraph/CocoIndex indexes after changes, update docs/specs/diagrams or provide no-change rationale, and report the full output contract from `.ai/core/output-contract.md`.
