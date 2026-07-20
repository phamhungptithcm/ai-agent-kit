# Agent Adapter Strategy

This repository currently has generated adapters for Claude Code and OpenAI Codex. The shared `.ai/` directory is intentionally agent-neutral so the same team policy can be routed into other AI coding agents over time.

## Shipped Adapters

| Agent | Adapter Files |
| --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/`, `.claude/skills/` |
| OpenAI Codex | `AGENTS.md`, `.codex/`, `.agents/skills/` |

## Adapter-Ready Targets

This is not a strict ranking. It is a practical list of common or enterprise-relevant AI coding agents with repository instruction, rule, skill, MCP, workflow, or prompt surfaces that can map back to `.ai/`.

| Target Agent | Likely Adapter Surface |
| --- | --- |
| GitHub Copilot coding agent | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md` |
| Cursor | Cursor Rules, `AGENTS.md`, prompt catalog, MCP config |
| Windsurf / Devin Desktop Cascade | `.windsurf/skills/`, `AGENTS.md`, `.agents/skills/`, workflow docs |
| Google Gemini CLI / Gemini Code Assist | `GEMINI.md`, `.mcp.json`, prompt catalog |
| Amazon Q Developer | `.amazonq/rules/*.md`, prompt catalog, validation commands |
| JetBrains Junie | `AGENTS.md`, `.junie/AGENTS.md`, guidelines, skills |
| Cline | AGENTS.md-style project rules, MCP config, prompt catalog, approval guidance |
| Devin | `AGENTS.md`, playbook templates, memory/governance mapping |
| Aider | Repo instructions, prompt catalog, quality-gate commands |
| Continue | Rules/config, prompt catalog, validation commands |

## Adapter Contract

Every future adapter must:

1. Route the agent to `.ai/` as the durable source of truth.
2. Point users to `.ai/PROMPTS.md`.
3. Reuse `.ai/skills-src/` when the target supports `SKILL.md` style skills.
4. Preserve repository intelligence, approval, quality-gate, output-contract, and memory-governance requirements.
5. Keep bootstrap local-only: no automatic branch, commit, push, PR/MR, Jira update, deploy, or application source edit.
6. Add validator checks for generated adapter drift.

## Recommended Expansion Order

1. GitHub Copilot
2. Cursor
3. Windsurf/Cascade
4. Gemini CLI
5. Amazon Q Developer
6. JetBrains Junie
7. Cline, Aider, Continue, and similar open-source terminal/editor agents
