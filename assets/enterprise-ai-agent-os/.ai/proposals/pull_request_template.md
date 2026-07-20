# Pull Request Template

> Complete every applicable section. Mark non-applicable sections as `N/A`.
> Never claim tests or commands were executed unless their results were actually observed.

---

# Summary

Briefly describe what changed.

---

# Business Outcome

What business problem does this PR solve?

Who benefits?

Expected user or operational impact.

---

# Root Cause / Previous Behavior

Describe the previous implementation or defect.

Explain why it occurred.

---

# Solution Overview

Describe the implemented solution.

Include important architectural or design decisions.

Explain why this approach was selected over alternatives.

---

# Scope

## Included

-

## Not Included

-

---

# Repository Impact

Affected:

- Modules
- Services
- APIs
- Database
- Events
- Shared libraries
- Configuration
- Infrastructure

Mention any backward compatibility considerations.

---

# Behavior Changes

Before:

-

After:

-

Potential user-visible changes:

-

---

# API / Contract Changes

Document any changes to:

- REST
- GraphQL
- gRPC
- Events
- Database contracts
- Message schemas

If none:

> No contract changes.

---

# Database Impact

Schema changes

Indexes

Migrations

Data migrations

Datafixes

Rollback compatibility

If none:

> No database changes.

---

# Security Impact

Authentication

Authorization

Input validation

Secrets

Encryption

PII

Compliance

Security risks introduced or mitigated.

If none:

> No security impact.

---

# Performance Impact

Expected effect on:

- latency
- throughput
- memory
- CPU
- database
- caching
- concurrency
- scalability

Include benchmarks if available.

---

# Observability

New:

- logs
- metrics
- tracing
- alerts
- dashboards

If none:

> Existing observability unchanged.

---

# Testing

## Automated

-

## Manual

-

## Regression

-

---

# Validation Evidence

Commands actually executed.

Include results.

Example

```text
./gradlew test
PASS

./gradlew integrationTest
PASS

./gradlew spotlessCheck
PASS
```

Never fabricate results.

---

# Deployment

Deployment order

Feature flags

Configuration changes

Environment variables

Infrastructure dependencies

Backward compatibility

---

# Rollback

Describe rollback procedure.

Include:

- application rollback
- database rollback
- feature flag strategy
- recovery steps

---

# Risks

Remaining technical risks.

Operational risks.

Known limitations.

Trade-offs accepted.

---

# Assumptions

List assumptions that were not verified.

Example

- Assumed downstream service supports the new optional field.
- Assumed production data volume matches staging estimates.

---

# Reviewer Checklist

- [ ] Business outcome is clear
- [ ] Root cause identified
- [ ] Design rationale is documented
- [ ] No breaking API changes (or documented)
- [ ] Database changes reviewed
- [ ] Security reviewed
- [ ] Performance considered
- [ ] Observability updated
- [ ] Tests are sufficient
- [ ] Rollback is documented
- [ ] Remaining risks are acceptable