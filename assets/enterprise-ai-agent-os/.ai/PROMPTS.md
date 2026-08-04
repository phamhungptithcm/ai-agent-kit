# AI Agent Prompt Catalog

Use these copy-ready prompts after running bootstrap. Pick the prompt by the work you are doing, paste the ticket or context, and let the agent follow the shared `.ai/` policy.

## Quick Start

Install the kit in a repository:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --yes
```

List prompt names any time:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest prompts
```

Print one prompt:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest prompt start-task
```

## Prompt Names

| Name | Use When |
| --- | --- |
| `start-task` | A ticket or request is new, broad, risky, or unclear. |
| `plan-change` | Existing behavior may change and implementation must stop before approval. |
| `implement-approved` | A reviewed plan is approved and the agent may edit inside that scope. |
| `fix-bug` | A defect needs root cause, first incorrect state, and regression coverage. |
| `code-quality-review` | A change, file, module, or PR needs stack-aware quality review. |
| `review-pr` | A diff, branch, PR, or MR needs senior engineering review. |
| `investigate-incident` | A production issue needs timeline, impact, evidence, mitigation, and prevention. |
| `prepare-handoff` | Work is ready for PR/MR, Jira, validation, quality gates, and memory-candidate handoff. |
| `build-seo-geo-website` | A public website needs an evidence-based SEO/GEO plan, implementation, or audit. |
| `design-website` | A website or product surface needs design direction, approved implementation, audit-first redesign, or visual review. |
| `animate-interface` | A user interface needs animation opportunities, motion direction, approved implementation, strict review, or an improvement inventory. |
| `design-system` | Product constraints need a measurable system architecture, capacity model, security boundaries, staged scale, and cost range. |

## design-system

```text
Use the design-scalable-systems skill for this request.

Requirement:
[describe the product, workload, latency, users or connections, reliability, security, data, cost, region, and delivery constraints you know]

Inspect the repository first. Normalize the request, ask no more than three architecture-changing questions, and continue with explicit scenarios when answers are unavailable.

Return:
- one recommended architecture and why
- measurable requirements with source and confidence
- assumptions, contradictions, and unknowns
- one clear architecture diagram and request/data flow
- deterministic capacity and bandwidth calculations
- launch, target, and justified extreme-scale cost scenarios
- overload, dependency, recovery, data, and security boundaries
- evolution triggers and migration path
- benchmark, load, resilience, recovery, security, cost, and observability validation plan
- READY_FOR_REVIEW, NEEDS_DECISION, INSUFFICIENT_EVIDENCE, or CONSTRAINTS_CONFLICT

Never invent per-instance throughput, cloud prices, discounts, compliance, or production evidence. Do not provision, deploy, run paid tests, commit, push, or release without separate approval.
```

## start-task

```text
Use the start-task skill for this request.

Task or ticket:
[paste request]

Return:
- business outcome
- current understanding
- repository intelligence gate status
- indexed facts and source-code verified facts
- impacted modules, contracts, data, dependencies, and operators
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- risk classification
- smallest safe change
- expected files/classes/functions
- test and quality-gate strategy
- documentation/specification/diagram impact
- deployment and rollback considerations
- whether implementation approval is required

Do not edit files yet if this touches existing application behavior, database behavior, runtime config, infrastructure, public contracts, or behavior-changing tests.
```

## plan-change

```text
Use the change-impact-plan skill for this existing-system change.

Requested change:
[paste requirement]

Produce a concrete change-impact plan and stop before editing files.

Include:
- repository intelligence gate status
- CodeGraph structural impact
- CocoIndex semantic/docs/tests evidence
- current behavior and verified execution flow
- root cause or capability gap
- in scope and out of scope
- change area boundary
- impact boundary
- files explicitly approved for change
- areas requiring developer review before touching
- reason no other area is changed
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- code-quality risks to review: API, database connection lifecycle, transactions, concurrency/deadlock/leak, heap/resource memory, performance
- platform/domain risks to review: web app, mobile app, desktop app, infrastructure, DevOps/release
- proposed solution and alternatives
- callers, consumers, contracts, data, and integrations affected
- security, privacy, transaction, concurrency, and data-integrity impact
- performance and capacity impact
- backward compatibility
- test and regression strategy
- docs/specs/diagrams updates
- deployment, migration, and rollback
- approval decision requested
```

## implement-approved

```text
Use the implement-feature skill for this approved plan.

