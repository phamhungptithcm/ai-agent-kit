# External References Inspected

Retrieved: 2026-07-15

## Required Repositories

| Source | Default branch | Commit SHA | Relevant paths inspected | Notes |
| --- | --- | --- | --- | --- |
| https://github.com/anthropics/skills | `main` | `9d2f1ae187231d8199c64b5b762e1bdf2244733d` | `README.md`, `spec/agent-skills-spec.md`, `template/SKILL.md`, `skills/*/SKILL.md` examples | Used for the cross-platform Agent Skills shape: a skill directory with `SKILL.md`, YAML frontmatter, and optional scripts/references/assets. Content was not vendored. |
| https://github.com/shanraisshan/claude-code-best-practice | `main` | `0c9123288eb8f16d06bd69421556a610967eab59` | `best-practice/claude-commands.md`, `best-practice/claude-skills.md`, `best-practice/claude-subagents.md`, `best-practice/claude-settings.md`, `implementation/*` | Used as a community design reference for Claude Code adapters. Official behavior should override community examples when they conflict. |
| https://github.com/openai/codex | `main` | `1bbdb32789e1f79932df44941236ea3658f6e965` | `AGENTS.md`, `docs/agents_md.md`, `docs/skills.md`, `docs/config.md`, `docs/execpolicy.md`, `docs/sandbox.md` | Used as an implementation and documentation reference. Public official docs below remain the authoritative product behavior source. |

## Official Codex Documentation

| Topic | URL | Relevant behavior |
| --- | --- | --- |
| AGENTS.md | https://learn.chatgpt.com/docs/agent-configuration/agents-md | Codex discovers global and project `AGENTS.md` / `AGENTS.override.md`, merges root-to-leaf, and enforces a project-doc size budget. |
| Skills | https://learn.chatgpt.com/docs/build-skills | Skills use progressive disclosure. Repository skills live under `.agents/skills`, each with `SKILL.md` containing `name` and `description`. |
| Subagents | https://learn.chatgpt.com/docs/agent-configuration/subagents | Project custom agents live under `.codex/agents/*.toml` and must define `name`, `description`, and `developer_instructions`; `[agents]` controls fan-out. |
| Rules | https://learn.chatgpt.com/docs/agent-configuration/rules | `.rules` files use Starlark `prefix_rule` entries with `match` and `not_match` tests; rules control command execution outside the sandbox. |
| Hooks | https://learn.chatgpt.com/docs/hooks | Hooks may live in `.codex/hooks.json` or inline config. Prefer one representation per layer. Non-managed command hooks require trust review. |
| Project config | https://learn.chatgpt.com/docs/config-file/config-advanced | Codex reads trusted project `.codex/config.toml` layers from root to working directory; sensitive provider/auth/telemetry keys are ignored in project config. |
| Config reference | https://learn.chatgpt.com/docs/config-file/config-reference | `sandbox_mode`, `approval_policy`, `sandbox_workspace_write.*`, and agent settings are documented config keys. |
| Sandboxing | https://learn.chatgpt.com/docs/sandboxing | Common modes are `read-only`, `workspace-write`, and `danger-full-access`; lower-risk local automation is `workspace-write` with `on-request`. |
| Approvals and security | https://learn.chatgpt.com/docs/agent-approvals-security | Approval requests should guard boundary crossings; full access without approvals is elevated risk and not recommended. |

## Repository Context Sources

- `codegraph status .` on 2026-07-15: 3,780 indexed files, 76,443 nodes, 71,878 edges, mostly Java with XML/properties/YAML.
- `codegraph status .` after the expanded setup pass on 2026-07-15: 35,316 indexed files, 694,707 nodes, 655,602 edges; index reported up to date.
- `codegraph files --path . --format tree --max-depth 2 --no-metadata`
- `codegraph context --path . --no-code -n 40 "AI agent operating system repository structure build test CI instructions"`
- Root files inspected: `README.md`, `pom.xml`, `build_includes.xml`, `.gitlab-ci.yml`, `Jenkinsfile`, `.gitignore`.
- Local task brief inspected: `C:\Users\hxpham\Downloads\CODEX_SETUP_DUAL_AGENT_SYSTEM(3).md`, revision adding documentation/spec synchronization, diagram-as-code rules, MR/PR evidence, Jira completion package, demo artifact generation, and mandatory plan-review-approval gates.

## Feature Classification

- Cross-platform Agent Skills standard: `.ai/skills-src/<skill>/SKILL.md` with portable `name` and `description`, optional generated copies for each platform.
- Claude Code-specific: `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/`.
- Codex-specific: `AGENTS.md`, `.agents/skills/`, `.codex/config.toml`, `.codex/agents/*.toml`, `.codex/rules/*.rules`, `.codex/hooks.json`.
- Shared team policy: `.ai/core/`, `.ai/context/`, `.ai/rules/`, `.ai/workflows/`, `.ai/guards/`, `.ai/evals/`, `.ai/prompts/`, `.ai/scripts/`.
- Delivery traceability: shared team policy under `.ai/rules/delivery-traceability.md`, `.ai/workflows/prepare-pr-or-mr.md`, `.ai/workflows/prepare-jira-completion-package.md`, `.ai/templates/`, and `.ai/scripts/generate_delivery_artifacts.py`.

## License And Attribution Notes

The files in this repository are original starter policy, workflow, and validation content. External sources were used as design references only. No third-party skill source, script, or substantial prose was copied into this repository.
