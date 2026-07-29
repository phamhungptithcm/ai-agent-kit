# Agent Adapter Strategy

Published version `0.4.2` ships repository adapters for Claude Code and OpenAI Codex. The current unreleased source implements the next expansion: `.ai/` remains the source of truth, and every supported AI coding tool gets a thin adapter that points back to the same policy, prompts, skills, guards, quality gates, and output contract.

This keeps the team operating model stable even when developers use different AI agents.

## Support Status

| Status | Meaning |
| --- | --- |
| Published | Available in the current npm release. |
| Next release | Implemented and tested in source, but not published yet. |

## Published Today

| Agent | Adapter Surface | Current Package Behavior |
| --- | --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/`, `.claude/skills/` | Installs root instructions, Claude config, commands, agents, and generated skills. |
| OpenAI Codex | `AGENTS.md`, `.codex/`, `.agents/skills/` | Installs root instructions, Codex config, hooks, rules, agents, and generated skills. |

## Implemented For The Next Release

| Target Agent | Implemented Adapter Surface |
| --- | --- |
| GitHub Copilot | `.github/copilot-instructions.md`, `AGENTS.md`, `.agents/skills/` |
| Cursor | `.cursor/rules/ai-agent-kit.mdc`, `AGENTS.md`, `.cursor/skills/` |
| Windsurf / Devin Desktop Cascade | `AGENTS.md`, `.windsurf/skills/` |
| Google Gemini CLI | `GEMINI.md` with native context imports |
| Amazon Q Developer | `.amazonq/rules/ai-agent-kit.md` |
| JetBrains Junie | `AGENTS.md`, `.junie/AGENTS.md` |
| Cline | `.clinerules/ai-agent-kit.md`, `AGENTS.md`, `.cline/skills/` |
| Devin | `AGENTS.md`, `.agents/skills/` |
| Aider | `CONVENTIONS.md`, `.aider.conf.yml` |
| Continue | `.continue/rules/ai-agent-kit.md` |

Bootstrap installs all adapters by default. `--agents <comma-separated-list>` installs a subset; `--claude-only` and `--codex-only` remain backward-compatible aliases.

`update --apply` preserves the installation's current adapter selection. Teams upgrading an older Claude/Codex installation opt into additional adapters by re-running `bootstrap --agents all` or an explicit reviewed list.

## Adapter Contract

Every new adapter should be thin. It should not fork policy.

Required adapter behavior:

1. Route the agent to `.ai/` as the durable source of truth.
2. Point daily users to `.ai/PROMPTS.md` and `ai-agent-kit prompt <name>`.
3. Reuse `.ai/skills-src/` when the target agent supports `SKILL.md` style skills.
4. Preserve the same repository intelligence gate expectation.
5. Preserve the existing-system approval gate.
6. Preserve quality gates and output contract.
7. Preserve memory governance: approved-only retrieval, bounded results, no sensitive data.
8. Keep bootstrap local-only: no automatic branch, commit, push, PR/MR, Jira update, deploy, or application source edit.
9. Add validator checks so generated adapter files cannot drift silently.

## Adapter Generation Pattern

```mermaid
flowchart LR
  Source[.ai source of truth] --> Contract[Adapter contract]
  Contract --> Claude[Claude Code adapter]
  Contract --> Codex[Codex adapter]
  Contract --> Copilot[GitHub Copilot adapter]
  Contract --> Cursor[Cursor adapter]
  Contract --> Windsurf[Windsurf/Cascade adapter]
  Contract --> Gemini[Gemini adapter]
  Contract --> AmazonQ[Amazon Q adapter]
  Contract --> JetBrains[Junie adapter]
  Contract --> OSS[Open-source agents]

  Claude --> SameBehavior[Same team behavior]
  Codex --> SameBehavior
  Copilot --> SameBehavior
  Cursor --> SameBehavior
  Windsurf --> SameBehavior
  Gemini --> SameBehavior
  AmazonQ --> SameBehavior
  JetBrains --> SameBehavior
  OSS --> SameBehavior
```

## Next-Release Acceptance Gates

1. Registry selection, default-all behavior, and legacy flags pass unit tests.
2. Each native instruction surface is installed, ownership-tracked, and reported by `status`/`doctor`.
3. Canonical skills synchronize without drift to every supported skill root.
4. Single- and multi-adapter bootstraps remain local-only, transactional, idempotent, and application-source safe.
5. `npm run check` and packed-tarball smoke verification pass before any release is requested.

## Sources Reviewed

- GitHub Copilot repository custom instructions: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
- Cursor Rules: https://docs.cursor.com/context/rules
- Cursor coding-agent best practices: https://cursor.com/blog/agent-best-practices
- Windsurf/Cascade skills: https://docs.devin.ai/desktop/cascade/skills
- Gemini CLI `GEMINI.md`: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- Amazon Q Developer project rules: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html
- JetBrains Junie guidelines and memory: https://junie.jetbrains.com/docs/guidelines-and-memory.html
- Cline rules and skills: https://docs.cline.bot/customization/cline-rules and https://docs.cline.bot/customization/skills
- Devin AGENTS.md: https://docs.devin.ai/onboard-devin/agents-md
- Devin skills: https://docs.devin.ai/product-guides/skills
- Aider conventions: https://aider.chat/docs/usage/conventions.html
- Continue rules: https://docs.continue.dev/customize/deep-dives/rules
