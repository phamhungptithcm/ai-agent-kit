# Agent Roles

All repository-facing roles must use the `repository-intelligence` skill before brainstorming, planning, impact analysis, review, QA analysis, documentation analysis, or implementation.

The Team Lead Orchestrator owns the shared repository intelligence brief and must populate `.ai/templates/repository-intelligence-brief.md` before assigning specialists.

After inspection, run `ai-agent-kit team plan --id <task-id>` and start the
smallest safe workcell. Use native subagents on Codex or Claude when available;
otherwise execute the same assignments as serial personas. The Team Lead owns
scope and synthesis, one implementation assignment owns writes, and an
independent reviewer owns the final review loop.

Specialist roles reuse the shared brief and query CodeGraph or CocoIndex only for role-specific gaps:

- Team Lead Orchestrator
- Domain Analyst
- Impact Explorer
- Solution Architect
- Tech Lead
- Implementation Engineer
- Database/Data Engineer
- Integration Engineer
- UI/UX Lead
- QA Lead
- Security Reviewer
- SRE/Release Engineer
- Documentation Delivery Agent
- Independent Code Reviewer
- Module Context Owner
- Memory Approver
- Skill Maintainer
- Quarterly Review

CodeGraph is required for structural evidence and impact. CocoIndex is required for semantic, requirements, specification, runbook, test, and documentation evidence. Source code remains authoritative for critical behavior.

## Persona Composition Matrix

Use personas to combine skills for common team responsibilities. A persona is not a shortcut around policy; it is a remembered bundle of skills with the same repository intelligence, approval, quality, and evidence requirements.

| Persona | Composed skills |
| --- | --- |
| Solution Architect | `start-task` + `repository-intelligence` + `design-document` + `architecture-review` |
| Senior Backend Engineer | `implement-feature` + `database-change` + `code-review` + `code-quality-review` |
| Production SRE | `production-incident` + `performance-investigation` + `observability-review` |
| Security Engineer | `security-review` + `threat-model` + `code-review` |
| QA Lead | `test-strategy` + `code-quality-review` + `delivery-documentation` |
| Release Manager | `release-readiness` + `delivery-documentation` + `jira-completion-package` |
| Tech Lead | `change-impact-plan` + `architecture-review` + `repository-health` |
| Web Growth Engineer | `start-task` + `marketing-growth-website` + `design-taste-website` + `animation-design-engineering` + `seo-geo-website` + `governed-action-gateway` + `implement-feature` + `code-quality-review` + `test-strategy` |

## Governance Roles

- Module Context Owner verifies module-scoped memory, context docs, and ownership facts against current source and team ownership.
- Memory Approver approves, rejects, supersedes, or marks memory entries stale under `.ai/core/memory-policy.md`.
- Skill Maintainer keeps `.ai/skills-src/`, platform adapters, prompts, and validators aligned with approved policy.
- Quarterly Review performs the scheduled stale-memory and policy drift review, then records required follow-up.
