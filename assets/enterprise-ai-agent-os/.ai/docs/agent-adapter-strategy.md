# Agent Adapter Strategy

The kit uses thin adapters for Claude Code, Codex, GitHub Copilot, Cursor,
Windsurf/Cascade, Gemini CLI, Amazon Q Developer, JetBrains Junie, Cline,
Devin, Aider, and Continue without forking the shared policy in `.ai/`.

## Adapter Surfaces

| Agent | Adapter Files |
| --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/`, `.claude/skills/` |
| OpenAI Codex | `AGENTS.md`, `.codex/`, `.agents/skills/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/`, `.github/agents/`, `.github/skills/`, `.github/hooks/` |
| Cursor | `.cursor/rules/ai-agent-kit.mdc`, `AGENTS.md`, `.cursor/skills/` |
| Windsurf / Cascade | `AGENTS.md`, `.windsurf/skills/` |
| Gemini CLI | `GEMINI.md` |
| Amazon Q Developer | `.amazonq/rules/ai-agent-kit.md` |
| JetBrains Junie | `AGENTS.md`, `.junie/AGENTS.md` |
| Cline | `.clinerules/ai-agent-kit.md`, `AGENTS.md`, `.cline/skills/` |
| Devin | `AGENTS.md`, `.agents/skills/` |
| Aider | `CONVENTIONS.md`, `.aider.conf.yml` |
| Continue | `.continue/rules/ai-agent-kit.md` |

## Adapter Contract

Every adapter must:

1. Route the agent to `.ai/` as the durable source of truth.
2. Point users to `.ai/PROMPTS.md`.
3. Reuse `.ai/skills-src/` when the target supports `SKILL.md` skills.
4. Preserve repository intelligence, approval, quality-gate, output-contract, and memory-governance requirements.
5. Keep bootstrap local-only: no automatic branch, commit, push, PR/MR, Jira update, deploy, or application source edit.
6. Participate in ownership, drift, selection, and validation checks.

Use `bootstrap --agents all` for every adapter or `bootstrap --agents codex,copilot,cursor` for a reviewed subset.

Migration-safe updates preserve the current adapter selection. Re-run bootstrap with a reviewed `--agents` list to add adapters to an existing installation.

## Capability and standards checks

The canonical `.ai/adapters/registry.json` records every adapter surface,
capability level, required capability, owner, and known limitation. Run
`ai-agent-kit adapter matrix` to compare hosts and `ai-agent-kit adapter
conformance --adapter <id> --target .` to verify an installation.

`ai-agent-kit standards verify` checks portable Agent Skills, MCP 2026-07-28,
namespaced extensions, and the optional A2A 0.3.0 profile. A2A is disabled by
default and is not required for single-agent or same-host work.
