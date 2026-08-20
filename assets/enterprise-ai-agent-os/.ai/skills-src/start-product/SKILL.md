---
name: start-product
description: Start a new software product when the user only has an idea and no codebase, business requirements, specification, or architecture. Establish the governed Product Genesis workspace, version the idea, identify the current stage, and choose the next professional discovery action without starting implementation.
---

# Start Product

Use `.ai/workflows/product-genesis.md` as the stage controller.

1. Capture the user's words without silently rewriting their intent.
2. Select `LEAN`, `STANDARD`, or `HIGH_ASSURANCE` from consequence, regulation, data sensitivity, integrations, and operational risk; explain the choice.
3. Run `ai-agent-kit product start --id <id> --idea <verbatim-idea> --profile <profile>`. This creates an immutable idea snapshot and three bounded discovery questions.
4. Run `ai-agent-kit product status --id <id>` and report its next action.
5. Create a successor idea version rather than editing history when the user's intent changes.

Classify the product as `IDEA`, never as approved or implementation-ready. Route to `discuss-product-idea` unless current discovery evidence already resolves the seeded decisions.

Do not choose a stack, create production code, purchase services, publish, deploy, commit, or push. Do not treat user enthusiasm as BRD or specification approval.

Return the snapshot version, unresolved decisions, next skill, and exact approval that will eventually be required.
