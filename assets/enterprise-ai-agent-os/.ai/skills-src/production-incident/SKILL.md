---
name: production-incident
description: Perform evidence-driven investigation of production incidents, service degradations, failed deployments, outages, and operational anomalies. Prioritize customer impact, rapid mitigation, accurate root cause analysis, and long-term prevention without fabricating evidence.
---

# Production Incident

## Purpose

Investigate production incidents using verified operational evidence.

Objectives:

- minimize customer impact
- restore service safely
- identify the first incorrect state
- determine verified root cause
- prevent recurrence

Never sacrifice correctness for speed.

---

# Repository Intelligence Gate (Required)

Before repository analysis:

1. Execute the Repository Intelligence Gate.
2. Use the `repository-intelligence` skill.
3. Collect repository evidence from:

- CodeGraph
- CocoIndex
- ADRs
- RFCs
- DESIGN.md
- ARCHITECTURE.md
- Runbooks
- Deployment guides
- Previous incidents
- Existing tests
- Rollback procedures

Use:

- CodeGraph to identify services, jobs, dependencies, APIs, consumers, data flows, and blast radius.
- CocoIndex to locate operational documentation, historical incidents, deployment notes, troubleshooting guidance, and architectural intent.

Repository evidence supports investigation but never replaces runtime evidence.

---

# Phase 1 — Incident Triage

Determine:

- incident severity
- customer impact
- affected services
- affected users
- business impact
- incident start time
- current status

Classify severity:

- Critical
- High
- Medium
- Low

Document why.

---

# Phase 2 — Timeline

Build an incident timeline.

Include:

- first alert
- customer reports
- deployments
- configuration changes
- infrastructure events
- operator actions
- mitigation attempts
- recovery events

Do not infer missing timestamps.

---

# Phase 3 — Evidence Collection

Collect verified evidence from:

- logs
- metrics
- traces
- dashboards
- alerts
- deployment history
- configuration history
- database state
- event streams
- release notes
- runtime observations

Separate:

- repository evidence
- runtime evidence
- operator observations
- assumptions

---

# Phase 4 — Execution Path

Reconstruct:

- request flow
- service interactions
- asynchronous processing
- jobs
- messaging
- persistence
- external integrations

Identify the exact execution path leading to failure.

---

# Phase 5 — First Incorrect State

Locate the earliest point where execution deviated from expected behavior.

Distinguish:

- Trigger
- Symptom
- First Incorrect State
- Root Cause
- Contributing Factors

Never stop at symptoms.

---

# Phase 6 — Root Cause Classification

Classify the incident.

Examples:

- Code defect
- Configuration
- Deployment
- Infrastructure
- Capacity
- Dependency
- Database
- Data quality
- Security
- Concurrency
- Resource exhaustion
- Third-party outage

Assign confidence:

- High
- Medium
- Low

Support conclusions with evidence.

---

# Phase 7 — Blast Radius

Determine impact on:

- services
- APIs
- jobs
- queues
- databases
- customers
- integrations
- downstream systems

Identify components verified as unaffected.

---

# Phase 8 — Mitigation

Describe:

- immediate mitigation
- temporary workaround
- operational actions
- rollback
- feature flags
- traffic management

Mitigation should minimize customer impact while preserving data integrity.

---

# Phase 9 — Permanent Fix

Recommend:

- code changes
- configuration changes
- infrastructure changes
- operational improvements
- monitoring improvements

Recommend the smallest safe permanent correction.

---

# Phase 10 — Validation

Verify:

- service recovery
- regression safety
- performance
- stability
- customer impact resolved

Do not report successful recovery without evidence.

---

# Phase 11 — Prevention

Recommend:

- regression tests
- monitoring
- alerting
- runbook improvements
- documentation updates
- architectural improvements
- operational automation

Focus on preventing recurrence.

---

# Security Rules

Never:

- invent evidence
- fabricate logs
- fabricate metrics
- fabricate traces
- fabricate customer impact
- access production systems without authorization
- expose secrets
- expose production data

Treat incidents involving:

- IAM
- secrets
- PII
- PCI
- financial systems
- production data

as High or Critical until proven otherwise.

---

# Documentation

Determine whether updates are required for:

- runbooks
- DESIGN.md
- ARCHITECTURE.md
- ADR
- incident documentation
- troubleshooting guides

If no updates are needed, explain why.

---

# Communication

Prepare an incident summary suitable for stakeholders including:

- customer impact
- current status
- mitigation
- estimated recovery (if known)
- remaining risks

Do not speculate about timelines.

---

# Deliverables

Every incident investigation should contain:

1. Executive Summary
2. Incident Severity
3. Timeline
4. Repository Evidence
5. Runtime Evidence
6. Execution Path
7. Trigger
8. Symptom
9. First Incorrect State
10. Root Cause
11. Contributing Factors
12. Blast Radius
13. Mitigation
14. Permanent Fix
15. Validation
16. Prevention
17. Documentation Updates
18. Remaining Risks

Separate:

- Verified Facts
- Runtime Evidence
- Assumptions
- Unknowns

Never report assumptions as confirmed incident causes.