---
name: implement-feature
description: Implement an approved feature using the smallest safe change while preserving system integrity, architectural consistency, and production readiness. Applies to existing systems and new capabilities after design and impact approval.
---

# Implement Feature

## Purpose

Implement approved functionality safely and predictably.

The objective is to:

- satisfy acceptance criteria
- minimize regression risk
- preserve existing behavior
- maintain architectural consistency
- ensure production readiness

Implementation must remain within the approved scope.

---

# Repository Intelligence Gate (Required)

Before implementation:

1. Execute the Repository Intelligence Gate.
2. Use the `repository-intelligence` skill.
3. Collect repository evidence from:

- CodeGraph
- CocoIndex
- ADRs
- RFCs
- DESIGN.md
- ARCHITECTURE.md
- Existing diagrams
- Existing tests
- Previous implementations
- Quality reports

Use:

- CodeGraph to discover impacted modules, symbols, callers, consumers, APIs, persistence, and dependency relationships.
- CocoIndex to identify similar implementations, documentation, specifications, architectural guidance, and project conventions.

Repository evidence guides implementation but never replaces source-code verification.

---

# Phase 1 — Verify Scope

Confirm:

- business capability
- acceptance criteria
- owning module
- approved implementation plan
- implementation boundary

Do not expand scope.

If implementation exceeds the approved boundary, stop and generate a delta impact assessment.

When Agent Department orchestration is available, use
`orchestrate-agent-department` after scope approval. Let its context-aware plan
select discovery and assurance specialists. Only its implementation assignment
may edit files; this skill must not create a second writer.

---

# Phase 2 — Repository Analysis

Determine:

- affected modules
- services
- APIs
- repositories
- persistence
- infrastructure
- configuration
- documentation
- tests

Identify upstream callers and downstream consumers.

Assess the implementation blast radius before editing code.

---

# Phase 3 — Quality Preparation

Execute:

```
code-quality-review
```

Automatically detect:

- language
- runtime
- framework
- platform
- application type
- quality profiles

Apply every relevant quality profile before implementation.

---

# Phase 4 — Implementation

Implement the smallest safe solution.

Rules:

- preserve existing behavior unless explicitly changed
- keep changes local
- avoid unnecessary abstraction
- avoid unrelated refactoring
- maintain architectural consistency

---

# Implementation Requirements

Verify:

## API

- compatibility
- validation
- stable error contracts
- idempotency
- authorization

---

## Data

Protect:

- transactions
- ownership
- migrations
- consistency
- backward compatibility

---

## Security

Protect:

- authentication
- authorization
- secrets
- PII
- PCI
- audit

---

## Performance

Review:

- algorithms
- batching
- allocations
- query efficiency
- cache behavior

---

## Concurrency

Review:

- thread safety
- async behavior
- locking
- retries
- deadlocks

---

## Resource Lifecycle

Review:

- memory
- streams
- connections
- listeners
- timers
- thread pools

---

## Observability

Add production diagnostics where appropriate:

- structured logging
- metrics
- tracing
- correlation IDs
- alerts

---

# Database Rules

Never:

- use `repository.save()` inside large loops

Prefer:

- batching
- bulk persistence
- set-based SQL

Exceptions require documented approval including:

- transaction size
- flush interval
- locking impact
- retry behavior
- idempotency

---

# Phase 5 — Validation

Verify:

- acceptance criteria
- regression safety
- compatibility
- performance expectations
- quality profiles
- repository validation commands

Run repository-defined commands whenever possible.

Do not report successful validation unless verified.

---

# Phase 6 — Documentation

Determine whether updates are required for:

- README
- DESIGN.md
- ARCHITECTURE.md
- ADR
- diagrams
- API specifications
- runbooks

If no updates are required, explain why.

---

# Repository Synchronization

Refresh CodeGraph and CocoIndex indexes **only if** implementation changes repository symbols, architecture, documentation, APIs, or relationships used by repository intelligence.

---

# Delivery Readiness

Verify:

- quality gates complete
- code review ready
- documentation synchronized
- deployment notes prepared
- rollback documented

Determine:

- Ready for Review
- Ready for Merge
- Requires Additional Review

---

# Completion Report

Provide:

## Scope

- approved plan
- implementation boundary
- scope compliance

---

## Implementation

- design rationale
- files changed
- behavior changes

---

## Validation

- tests executed
- commands executed
- results
- remaining gaps

---

## Quality

Include:

- detected technology stack
- platform
- selected quality profiles
- quality gate results
- code-quality review evidence

---

## Operational Impact

Summarize:

- security
- data
- performance
- concurrency
- memory
- observability

---

## Documentation

Report:

- updated documents
- updated diagrams
- updated specifications

or provide explicit no-change rationale.

---

## Delivery

Include:

- PR/MR evidence
- Jira/work-item evidence
- deployment notes
- rollback strategy

Never claim external systems were updated unless verified.

---

## Memory

Evaluate:

```
.ai/core/memory-policy.md
```

Report:

- memory candidates

or

```
None
```

Never store memory unless governance permits.

---

## Remaining Risks

Separate:

- Verified Facts
- Assumptions
- Unknowns

Document residual technical and operational risks.
