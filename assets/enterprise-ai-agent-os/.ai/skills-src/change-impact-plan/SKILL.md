---
name: change-impact-plan
description: Produce a complete implementation impact assessment and obtain explicit approval before modifying existing systems. Required for changes affecting application code, infrastructure, configuration, APIs, databases, runtime behavior, architecture, or production operations.
---

# Change Impact Planning

## Purpose

Every modification to an existing system must begin with an impact assessment.

The objective is to:

- understand the current implementation
- identify the smallest safe change
- minimize regression risk
- define implementation boundaries
- document technical decisions
- obtain approval before implementation

This skill never modifies code.

---

# Repository Intelligence Gate (Required)

Before any analysis:

1. Execute the Repository Intelligence Gate.
2. Use the `repository-intelligence` skill.
3. Collect repository evidence from:

   - CodeGraph
   - CocoIndex
   - ADRs
   - RFCs
   - DESIGN.md
   - ARCHITECTURE.md
   - existing diagrams
   - specifications
   - linked work items
   - recent commits
   - release notes

Repository intelligence must guide file inspection rather than replacing it.

---

# Repository Discovery

Identify:

- application
- platform
- business domain
- framework
- language
- runtime
- build tooling
- deployment model
- repository structure

Automatically determine applicable quality profiles using

```
.ai/core/code-quality-intelligence.md
```

Load every required quality profile before continuing.

---

# Current System Analysis

Understand the implementation before proposing changes.

Trace the complete execution path including:

- entry points
- callers
- downstream consumers
- service boundaries
- repositories
- persistence
- database objects
- external APIs
- queues
- schedulers
- caches
- messaging
- authentication
- authorization
- feature flags
- configuration
- monitoring
- logging
- metrics
- alerting

Identify:

- lifecycle
- ownership
- dependencies
- runtime behavior
- failure behavior
- retry behavior
- timeout behavior

---

# Root Cause Verification

Never assume the problem.

Determine whether the issue originates from:

- implementation defect
- incorrect requirement
- missing validation
- architecture limitation
- configuration
- deployment
- infrastructure
- concurrency
- data inconsistency
- operational process

Document evidence supporting the conclusion.

Unknown causes must remain explicitly unknown.

---

# Change Boundary

Define precisely:

## In Scope

Exact:

- modules
- packages
- services
- classes
- methods
- SQL
- configuration
- APIs
- infrastructure
- documentation
- diagrams
- tests

expected to change.

---

## Out of Scope

Explicitly list areas that must remain unchanged.

Explain why.

---

## Protected Areas

Identify components requiring additional approval before modification.

Examples:

- authentication
- billing
- payment
- audit
- security
- shared framework
- public APIs
- database migrations
- infrastructure

---

# Dependency Impact

Analyze upstream impact:

- callers
- inherited behavior
- shared libraries

Analyze downstream impact:

- consumers
- integrations
- reports
- jobs
- analytics

Evaluate:

- API compatibility
- schema compatibility
- backward compatibility
- serialization
- events
- contracts

---

# Non-Functional Impact

Assess:

## Security

- authentication
- authorization
- secrets
- encryption
- PII
- PCI
- audit

---

## Performance

- latency
- throughput
- allocations
- database load
- cache impact
- network impact

---

## Concurrency

- thread safety
- synchronization
- transactions
- optimistic locking
- deadlocks

---

## Resource Lifecycle

- memory
- connections
- streams
- file handles
- thread pools

---

## Operations

- logging
- metrics
- tracing
- dashboards
- alerts
- runbooks

---

## Deployment

- rollout strategy
- feature flags
- migration order
- compatibility
- rollback

---

# Solution Proposal

Recommend the smallest safe implementation.

Describe:

- implementation strategy
- design decisions
- affected components
- expected behavior

Avoid unnecessary refactoring.

---

# Alternatives

Document reasonable alternatives.

For each:

- benefits
- drawbacks
- implementation cost
- operational risk

Explain why the preferred solution was selected.

---

# Test Strategy

Define required verification.

Include:

- unit tests
- integration tests
- contract tests
- regression tests
- performance tests
- security tests

Identify existing tests requiring updates.

---

# Documentation Impact

Identify documentation requiring updates.

Examples:

- README
- DESIGN.md
- ARCHITECTURE.md
- ADR
- diagrams
- API specifications
- runbooks

---

# Risk Assessment

Document:

- regression risks
- migration risks
- deployment risks
- operational risks
- rollback complexity

Assign severity:

- Low
- Medium
- High

Provide mitigation for each.

---

# Assumptions

Clearly separate:

Verified Facts

Assumptions

Unknowns

Never present assumptions as facts.

---

# Approval Gate

Stop after presenting the implementation plan.

Implementation must not begin until explicit developer approval is provided.

If implementation later expands beyond the approved scope:

- stop immediately
- produce a delta impact assessment
- obtain new approval before continuing

---

# Deliverables

Every impact assessment should contain:

1. Executive Summary
2. Repository Evidence
3. Root Cause
4. Current Flow
5. Change Boundary
6. Dependency Impact
7. Non-Functional Impact
8. Proposed Solution
9. Alternatives
10. Test Strategy
11. Documentation Changes
12. Risk Assessment
13. Assumptions & Unknowns
14. Approval Request

The implementation phase must never begin before this document is approved.