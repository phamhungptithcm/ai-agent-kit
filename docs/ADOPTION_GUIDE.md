# Adoption Guide

Use this guide when introducing AI Agent Kit to a team, manager, QA lead, or onboarding audience.

## The Pitch

AI Agent Kit turns ad hoc AI coding into a repeatable repository operating model. It gives supported coding agents the same durable instructions, forces repository intelligence before edits, and creates review-ready evidence without letting the tool perform remote Git or ticketing actions.

## Recommended Rollout

1. Run `bootstrap --dry-run` in a representative repository.
2. Review the proposed `.ai/`, selected adapter directories, root instruction files, and `AI_AGENT_TEAM_GUIDE.md`.
3. Run the real bootstrap locally using the complete `governed` preset.
4. Run `status` and `doctor` to distinguish installed policy from operational repository-intelligence readiness.
5. Review `diff` and the copy-ready MR/Jira output under `.ai-agent-kit/output/`.
6. Commit the setup manually after team review.
7. Review `tools plan`, explicitly approve `tools install --apply` if needed, and refresh indexes before larger change planning, implementation, or review.
8. Ask developers and QA to start work with the generated `start-task`, `fix-bug`, `implement-feature`, `code-review`, and incident workflows.

## Demo Flow

Show three moments:

- `bootstrap --dry-run` to prove the command is transparent.
- `bootstrap` to show fast local-only setup, generated backups, and validation evidence.
- `tools plan` to show exact pinned CodeGraph/CocoIndex changes without installing anything.
- `tools install --apply`, followed by `bootstrap --refresh-indexes`, for teams ready to enable full repository intelligence.
- `status`, `doctor`, and `diff` to show that readiness and repository changes are observable without writing files.
- `update --dry-run` and `uninstall --dry-run` to show lifecycle transparency without applying changes.
- The high-level design diagrams in `docs/HIGH_LEVEL_DESIGN.md` to show what files are affected and how prompts flow into agent output.
- The adapter matrix in `docs/AGENT_ADAPTER_STRATEGY.md` to show how one contract reaches each supported agent.
- A sample agent task using the Repository Intelligence Gate before any implementation.

## What To Emphasize

- Managers get consistency, auditability, and lower review surprise.
- Developers get reusable skills and fewer blank-page prompts.
- QA gets risk-aware test strategy and evidence templates.
- Security reviewers get explicit non-negotiables around secrets, production access, approval gates, and data protection.
- Platform leads get an adapter contract for extending the same `.ai/` policy to GitHub Copilot, Cursor, Windsurf, Gemini CLI, Amazon Q Developer, JetBrains Junie, and open-source agents.

## Success Criteria

- Developers can explain what the Repository Intelligence Gate does.
- The team agrees which changes require human plan approval.
- Pull requests include concrete validation evidence instead of vague "tested" claims.
- Agent-generated work remains scoped, reviewable, and reversible.
- `governed` and `full` produce the same core quality and safety contract.
- Lifecycle inspection does not change the repository working tree.