Approved plan reference:
[paste plan ID/link/approval]

Approved scope:
[paste approved files/modules/behavior]

Acceptance criteria:
[paste criteria]

Implement only inside the approved scope. If you discover material scope, design, risk, dependency, database, infrastructure, or public-contract changes beyond the approved plan, stop and request a delta-impact plan.

Before completion, report:
- approved-plan compliance
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- files changed and why
- tests executed with actual results
- quality gates with PASSED / FAILED / NOT_APPLICABLE / NOT_RUN and evidence
- code quality review evidence from `.ai/templates/code-quality-review.md`
- compatibility impact
- security and performance considerations
- docs/specs/diagrams impact
- deployment and rollback notes
- memory candidates under memory policy, or None
- remaining risks
```

## fix-bug

```text
Use the fix-bug skill for this defect.

Bug:
[paste bug report, logs, screenshots, failing test, or reproduction]

Find:
- repository intelligence gate status
- observed current behavior
- expected behavior
- first incorrect state
- root cause
- impacted callers, data, contracts, jobs, and integrations
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- smallest safe fix
- regression test strategy
- quality gates
- security, data, performance, concurrency, memory/resource lifecycle, and observability impact
- memory candidates, or None

For existing-system changes, stop after the impact plan until approval evidence exists.
```

## code-quality-review

```text
Use the code-quality-review skill for this target.

Review target:
[paste file path, module, branch, diff, PR/MR link, or change summary]

Detect:
- language/version/framework/tooling
- application/platform/domain
- build, test, lint, format, type-check, and security commands
- selected `.ai/quality-profiles/`
- web app, mobile app, desktop app, infrastructure, DevOps, API, database, concurrency, memory/resource, and performance-sensitive areas

Review for:
- clean code and repository conventions
- language/version best practices
- platform/domain best practices
- API compatibility and error/data shape
- database connection/session/cursor lifecycle and transaction safety
- thread/goroutine/task/promise leaks and deadlock risk
- heap retention, cache growth, listener/timer/file/socket cleanup
- performance risks and missing validation evidence

Return `.ai/templates/code-quality-review.md` content with PASSED / FAILED / NOT_APPLICABLE / NOT_RUN statuses and evidence. Do not implement changes unless explicitly asked after this review.
```

## review-pr

```text
Use the code-review skill on this diff.

Review target:
[paste PR/MR link, branch, commit range, or diff summary]

Prioritize:
- correctness
- security
- data integrity
- concurrency and transaction behavior
- backward compatibility
- reliability and failure handling
- performance
- language/version best practices
- platform/domain best practices for web, mobile, desktop, infrastructure, or DevOps
- resource lifecycle, heap retention, and leak risk
- observability
- testing and quality gates
- memory governance

Lead with findings by severity. For each finding include location, problem, production impact, evidence, and recommended correction. Avoid style-only comments unless they hide real risk.
```

## investigate-incident

```text
Use the production-incident skill for this issue.

Incident context:
[paste alert, timeline, symptoms, affected users/systems, logs, or dashboards]

Return:
- repository intelligence gate status
- timeline
- observed impact
- evidence reviewed
- current mitigation
- likely first incorrect state
- candidate causes separated from verified facts
- data/security/customer impact
- immediate containment
- permanent correction options
- prevention and observability improvements
- follow-up owners

Do not access production systems, secrets, customer data, or destructive operations autonomously.
```

## prepare-handoff

```text
Use the delivery-documentation skill to prepare handoff for review.

Work completed:
[paste summary, branch/diff, ticket, or approved plan reference]

Prepare:
- PR/MR description
- Jira completion text if applicable
- approved plan compliance
- actual files changed
- acceptance criteria verification
- tests executed with actual results
- quality gates with status and evidence
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- code quality review evidence from `.ai/templates/code-quality-review.md`
- security/privacy impact
- performance/concurrency/memory impact
- compatibility and migration impact
- docs/specs/diagrams updates or no-change rationale
- deployment and rollback
- memory candidates under memory policy, or None
- remaining risks and follow-ups

