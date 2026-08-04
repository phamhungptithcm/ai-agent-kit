# Reliability and data

Define availability, correctness, durability, freshness, RTO, and RPO independently. Use an error budget rather than promising 100 percent availability.

Review:

- failure domains: process, host, zone, region, provider, identity, network, and human operation;
- timeouts, retry budgets, idempotency, circuit breaking, bulkheads, queue bounds, load shedding, and dependency isolation;
- source of truth, ownership, partition key, hot-key behavior, consistency, ordering, deduplication, and reconciliation;
- backup integrity, restore time, disaster recovery, failover authority, and rollback limitations;
- observability, SLI computation, alert ownership, runbooks, capacity forecast, and operational load.

Prefer staged evolution. Do not introduce microservices, Kafka, Kubernetes, multi-region writes, or custom databases solely because the long-term traffic number is large. State the measured trigger for each step.
