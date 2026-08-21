# AI Agent Operating System

`.ai/` is the shared source of truth for repository-scoped AI agent behavior. Root files and platform adapters should route here instead of duplicating policy.

Every conversation starts with `.ai/core/conversation-entry-gate.md`. Raw ideas and active Product Workspaces automatically enter `run-product-genesis`; existing-system work then starts with the Repository Intelligence Gate. Use CodeGraph first for structural evidence and CocoIndex second for semantic/code/document retrieval when ready. Missing, stale, unhealthy, or un-installable tools produce `DEGRADED` mode rather than blocking work; continue with bounded native repository evidence and report the limitation. See `.ai/workflows/repository-intelligence-workflow.md` and `.ai/guards/repository-intelligence-gate.yaml`.

Bootstrap is fast by default and does not install tools or refresh large indexes unless requested. Use `npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --deep` or `.ai/scripts/index-repository.py` when full repository intelligence is needed.

Team-ready completion also requires `.ai/core/quality-gates.md`, `.ai/core/code-quality-intelligence.md`, `.ai/core/output-contract.md`, and `.ai/core/memory-policy.md`. Memory retrieval is governed by `.ai/guards/memory-governance.yaml` and uses `.ai/templates/memory-entry.yaml` plus `.ai/templates/memory-entry.schema.json` for canonical `memory-entry-v3` records.

Daily copy-ready prompts live in `.ai/PROMPTS.md`. Broader agent support is documented in `.ai/docs/agent-adapter-strategy.md`.

When a user begins with only a product idea, route through `run-product-genesis`, `.ai/core/product-genesis.md`, and `.ai/workflows/product-genesis.md` before repository implementation workflows. Product Genesis uses a durable Product Workspace to version idea, questions, research, experiments, business viability, trust/data assurance, BRD, rules, specification, design, delivery, iterations, evidence receipts, environments, release candidates, outcomes, and retirement. A named human must approve exact discovery, Alpha, investment, business-requirements, solution, delivery, production-readiness, release, and retirement hashes; agents cannot self-approve or infer approval. GitHub synchronization is preview-first and separately authorized. Production claims require provider-verified receipts and an exact environment attestation.

## Layout

- `core/`: mission, precedence, workflow, risk, quality gates, memory policy, definition of done, and output contract.
- `quality-profiles/`: universal, language-specific, platform/domain, and cross-cutting quality profiles.
- `PROMPTS.md`: copy-ready prompts for common team workflows.
- `context/`: repository facts, architecture notes, glossary, build/test commands, and ownership.
- `rules/`: durable engineering rules.
- `workflows/`: task-specific workflow playbooks.
- `docs/`: setup and operation guides for agent infrastructure.
- `skills-src/`: canonical skills and bundled text references mirrored to selected agent skill roots.
- `prompts/`: copy-ready task templates.
- `templates/`: PR/MR, Jira completion, approval, memory, marketing, demo, and screenshot-placeholder templates.
- `guards/`: machine-readable starter policies.
- `evals/`: scorecard and golden cases for measuring consistency.
- `scripts/`: deterministic sync and validation tools.
- `proposals/`: changes that require explicit human approval before enabling.

## Commands

```bash
python .ai/scripts/sync_agent_assets.py
python .ai/scripts/sync_agent_assets.py --check
python .ai/scripts/validate_agent_config.py
python .ai/scripts/validate_capability_coverage.py
python .ai/scripts/test_agent_policies.py
python .ai/scripts/generate_delivery_artifacts.py --jira-key DEMO-000 --title "Example change" --output-dir .ai/generated/demo
```

These scripts require Python 3.11 or newer for TOML validation. The Codex hook and examples assume `python` resolves to Python 3; configure the workstation or CI image accordingly before relying on hooks.

Generated skill files are reproducible. Update `.ai/skills-src/` and run the sync script instead of editing any generated skill root directly.
