# SEO And GEO Rules

These rules apply when building or changing publicly discoverable website content, routes, metadata, navigation, structured data, crawler controls, provider-facing discovery configuration, or search/AI measurement.

## Truth Contract

- Treat `.ai/templates/seo-geo-contract.schema.json` as the machine-readable consistency contract and start from `.ai/templates/seo-geo-contract.example.json`.
- Inventory every public, redirected, excluded, private, canonical, indexable, localized, and sitemap-eligible route or page type.
- Give entities stable IDs and canonical URLs. Reuse those IDs across visible content, metadata, structured data, and localized variants.
- Bind public factual claims to reviewable sources, an accountable owner, verification date, review date, scope, and status.
- Publish only `VERIFIED` or visibly `QUALIFIED` claims. `UNKNOWN`, `STALE`, and `REJECTED` claims must fail closed from public copy, metadata, structured data, and machine-readable discovery surfaces.
- Validate the contract with `.ai/scripts/validate_seo_geo_contract.py`; JSON Schema syntax alone does not prove cross-record consistency.

## Discovery Consistency

- Give every indexable page a unique descriptive title and useful meta description.
- Emit canonical URLs, robots directives, primary content, crawlable internal links, and applicable structured data in the HTML returned to non-browser clients.
- A sitemap may contain only public, indexable, self-canonical URLs. Redirected, private, excluded, non-canonical, and `noindex` URLs must remain out.
- Redirect routes must not emit canonicals or structured data for the destination page.
- Canonical targets must resolve to declared public, indexable routes. Canonical graphs must not contain multi-URL cycles.
- Hreflang alternates must resolve to declared public, indexable routes and be reciprocal. Keep locale, canonical, sitemap, navigation, and redirect signals aligned.
- Make important pages reachable through crawlable internal links; do not rely only on client-side interactions or site search.
- Preserve important content and navigation across supported mobile and desktop experiences.
- Validate raw/build HTML and browser-rendered behavior separately when JavaScript can defer content or metadata.

## Signal And Security Precedence

- Authentication and authorization are the only controls for private content. Crawler directives never grant or revoke access.
- HTTP redirects define navigation targets; do not combine them with indexable destination-page signals.
- `noindex` requires crawl access so compliant crawlers can observe it. Do not rely on `robots.txt` alone to remove an already known URL from an index.
- `rel=canonical` consolidates duplicate preferences; it is not a redirect, an access control, or a guaranteed provider selection.
- Sitemaps, hreflang, navigation, metadata, and structured data must support the same declared route/entity truth rather than compete as independent sources.

## Structured Data And Entity Integrity

- Use schema.org types that match the visible page purpose and verified repository or business data.
- Keep structured data consistent with content visible to users and map material fields to publishable contract claims.
- Prefer stable `@id` values derived from canonical public entity URLs when the implementation supports linked entities.
- Never invent reviews, ratings, prices, availability, authors, credentials, awards, locations, statistics, organizational relationships, or `sameAs` identities.
- Validate schema.org syntax and the current feature-specific requirements of each intended provider.
- Treat valid structured data as eligibility evidence only; never claim that it guarantees ranking, rich results, AI retrieval, or citation.

## Content And GEO Integrity

- Create useful, original, non-commodity content for people. Direct answers, headings, definitions, examples, comparisons, procedures, images, and video are useful only when they improve the user task.
- Prefer first-party experience, primary evidence, named authorship, dates, and explicit update history where applicable.
- Distinguish sourced facts, repository-derived facts, assumptions, recommendations, and unavailable evidence.
- Do not create scaled pages for query permutations, rewrite content only for AI systems, keyword-stuff, fabricate mentions, or manufacture authority signals.
- Treat GEO research and third-party tools as hypotheses unless their method, platform, sample, dates, controls, limitations, and reproducibility are reviewable.
- Do not use unvalidated passage-length formulas, composite GEO scores, correlation claims, or visibility promises as quality evidence.

## Crawler And Provider Policy

- Maintain separate decisions for search retrieval, model training, preview generation, user-triggered fetches, ads/safety review, and other documented purposes.
- Record provider, exact user agent, purpose, decision, official source, owner, review date, expiry date, and limitations. Do not infer one purpose from another bot owned by the same provider.
- Verify crawler identity where operational or security decisions depend on it; user-agent strings alone can be spoofed.
- Do not allow or block a crawler without documenting product, licensing, privacy, security, capacity, and operational intent.
- Treat provider capabilities as time-bounded. Use `SUPPORTED`, `IGNORED`, `UNVERIFIED`, or `NOT_APPLICABLE`, never an undated universal assumption.
- Treat `llms.txt` as optional and provider-specific. It is not access control, a universal standard, a ranking factor, or a guaranteed discovery channel.
- Never use a crawler file, structured data, feed, or `llms.txt` to publish private, secret, licensed, or otherwise non-public information.

## Measurement And Effectiveness

- Measure five layers separately: technical eligibility, search visibility, AI visibility, business outcome, and integrity guardrails.
- Use `MEASURED`, `INCONCLUSIVE`, `INVALID`, `NOT_MEASURED`, or `UNAVAILABLE`; missing data never means zero or success.
- Record metric definition, source of truth, observation window, sample size, environment, limitations, and consent/privacy boundary.
- Separate field data, provider-reported data, lab measurements, synthetic probes, estimates, and qualitative review.
- For AI visibility probes, repeat across documented prompts, paraphrases, dates, locales, and providers. A single generated answer is anecdotal, not outcome evidence.
- Citation count does not establish ranking, authority, factual absorption, fidelity, qualified traffic, or conversion. Inspect those outcomes separately when authorized and measurable.
- Evaluate changes against a baseline or bounded comparison while accounting for seasonality, content changes, provider drift, and low sample sizes.

## Claims Boundary

- Classify conclusions as measured, source-verified, inferred, unavailable, or not applicable.
- Do not claim indexing, canonical selection, ranking, rich-result display, crawler compliance, AI visibility, citation fidelity, traffic, conversion, or revenue without direct evidence for that exact outcome.
- Record external tools, URLs, retrieval dates, user agents, environments, authorization, and limitations for live-site checks.
