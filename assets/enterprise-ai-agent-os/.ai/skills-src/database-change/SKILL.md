---
name: database-change
description: Analyze, review, and plan safe database changes for schema evolution, SQL, migrations, datafixes, performance optimization, indexing, and operational data management. Prioritize data integrity, availability, backward compatibility, and zero-downtime deployment.
---

# Database Change

## Purpose

Safely evolve production databases while preserving:

- data integrity
- availability
- backward compatibility
- operational stability
- rollback capability

This skill never executes production database changes autonomously.

---

# Repository Intelligence Gate (Required)

Before analysis:

1. Execute the Repository Intelligence Gate.
2. Use the `repository-intelligence` skill.
3. Collect evidence from:

- CodeGraph
- CocoIndex
- Schema documentation
- Migration history
- ADRs
- RFCs
- Runbooks
- Existing datafix procedures
- Database deployment pipelines
- Previous incidents

Use:

- CodeGraph to discover data-access paths, repositories, ORMs, services, jobs, reports, and downstream consumers.
- CocoIndex to understand schema intent, migration strategy, operational guidance, and historical context.

---

# Database Discovery

Automatically identify:

- database vendor
- version
- ORM
- migration framework
- deployment tooling
- replication model
- partitioning
- sharding
- HA architecture

Examples:

- Oracle
- PostgreSQL
- MySQL
- SQL Server
- Flyway
- Liquibase
- Hibernate
- JPA
- MyBatis

---

# Quality Profiles

Always load:

```
.ai/quality-profiles/database.yaml
```

Additionally load:

- detected language profile
- API profile
- concurrency profile
- infrastructure profile

when applicable.

---

# Dependency Analysis

Identify all affected:

- tables
- views
- indexes
- partitions
- materialized views
- procedures
- triggers
- sequences
- functions
- jobs
- reports
- APIs
- services
- repositories
- ORM entities
- downstream consumers

Determine the blast radius before proposing changes.

---

# Data Classification

Classify affected data:

- Public
- Internal
- Confidential
- PII
- PCI
- Financial
- Operational

Determine business criticality:

- Low
- Medium
- High
- Mission Critical

---

# Schema Review

Review:

- normalization
- keys
- constraints
- foreign keys
- indexes
- partitioning
- naming
- nullable columns
- generated columns

Verify schema consistency.

---

# Migration Strategy

Determine:

- additive
- destructive
- online
- offline
- phased
- blue-green
- expand-contract

Prefer additive and backward-compatible migrations.

Never combine:

- schema migration
- destructive cleanup
- data migration

into one deployment unless explicitly approved.

---

# Query Review

Review:

- execution plans
- indexes
- joins
- filtering
- pagination
- batching
- projections
- sorting
- aggregation

Rules:

- Never use `SELECT *` in production.
- Always use bounded queries.
- Minimize round trips.
- Prefer set-based operations.

---

# Transaction Review

Evaluate:

- isolation level
- transaction scope
- locking
- deadlocks
- optimistic locking
- retries
- idempotency
- consistency

Large transactions require explicit justification.

---

# Persistence Review

Review ORM behavior.

Examples:

- repository.save()
- EntityManager
- Session
- MyBatis
- JDBC

Avoid:

- save() inside large loops
- N+1 updates
- unnecessary flushes

Prefer:

- batching
- bulk operations
- COPY
- MERGE
- UPSERT
- set-based SQL

If loop persistence is unavoidable, document:

- batch size
- flush interval
- clear interval
- retry strategy
- lock duration

---

# Performance Review

Evaluate:

- query complexity
- execution plan
- table scans
- index usage
- partition pruning
- cache behavior
- cardinality
- statistics
- memory usage

Large-table changes require additional review.

---

# Availability Review

Determine impact on:

- replication
- failover
- backups
- restores
- maintenance windows
- online traffic

Recommend online migration whenever practical.

---

# Data Validation

Define validation queries.

Include:

- expected row counts
- integrity checks
- orphan detection
- duplicate detection
- checksum validation
- business validation

Validation should confirm both:

- correctness
- completeness

---

# Rollback Analysis

Classify rollback:

- Fully Reversible
- Partially Reversible
- Operational Rollback Only
- Irreversible

Provide rollback steps.

If rollback is impossible, document why.

---

# Operational Review

Review:

- deployment order
- migration sequence
- feature flags
- application compatibility
- monitoring
- alerts
- runbooks

Coordinate with:

- Jenkins
- GitLab
- Flyway
- Liquibase
- existing database deployment pipelines

---

# Production Datafix

Never execute production datafixes automatically.

Require explicit approval before:

- DELETE
- UPDATE
- TRUNCATE
- MERGE
- destructive migrations
- irreversible operations

Generate reviewable SQL only.

---

# Deliverables

Every database review should include:

1. Executive Summary
2. Repository Evidence
3. Database Discovery
4. Dependency Analysis
5. Data Classification
6. Migration Strategy
7. Query Review
8. Transaction Review
9. Persistence Review
10. Performance Review
11. Availability Review
12. Validation Queries
13. Rollback Strategy
14. Deployment Sequence
15. Remaining Risks
16. Assumptions
17. Required Approvals

Separate:

- Verified Facts
- Assumptions
- Unknowns

Never execute production-impacting changes without explicit approval.