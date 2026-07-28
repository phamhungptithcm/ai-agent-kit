# AI Agent Operating System

`.ai/` is the shared source of truth for repository-scoped AI agent behavior. Root files and platform adapters should route here instead of duplicating policy.

Every repository task starts with the Repository Intelligence Gate. Use CodeGraph first for structural evidence and CocoIndex second for semantic/code/document retrieval when ready. Missing, stale, unhealthy, or un-installable tools produce `DEGRADED` mode rather than blocking work; continue with bounded native repository evidence and report the limitation. See `.ai/workflows/repository-intelligence-workflow.md` and `.ai/guards/repository-intelligence-gate.yaml`.

Bootstrap is fast by default and does not install tools or refresh large indexes unless requested. Use `npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --deep` or `.ai/scripts/index-repository.py` when full repository intelligence is needed.

Team-ready completion also requires `.ai/core/quality-gates.md`, `.ai/core/code-quality-intelligence.md`, `.ai/core/output-contract.md`, and `.ai/core/memory-policy.md`. Memory retrieval is governed by `.ai/guards/memory-governance.yaml` and uses `.ai/templates/memory-entry.yaml` for approved-safe durable memory candidates.

Daily copy-ready prompts live in `.ai/PROMPTS.md`. Broader agent support is documented in `.ai/docs/agent-adapter-strategy.md`.

## Layout

- `core/`: mission, precedence, workflow, risk, quality gates, memory policy, definition of done, and output contract.
- `quality-profiles/`: universal, language-specific, platform/domain, and cross-cutting quality profiles.
- `PROMPTS.md`: copy-ready prompts for common team workflows.
- `context/`: repository facts, architecture notes, glossary, build/test commands, and ownership.
- `rules/`: durable engineering rules.
- `workflows/`: task-specific workflow playbooks.
- `docs/`: setup and operation guides for agent infrastructure.
- `skills-src/`: canonical skills mirrored to `.agents/skills` and `.claude/skills`.
- `prompts/`: copy-ready task templates.
- `templates/`: PR/MR, Jira completion, approval, memory, demo, and screenshot-placeholder templates.
- `guards/`: machine-readable starter policies.
- `evals/`: scorecard and golden cases for measuring consistency.
- `scripts/`: deterministic sync and validation tools.
- `proposals/`: changes that require explicit human approval before enabling.

## Commands

```bash
python .ai/scripts/sync_agent_assets.py
python .ai/scripts/sync_agent_assets.py --check
python .ai/scripts/validate_agent_config.py
python .ai/scripts/test_agent_policies.py
python .ai/scripts/generate_delivery_artifacts.py --jira-key DEMO-000 --title "Example change" --output-dir .ai/generated/demo
```

These scripts require Python 3.11 or newer for TOML validation. The Codex hook and examples assume `python` resolves to Python 3; configure the workstation or CI image accordingly before relying on hooks.

Generated files are reproducible. Do not edit `.agents/skills/*/SKILL.md` or `.claude/skills/*/SKILL.md` directly.