Do not claim Jira, PR/MR, screenshots, PPTX, XLSX, docs, diagrams, or tests exist unless verified.
```

## build-seo-geo-website

```text
Use the seo-geo-website skill and `.ai/workflows/build-public-website.md`.

Mode:
[plan | implement | audit]

Website scope:
[describe repository, routes/page types, locales, or authorized public URL]

Business facts and constraints:
[provide verified entity, product, author, location, content, crawler, privacy, and licensing context; mark unknowns]

Return:
- repository intelligence gate status
- site type, framework, rendering model, public page types, locales, and primary entities
- public/canonical/indexable/redirected/excluded route contract
- selected web and SEO/GEO quality profiles
- metadata, canonical, hreflang, sitemap, redirect, internal-link, and crawler-policy review
- raw/build HTML discoverability review
- structured-data integrity review based only on visible verified facts
- content, authorship, source, date, and entity-integrity review
- measured, source-verified, inferred, unavailable, and not-applicable evidence separated
- smallest safe implementation or prioritized findings
- tests, quality gates, deployment verification, and rollback

Treat llms.txt as optional and experimental. Do not promise indexing, rankings, rich results, traffic, conversions, AI visibility, or citations.

In plan or audit mode, do not edit website files. In implement mode, require approval evidence and remain inside approved scope.
```

## design-website

```text
Use the design-taste-website skill.

Mode:
[direction | implement | redesign | review]

Surface and scope:
[describe the website, product UI, routes, screens, components, or approved redesign boundary]

Audience, goal, and constraints:
[provide audience, user task, business outcome, existing brand/design system, references, content, supported viewports/locales, accessibility, compliance, and performance constraints]

Return:
- repository intelligence gate status
- surface classification, audience, primary task, and business outcome
- one-sentence Design Read
- contextual layout variance, motion intensity, and information density with rationale
- existing design-system and brand evidence
- primary inspiration and optional secondary influence, with copy boundaries
- design principles, anti-goals, tokens, typography, color, spacing, layout, imagery, icons, shape, elevation, and motion direction
- responsive composition
- applicable default, hover, active, focus, disabled, loading, empty, error, success, offline, unauthorized, stale, and partial states
- accessibility, reduced-motion, performance, content, SEO/GEO, and asset-rights boundaries
- evidence classified as repository-verified, screenshot-observed, browser-measured, reference-derived, inferred, unavailable, or not applicable
- visual QA plan or prioritized findings

Use project-owned design guidance before external inspiration. Do not hard-code a framework, font, icon library, or animation library. Do not copy protected brand material or fabricate trust signals.

In direction and review modes, do not edit application files. Redesign is audit-first. Implement only with approval evidence and remain inside approved scope.
```

## animate-interface

```text
Use the animation-design-engineering skill.

Mode:
[opportunities | direction | implement | review | improve]

Surface and scope:
[describe the route, component, flow, diff, codebase area, or approved animation boundary]

Motion context:
[provide audience, task, frequency, approved motion intensity, existing motion system, supported browsers/devices/inputs, accessibility target, performance budget, and constraints]

Return:
- repository intelligence gate status
- current motion inventory or explicit no-animation baseline
- animation decision: should it animate, purpose, frequency, trigger, and essential/decorative status
- motion vocabulary, tokens, timing, enter/exit, origin, stagger, and spatial-continuity direction where applicable
- repeated, interrupted, reversed, canceled, route-change, background-tab, and unmount behavior
- gesture bounds, pointer capture, velocity, damping, multi-touch, and input parity where applicable
- static and reduced-motion behavior
- layout, paint, composite, main-thread, input, memory, layer, battery, and lifecycle review
- browser/API compatibility, fallback, and dependency impact
- evidence classified as source-verified, browser-observed, trace-measured, device-observed, inferred, unavailable, or not applicable
- prioritized findings, approved implementation result, or verification plan

Do not add motion without a purpose. Do not hard-code a universal duration, easing, spring, scale, or library. Do not claim smoothness, frame rate, hardware acceleration, accessibility, or negligible performance impact without evidence.

Opportunities, direction, review, and improve modes are read-only. Implement only with approval evidence and remain inside approved scope.
```
