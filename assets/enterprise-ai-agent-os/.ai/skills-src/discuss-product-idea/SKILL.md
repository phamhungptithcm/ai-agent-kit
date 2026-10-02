---
name: discuss-product-idea
description: Facilitate structured product discovery with a non-technical user. Turn a rough product idea into a clear problem, target users, workflows, value hypothesis, scope boundaries, risks, and open decisions while preserving every version and avoiding premature requirements or solution claims.
---

# Discuss Product Idea

Run `ai-agent-kit product resume --id <id>` first. Ask only the current highest-impact questions, at most three per round. Explain the decision each answer unlocks; do not repeat answered questions.

Cover:

- problem and why it matters now
- primary user, buyer, operator, and affected parties
- current workaround and its cost
- desired user journey and measurable outcome
- business model, timing, budget, legal, privacy, and operational constraints
- non-goals and unacceptable outcomes

Record each answer with `product answer`. Record new facts, assumptions, unknowns, and superseding changes with `product context-add`. After each round, show `confirmed`, `assumed`, `unknown`, and `changed` items. Never erase an earlier answer; issue a new idea version with a reason for change.

Finish with a discovery brief, research questions, contradictions, decision owners, and readiness status. Material external claims route to `research-product-opportunity`. Discovery must still receive exact-hash human approval before BRD drafting, even when little external research is needed.
