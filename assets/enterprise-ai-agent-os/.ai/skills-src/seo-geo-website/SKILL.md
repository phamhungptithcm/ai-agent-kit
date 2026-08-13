---
name: seo-geo-website
description: Plan, implement, or audit public websites with a validated route/entity/claim contract, provider-aware crawler policy, structured-data integrity, and layered search/AI outcome evidence without unsupported visibility claims.
---

# SEO And GEO Website

Use this skill for public websites, landing pages, documentation, publishers, local businesses, ecommerce, and SaaS marketing surfaces. Do not apply public discoverability requirements to authenticated or intentionally private applications without evidence that they are in scope.

## Mode

Select exactly one mode:

- `plan`: define the route, entity, claim, source, crawler, provider, content, schema, and measurement contract before implementation.
- `implement`: make only approved changes, validate the truth contract, and preserve crawler, privacy, licensing, content, and product intent.
- `audit`: inspect repository source, build output, a supplied contract, or an explicitly authorized public URL without modifying the website.

If the mode is not explicit, infer the narrowest safe mode and state it.

## Required Inputs And Discovery

1. Run the Repository Intelligence Gate and load:
   - `.ai/rules/seo-geo.md`
   - `.ai/quality-profiles/web-app.yaml`
   - `.ai/quality-profiles/seo-geo.yaml`
   - `.ai/templates/seo-geo-contract.schema.json`
   - [references/contract-and-measurement.md](references/contract-and-measurement.md)
2. Determine site type, public page types, audiences, locales, primary entities, framework, rendering model, hosting surface, and intentionally private routes from evidence.
3. Start from `.ai/templates/seo-geo-contract.example.json`. Record unknown business or provider facts instead of inventing them.
4. For live checks, use only URLs and network access authorized by the task, respect rate limits and access controls, and record limitations.

## Review Sequence

1. Map public, redirected, excluded, private, canonical, indexable, localized, and sitemap states.
2. Validate status, redirect, robots, canonical, sitemap, hreflang, locale, navigation, and internal-link consistency.
3. Compare source/raw/build HTML with browser-rendered output when JavaScript can defer important content.
4. Map stable entities and every material public claim to exact sources, owner, verification date, review date, scope, and publishability status.
5. Select structured-data types only from visible purpose and verified claims. Validate syntax and current intended-provider requirements.
6. Review content for useful original contribution, first-party experience, direct answers where helpful, authorship, dates, primary sources, and update history. Reject scaled query permutations and AI-only rewrites.
7. Record separate crawler decisions for search retrieval, model training, previews, user-triggered fetches, and other purposes using dated official sources.
8. Treat `llms.txt` and other provider features as time-bounded and provider-specific. Never present them as access control or guaranteed visibility.
9. Define technical eligibility, search visibility, AI visibility, business outcome, and integrity guardrail measurements separately.
10. Run `python3 -B .ai/scripts/validate_seo_geo_contract.py <contract.json>` and resolve every conflict before a successful implementation or audit handoff.

## Evidence And Outcome Rules

- Use `measured`, `source-verified`, `inferred`, `unavailable`, or `not-applicable` for conclusions.
- Use `MEASURED`, `INCONCLUSIVE`, `INVALID`, `NOT_MEASURED`, or `UNAVAILABLE` for outcomes.
- A single AI response is anecdotal. Repeated probes require preserved prompts, paraphrases, dates, locales, providers, outputs, and limitations.
- Citation does not prove ranking, authority, factual absorption, fidelity, qualified traffic, conversion, or revenue.
- Provider and third-party advice must include source, retrieval date, method, scope, and expiry. Unsupported composite SEO/GEO scores are not evidence.

## Output Contract

Use `.ai/templates/seo-geo-review.md` and `.ai/templates/seo-geo-measurement-plan.md`.

For every material finding include:

- affected route, entity, claim, provider surface, or configuration;
- observed evidence and contract reference;
- evidence class and outcome status;
- impact and severity;
- smallest safe recommendation;
- verification method;
- remaining uncertainty.

Never promise indexing, canonical selection, ranking, rich results, crawler compliance, AI visibility, traffic, conversions, revenue, or citations. Never generate fake authorship, reviews, ratings, prices, availability, credentials, sources, measurements, or authority signals.

In `plan` and `audit` modes, do not modify application files. In `implement` mode, require tracked approval evidence, change only approved scope, validate the final diff, synchronize generated skill resources from the canonical source, and complete fresh verification.
