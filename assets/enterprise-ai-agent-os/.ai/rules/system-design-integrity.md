# System Design Integrity

- Normalize business language into measurable constraints before choosing technology.
- Preserve units, percentile, scope, time horizon, provenance, and confidence for every material number.
- Never conflate registered users, active users, open connections, in-flight requests, and RPS.
- Never invent benchmark throughput, cache hit rate, compression, cloud quota, price, discount, availability, compliance, or production proof.
- Prefer the smallest safe stage and define measured triggers for later decomposition, partitioning, orchestration, or multi-region operation.
- Treat latency, reliability, security, consistency, cost, complexity, and delivery time as explicit trade-offs.
- Pricing or lookup failure must degrade evidence, not block provider-neutral reasoning or become zero cost.
- Architecture work does not authorize provisioning, paid tests, production traffic, deployment, purchase, commit, push, or release.
