---
name: observability-review
description: Review logging, metrics, tracing, alerts, dashboards, audit events, and runbook coverage for changed or production-significant behavior.
---

# Observability Review

Use this skill when behavior changes need production visibility or when incidents reveal blind spots.

## Review Checklist

- Logs are structured, actionable, and free of secrets/PII.
- Metrics cover request count, latency, errors, saturation, queue depth, retries, timeouts, and domain-critical outcomes where relevant.
- Trace/correlation identifiers propagate across service and async boundaries.
- Alerts are tied to user or business impact, not only noisy internals.
- Dashboards and runbooks explain how to detect, triage, mitigate, and verify recovery.
- Audit events exist for security-sensitive or regulated actions.
- New cardinality, cost, retention, and sampling impact is acceptable.

## Output

Report observability coverage, missing signals, alert/runbook impact, operational risk, and required follow-up. Include exact files/config/docs that should change or a no-change rationale.
