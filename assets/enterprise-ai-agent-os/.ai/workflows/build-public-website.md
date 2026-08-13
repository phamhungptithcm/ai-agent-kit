# Build Public Website Workflow

Use this workflow for a new or materially changed public website, landing page, documentation site, publisher, ecommerce surface, local-business site, or SaaS marketing surface.

1. Run the Repository Intelligence Gate.
2. Use `marketing-growth-website` in `discover` and `plan` modes. Define verified product, audience, problem, offer, funnel stage, traffic source, source promise, page goal, proof, CTA, next state, baseline, constraints, and unknowns.
3. Complete `.ai/templates/design-brief.md`: identify site type, audiences, user goals, brand assets, approved references, locales, primary entities, public page types, content hierarchy, rendering model, hosting surface, and intentionally private routes. Use `design-taste-website` in `direction` mode.
4. When material motion is proposed, use `animation-design-engineering` in `opportunities` and then `direction` mode. Decide what should remain static, then define purpose, vocabulary, tokens, timing, spatial behavior, reduced-motion alternatives, interruptibility, gesture, lifecycle, performance, compatibility, and evidence.
5. Use `seo-geo-website` in `plan` mode. Start from `.ai/templates/seo-geo-contract.example.json` and define every route/page type, stable entity, exact public claim, dated source, crawler purpose, provider feature, and measurement layer. Canonical behavior, indexability, robots policy, locale behavior, sitemap inclusion, internal links, and structured-data eligibility must be machine-readable.
6. Complete the marketing claim ledger and bind publishable claims to the SEO/GEO contract. Mark missing business facts, authorship, credentials, products, prices, availability, reviews, ratings, locations, sources, testimonials, customer logos, awards, outcomes, and asset rights as unknown; never invent them.
7. Reconcile marketing message, visual composition, animation, information hierarchy, and SEO/GEO content. Do not hide necessary meaning or user choice to improve aesthetics or a local conversion metric.
8. Plan raw/build HTML delivery and static fallbacks. Define technical eligibility, search visibility, AI visibility, business outcome, and integrity guardrail metrics with consent, minimization, source of truth, repeated-probe rules, and `NOT_MEASURED` behavior before adding tracking.
9. Select `.ai/quality-profiles/marketing-growth.yaml` plus applicable web, frontend, visual, animation, and SEO/GEO profiles.
10. For existing websites, complete the change-impact plan and obtain approval evidence. External publishing, messages, pixels, experiments, account mutations, and spend require separate governed authorization.
11. Use `marketing-growth-website`, `design-taste-website`, `animation-design-engineering` when applicable, and `seo-geo-website` in `implement` mode and change only the approved scope.
12. Run `python3 -B .ai/scripts/validate_seo_geo_contract.py <contract.json>`, then validate source/build output, raw HTML, status/redirects, headers, robots, canonical, sitemap, hreflang, crawler/provider signals, structured data, stable entities, visible claims, message match, claim provenance, CTA consequence, analytics semantics, consent, responsive states, keyboard/focus behavior, motion, accessibility, console state, visual regression, lifecycle cleanup, and performance.
13. Complete applicable marketing, visual-design, UI-state, animation, SEO/GEO review, and SEO/GEO measurement templates.
14. Report quality gates, uncertainty, deployment verification, and rollback. Do not promise marketing, design, motion, search, or AI outcomes without evidence.

`llms.txt` is optional and provider-specific. If used, document each intended provider's current official support state and review date, keep it limited to verified public information, and do not treat it as crawler access control, a universal standard, a ranking factor, or a guaranteed discovery mechanism.
