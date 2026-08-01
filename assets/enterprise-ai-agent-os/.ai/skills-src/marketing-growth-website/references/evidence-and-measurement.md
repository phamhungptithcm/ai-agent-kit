# Marketing Evidence And Measurement

## Evidence classes

| Class | Meaning | Allowed use |
| --- | --- | --- |
| `verified` | Supported by a reviewable first-party or authoritative source | Public claim within the source's scope and freshness |
| `assumption` | Plausible but unverified input | Hypothesis or internal planning only |
| `unknown` | Missing, conflicting, inaccessible, or stale information | Explicit gap; do not publish as fact |
| `measured` | Observed through a named method, population, period, and environment | Result bounded to that measurement |
| `NOT_MEASURED` | No adequate measurement exists | No outcome claim |

Record provenance, owner, retrieval or measurement date, scope, and limitations. A source can verify a fact without proving that the fact caused an observed outcome.

## Claim strength

- Describe product behavior from verified implementation or approved product documentation.
- Describe customer, usage, performance, or business outcomes only from scoped evidence with permission to publish.
- Treat testimonials, logos, awards, ratings, prices, availability, certifications, comparisons, and regulated claims as proof-sensitive.
- Treat third-party benchmarks as context, not a promised baseline or universal rule.
- Mark projections, forecasts, and expected impact as estimates with assumptions.

## Measurement contract

For each metric define the decision supported; event and semantic trigger; numerator, denominator, unit, and aggregation; eligible population and exclusions; source of truth, timezone, and reporting window; consent, personal-data, retention, and access constraints; owner, validation method, and known gaps.

Do not collect an event or property only because it may be useful later. Prefer anonymous or aggregated signals when they answer the decision. Never put secrets, message bodies, free-form sensitive input, authentication data, or unnecessary identifiers in analytics.

## Attribution

State the attribution model and its limits. Separate correlation, modeled attribution, direct observation, and causal experiment evidence. Account for cross-device gaps, consent loss, blocked scripts, offline activity, seasonality, campaign overlap, and reporting-window differences when material.

## Experiments

Require:

1. one falsifiable hypothesis and one primary metric;
2. guardrails for user harm, accessibility, reliability, revenue quality, privacy, and performance as applicable;
3. baseline, eligibility, assignment unit, sample-size approach, duration, segmentation, and low-traffic limitations;
4. instrumentation validation before exposure;
5. predeclared stop, rollback, and decision rules;
6. checks for sample-ratio mismatch, novelty, seasonality, repeated peeking, and multiple comparisons where applicable;
7. a result stated as `MEASURED`, `INCONCLUSIVE`, `INVALID`, or `NOT_MEASURED`.

Do not call a variant a winner from directional movement alone. For low traffic, prefer qualitative research, usability evidence, sequential learning, or a larger product decision over a falsely precise test.
