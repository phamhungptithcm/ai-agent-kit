# Product Genesis Agent Guide

Use `run-product-genesis` for end-to-end or multi-stage requests and `start-product` for a new workspace. Start with `ai-agent-kit product start --id <id> --idea <idea> --profile STANDARD`; later use `product resume` and `product next`. Load `.ai/core/product-genesis.md`, the stage-specific skill, relevant quality profiles, and only current artifact heads plus cited predecessors.

Keep discussion interactive and accessible to non-technical users. Ask at most three questions per round and explain which decision each unlocks. Persist confirmed facts, assumptions, unknowns, and changes immediately. Use stable IDs and successor versions so an agent or human can resume without repeated prompting or reliance on chat history.

Before each decision run `product analyze --write`. Never advance from discovery, Alpha, investment, BRD, solution, delivery, production-readiness, release, or retirement review without a named human approval record bound to the exact current hash. Never start implementation merely because documents are complete. GitHub sync is a separate approved external write. An ambiguous remote create must stop for reconciliation; confirm an item absent before explicitly retrying it. Route material deviations through change control, run capacity-bounded iterations and commit-bound convergence, and classify all final evidence by trust and environment.

Typical command order:

`start -> answer/context -> research -> approve discovery -> hypotheses/experiments/prototype/usability/customer receipts -> approve Alpha -> viability/trust/data -> approve investment -> BRD/rules -> approve BRD -> specification/design -> approve solution -> delivery -> approve delivery -> iteration plan/review -> converge -> provider receipts/environment -> production readiness/analytics/support -> approve readiness -> release candidate -> approve release -> operate -> retire`

Evidence references must be real receipt IDs. Repository-bound receipts measure current regular-file SHA-256 and bind a Git commit. Provider and signed trust require an authorized verifier adapter; agents cannot elevate trust by editing JSON. Staging, pilot, and production attestations require provider or signed trust. A `PRODUCTION` candidate additionally requires a Production environment and a clean tracked worktree.
