---
name: code-quality-review
description: Perform a comprehensive, repository-aware engineering quality gate before implementation handoff, merge approval, or production release. Applies language, framework, platform, architecture, security, and operational quality profiles using repository evidence.
---

# Code Quality Review

## Purpose

Perform a complete engineering quality review before code is approved for merge or release.

This skill validates correctness, maintainability, security, compatibility, operational readiness, and long-term quality.

This skill never modifies production code.

---

# Repository Intelligence Gate (Required)

Before beginning review:

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
- CI/CD configuration
- Build configuration
- Dependency manifests
- Recent related commits
- Existing quality profiles

Repository evidence must guide all review decisions.

---

# Repository Discovery

Automatically detect:

## Languages

- Java
- Kotlin
- Go
- Python
- TypeScript
- JavaScript
- C#
- Rust
- Swift
- C++
- others

---

## Versions

Detect:

- language version
- framework version
- runtime
- SDK
- JDK
- compiler
- package manager

---

## Frameworks

Examples:

- Spring Boot
- Quarkus
- Micronaut
- React
- Angular
- Vue
- Flutter
- ASP.NET
- Express
- FastAPI

---

## Platform

Identify:

- Web
- Mobile
- Desktop
- Backend
- Infrastructure
- DevOps
- CLI
- Library
- Batch
- Serverless

---

# Quality Profile Selection

Always load:

```
.ai/quality-profiles/universal.yaml
```

Automatically load all matching profiles.

Examples:

- Java
- Go
- Python
- TypeScript
- API
- Database
- Security
- Concurrency
- Memory
- DevOps
- Infrastructure
- Web
- Mobile
- Desktop

Missing profiles should be reported as profile candidates.

---

# Review Scope

Determine all affected:

- modules
- packages
- services
- APIs
- SQL
- infrastructure
- configuration
- deployment
- tests
- documentation

Review both changed code and impacted dependencies.

---

# Architecture Review

Verify:

- layering
- ownership
- coupling
- cohesion
- dependency direction
- abstraction boundaries
- domain modeling
- shared library usage
- architectural consistency

---

# Code Quality Review

Review:

- readability
- naming
- duplication
- complexity
- cohesion
- maintainability
- encapsulation
- error handling
- defensive programming
- immutability where appropriate

---

# Language Review

Verify:

- language best practices
- framework best practices
- deprecated APIs
- version compatibility
- compiler warnings
- static analysis findings

---

# API Review

Review:

- compatibility
- versioning
- idempotency
- pagination
- validation
- authorization
- rate limiting
- error responses
- observability
- backward compatibility

---

# Database Review

Review:

- indexes
- query plans
- transactions
- isolation
- migrations
- locking
- retries
- ORM usage
- N+1 queries
- batching

---

# Performance Review

Evaluate:

- allocation growth
- blocking operations
- database round trips
- cache usage
- payload size
- algorithmic complexity
- serialization
- startup cost

---

# Concurrency Review

Inspect:

- locks
- executors
- goroutines
- async tasks
- promises
- thread safety
- races
- deadlocks
- cancellation
- scheduling

---

# Resource Lifecycle

Verify cleanup of:

- files
- sockets
- streams
- connections
- transactions
- listeners
- timers
- caches
- thread pools

---

# Security Review

Review:

- authentication
- authorization
- secrets
- encryption
- input validation
- output encoding
- sensitive logging
- PII
- PCI
- OWASP risks

---

# Observability Review

Verify:

- structured logging
- metrics
- tracing
- dashboards
- alerts
- correlation IDs
- operational diagnostics

---

# Deployment Review

Review:

- feature flags
- migrations
- rollback
- environment variables
- configuration
- release sequencing
- deployment safety

---

# Testing Review

Verify:

- unit tests
- integration tests
- contract tests
- regression tests
- performance tests
- security tests

Review test quality rather than only coverage.

---

# Documentation Review

Determine whether updates are required for:

- README
- DESIGN.md
- ARCHITECTURE.md
- ADR
- diagrams
- API specifications
- runbooks

---

# Evidence Requirements

Every review finding must include:

- affected component
- supporting repository evidence
- reason
- severity
- recommended action

Do not make speculative findings.

Unknown items must be explicitly marked Unknown.

---

# Severity

Each finding must be classified as:

- Critical
- High
- Medium
- Low
- Informational

Critical findings block approval.

---

# Review Status

Every review item must use exactly one status:

- PASSED
- FAILED
- NOT_APPLICABLE
- NOT_RUN

Statuses require supporting evidence.

---

# Release Readiness

Determine:

- Ready for Merge
- Ready for Release
- Requires Rework
- Requires Architecture Review

Provide justification.

---

# Deliverables

Complete:

```
.ai/templates/code-quality-review.md
```

The report must contain:

1. Executive Summary
2. Repository Evidence
3. Detected Technology Stack
4. Detected Platform
5. Selected Quality Profiles
6. Architecture Review
7. Code Review
8. Performance Review
9. Security Review
10. Database Review
11. Concurrency Review
12. Observability Review
13. Testing Review
14. Documentation Review
15. Deployment Review
16. Findings by Severity
17. Remaining Risks
18. Release Readiness

Separate:

- Verified Findings
- Assumptions
- Unknowns

Never present assumptions as verified facts.