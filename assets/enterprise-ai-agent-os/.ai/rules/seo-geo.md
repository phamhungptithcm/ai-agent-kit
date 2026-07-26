# SEO And GEO Rules

These rules apply when building or changing publicly discoverable website content, routes, metadata, navigation, structured data, crawler controls, or search-facing delivery configuration.

## Required Review

- Treat search discoverability as a quality requirement for public website changes.
- Define which routes are public, canonical, indexable, localized, redirected, or intentionally excluded.
- Give every indexable page a unique, descriptive title and useful meta description.
- Emit canonical URLs, robots directives, primary content, internal links, and applicable structured data in the HTML returned to non-browser clients.
- Keep canonical, sitemap, hreflang, navigation, and redirect signals consistent.
- Include only canonical, indexable URLs in XML sitemaps and keep modification dates accurate when supplied.
- Make important pages reachable through crawlable internal links; do not rely only on client-side interactions or site search.
- Preserve useful content and navigation across supported mobile and desktop experiences.
- Validate rendered behavior and raw or built HTML separately where the framework can defer content or metadata to JavaScript.

## Structured Data

- Use schema.org types that match the visible page purpose and verified repository or business data.
- Keep structured data consistent with content visible to users.
- Never invent reviews, ratings, prices, availability, authors, credentials, awards, locations, statistics, or organizational relationships.
- Validate syntax and required properties with repository-approved tooling.
- Treat valid structured data as eligibility evidence only; never claim that it guarantees ranking, rich results, or AI citation.

## GEO And Content Integrity

- Write clear, self-contained answers where they help users, with descriptive headings and explicit entity names.
- Prefer original, verifiable information, named authorship, dates, primary sources, and update history where applicable.
- Distinguish sourced facts, repository-derived facts, assumptions, and recommendations.
- Do not keyword-stuff, fabricate authority signals, or create content solely to manipulate search or generative systems.
- Do not use unvalidated passage-length formulas, composite GEO scores, correlation claims, or visibility promises as quality evidence.

## Crawler And Usage Controls

- Inspect existing `robots.txt`, robots meta tags, and HTTP crawler directives before changing them.
- Distinguish search indexing, AI-assisted search retrieval, model training, preview generation, and other crawler purposes.
- Do not assume that all search or AI crawlers execute JavaScript or honor the same controls.
- Do not allow or block a crawler without documenting product, licensing, privacy, security, and operational intent.
- Treat `llms.txt` as an optional emerging proposal, not an access-control mechanism, ranking factor, or guaranteed discovery channel.
- Never use `llms.txt` to publish private, secret, licensed, or otherwise non-public information.

## Evidence And Claims

- Classify results as measured, source-verified, inferred, unavailable, or not applicable.
- Separate field performance data from lab measurements and estimates.
- Do not claim indexing, ranking, rich-result eligibility, crawler access, AI visibility, or citation success without verifiable evidence.
- Record external tools, URLs, dates, user agents, environments, and limitations for live-site checks.
