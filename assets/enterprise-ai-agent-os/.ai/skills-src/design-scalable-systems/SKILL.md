---
name: design-scalable-systems
description: Turn product and non-functional requirements into measurable, affordable, evolvable system architecture. Use automatically for system design, high-level design, architecture options, scalability, RPS or throughput, concurrent users or connections, latency percentiles, availability, disaster recovery, security level, compliance, data consistency, cloud selection, capacity planning, infrastructure cost, or build-versus-buy decisions.
---

# Design Scalable Systems

Translate natural-language constraints into an evidence-backed design. Prefer the smallest architecture that meets the next proven stage and preserves an explicit path to the target stage.

## Workflow

1. Inspect repository architecture, ADRs, infrastructure, runtime, data flows, ownership, and measured behavior before proposing replacements.
2. Normalize the request with `.ai/templates/system-design-request.yaml`. Distinguish users, active users, open connections, in-flight requests, average RPS, sustained peak, and burst.
3. Ask at most three questions, only when the answer materially changes architecture. Prioritize traffic semantics, latency scope/percentile, and budget/region/compliance.
4. If answers are unavailable, continue with explicit low/base/high scenarios. Mark every value `USER_PROVIDED`, `REPOSITORY_DETECTED`, `CALCULATED`, `LIVE_LOOKUP`, `ASSUMED`, or `UNKNOWN`.
5. Read only the relevant references:
   - Requirements, conflicts, and questions: `references/requirements-normalization.md`
   - Throughput, latency, bandwidth, and storage: `references/capacity-and-latency.md`
   - Availability, consistency, recovery, and overload: `references/reliability-and-data.md`
   - Sensitive data, threats, controls, and compliance: `references/security-and-threat-model.md`
   - Budget, pricing lookup, unit economics, and confidence: `references/cost-and-pricing.md`
   - Workload-specific failure and scaling patterns: `references/workload-patterns.md`
   - Control ownership and verification: `references/security-control-matrix.md`
6. Validate the request with `ai-agent-kit architecture validate`, calculate it with `architecture model`, and generate a safe benchmark plan with `architecture benchmark-plan`. Run `scripts/capacity_cost_model.py` when the CLI is unavailable. Never invent benchmark throughput, compression, cache hit rate, SKU price, or discount.
7. Compare no more than three options: smallest viable, recommended target, and extreme scale only when justified.
8. Recommend one option. Include capacity math, cost range, bottleneck, failure behavior, security boundaries, staged evolution, and validation plan.
9. Report `READY_FOR_REVIEW`, `NEEDS_DECISION`, `INSUFFICIENT_EVIDENCE`, or `CONSTRAINTS_CONFLICT`. System design alone is never `PRODUCTION_READY`.
10. Build and verify the architecture pack with `architecture build` and `architecture verify`. Rebuild after repository or constraint changes; never reuse a stale artifact.

## Automatic lookup

Use repository evidence first, then reviewed local snapshots, then current official sources when a provider, region, and SKU class are known. A failed or unavailable lookup must not block provider-neutral design; mark cost `PARTIAL` or `UNAVAILABLE`. Record URL or API, provider, region, currency, effective date, retrieval time, pricing model, and excluded discounts.

## Output

Lead with the recommendation and why it fits. Then provide normalized targets, assumptions or contradictions, one clear Mermaid diagram, request/data flow, capacity model, monthly cost range, security and failure boundaries, evolution triggers, validation plan, and open decisions. Keep raw research and verbose calculations out of the main answer.

Never provision infrastructure, run paid load tests, deploy, publish, commit, or change external systems without explicit approval.
