# Workload patterns

Select only the matching modules. Combine them when a product crosses boundaries.

| Pattern | Model separately | Primary failure tests | Scale trigger |
| --- | --- | --- | --- |
| HTTP API | read/write mix, payload, dependency fan-out, retries | timeout, retry storm, overload, partial dependency | sustained saturation or SLO burn |
| Realtime | open connections, messages/connection, fan-out, reconnect rate | reconnect storm, slow consumer, regional disconnect | connection or fan-out ceiling |
| Event stream | producers, partitions, message size, lag, replay | poison message, consumer lag, duplicate delivery | lag or partition hot spot |
| Batch/data | input volume, deadline, shuffle, checkpoint | worker loss, partial rerun, late data | deadline miss or queue age |
| Media/CDN | object size, bitrate, cache ratio, origin egress | origin loss, cache purge, traffic spike | origin egress or cache miss cost |
| Search | index size, query mix, freshness, shard skew | stale index, hot shard, rebuild | query latency or shard size |
| AI/RAG | tokens, model latency, retrieval fan-out, cacheability | provider throttle, unsafe output, vector outage | token cost or latency SLO |
| Multi-tenant SaaS | tenant skew, isolation, quotas, noisy neighbors | hot tenant, quota bypass, migration | isolation or operational burden |
| Ledger/payment | idempotency, ordering, reconciliation, audit | duplicate, partial commit, delayed callback | correctness or compliance boundary |

Do not substitute active users for requests or open connections. Record the conversion assumption and validate it.
