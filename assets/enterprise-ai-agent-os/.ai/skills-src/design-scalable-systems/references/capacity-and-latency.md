# Capacity and latency

Use explicit units and ranges. Keep average, peak, burst, and tested safe capacity separate.

## Core arithmetic

- In-flight requests approximate `arrival_rate_per_second × average_service_time_seconds`.
- Monthly requests approximate `average_rps × 2,592,000` for a 30-day month.
- Network bytes per second approximate `RPS × bytes per request or response`.
- Daily write growth approximates `writes_per_second × stored_bytes_per_write × 86,400` before replication, indexes, backups, and retention.
- Required replicas need measured safe throughput per replica. Without a benchmark, return `UNAVAILABLE` and provide a benchmark plan.

Latency targets require scope, percentile, success criteria, and measurement window. Budget end-to-end latency across edge, gateway, application, dependencies, database, queueing, and network. Never treat average latency as tail latency.

## Capacity headroom

Model normal peak, dependency slowdown, zone loss, autoscaling delay, and burst separately. Prefer admission control, bounded queues, backpressure, load shedding, and graceful degradation to unlimited buffering. Identify the first expected bottleneck and the signal that triggers the next architecture stage.

## Evidence

Label throughput as benchmarked, observed, vendor quota, calculated, or assumed. Vendor quota is not achieved throughput. A load-test plan must state workload mix, payload, data cardinality, warm-up, duration, concurrency model, failure injection, pass criteria, cost ceiling, and safe target environment.
