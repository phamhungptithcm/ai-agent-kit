# Product Genesis: idea to production

Product Genesis helps a person who has only a rough product idea work like a small, disciplined product company. The agent facilitates each decision, writes the required artifacts, keeps every version, and stops at human approval gates before advancing.

## What the agent does

| Stage | Agent support | Required exit evidence |
| --- | --- | --- |
| Idea | Capture the user's original words, outcomes, people, constraints, assumptions, and unknowns | Versioned idea snapshot |
| Discovery | Run focused discussion rounds and expose contradictions and decisions | Discovery brief and owned unknowns |
| Research | Investigate users, workflow, alternatives, feasibility, viability, privacy, cost, and risk | Evidence ledger and proceed/pivot/pause/stop recommendation |
| Business requirements | Write measurable business outcomes, scope, policies, capabilities, and requirements | Human-approved BRD hash |
| Specification | Define journeys, functional/NFR behavior, data, integration, security, operations, acceptance, and traceability | Human-approved specification hash |
| Delivery | Slice the smallest end-to-end MVP into traceable Agile epics, stories, tests, and milestones | Approved implementation scope and ready backlog |
| Build and verify | Compose existing implementation, architecture, security, database, testing, review, and release skills | Requirement-linked verification evidence |
| Release and operate | Compare approved targets with environment-specific evidence and actual outcomes | Human release decision and next-version learning |

Material changes never overwrite an approved baseline. They create a successor version, impact analysis, old-to-new trace map, and reapproval request.

## Fast path without fake certainty

The fastest credible path is not a fixed sequence of long documents. The agent uses short discussion and evidence loops, drafts documents incrementally, resolves high-risk unknowns early, and plans one vertical MVP. Gates remain strict where mistakes become expensive: business approval, specification approval, implementation authority, material changes, and release.

Small low-risk products can keep artifacts concise. Regulated, multi-tenant, payment, safety, or high-scale products compose deeper security, privacy, data, capacity, operational, and legal review.

## Using it

Ask naturally:

```text
I only have an idea and no codebase. Help me start a product.
Thảo luận ý tưởng sản phẩm với mình.
Nghiên cứu cơ hội và tính khả thi của ý tưởng này.
Viết BRD từ discovery đã chốt.
Viết product spec từ BRD đã được duyệt.
Lập backlog Scrum từ spec đã duyệt.
```

Routing is explainable and fail-closed. Weak or ambiguous input returns `ABSTAIN`; users can invoke a skill explicitly.

## External-skill safety

The public registry is discovery input, not a trusted package source. `external-skill-sources.lock.json` records exact upstream commits, paths, licenses, hashes, review decisions, and adapted concepts. Unknown-license catalogs cannot be vendored. Upstream code is never executed during intake.

Run:

```bash
npm run validate:capabilities
npm run eval:routing
```

These checks ensure all canonical skills have an explicit dispatch mode, every routed skill has one real route, Product Genesis artifacts exist and are registered, and external provenance satisfies policy.
