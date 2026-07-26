# High-Level Design

AI Agent Kit installs a repository-scoped operating model for AI-assisted engineering. The design goal is simple: developers should start from copy-ready prompts, agents should follow durable team policy, and every output should be reviewable, bounded, and evidence-backed.

## Design Goals

- Make AI-agent setup a one-command local install.
- Give Claude Code and Codex the same repository policy.
- Keep application source code untouched during bootstrap.
- Force repository intelligence before planning, review, QA, documentation analysis, or implementation.
- Apply language/version and platform/domain-aware code-quality profiles before implementation handoff or PR review.
- Stop existing-system changes at a change-impact plan until human approval exists.
- Make output useful for PR/MR review, Jira handoff, QA validation, security review, and future memory governance.

## System Overview

```mermaid
flowchart LR
  Dev[Developer] --> CLI[npx ai-agent-kit bootstrap]
  CLI --> Scaffold[Bundled scaffold]
  Scaffold --> TargetRepo[Target repository]

  TargetRepo --> AI[.ai shared policy]
  TargetRepo --> Claude[Claude adapter]
  TargetRepo --> Codex[Codex adapter]
  TargetRepo --> LocalState[.ai-agent-kit local state]
  LocalState --> Ownership[Ownership checksums]

  AI --> Contract[Manifest contract]
  Contract --> Workflows[Workflows]
  AI --> Skills[Skills source]
  AI --> Guards[Safety gates]
  AI --> Prompts[Prompt catalog]
  AI --> QualityProfiles[Quality profiles]
  AI --> Validators[Validation scripts]

  Claude --> ClaudeCode[Claude Code]
  Codex --> CodexAgent[OpenAI Codex]

  ClaudeCode --> AI
  CodexAgent --> AI
```

The package owns the scaffold. The target repository receives generated policy and adapters. Developers still review, stage, commit, push, open PRs/MRs, update Jira, and deploy manually.

## Agent Adapter Model

```mermaid
flowchart LR
  Source[.ai source of truth] --> Contract[Adapter contract]
  Contract --> Shipped[Shipped adapters]
  Contract --> Future[Future adapters]

  Shipped --> Claude[Claude Code]
  Shipped --> Codex[OpenAI Codex]

  Future --> Copilot[GitHub Copilot]
  Future --> Cursor[Cursor]
  Future --> Windsurf[Windsurf/Cascade]
  Future --> Gemini[Gemini CLI]
  Future --> AmazonQ[Amazon Q Developer]
  Future --> Junie[JetBrains Junie]
  Future --> OSS[Cline, Devin, Aider, Continue]

  Claude --> Behavior[Same team behavior]
  Codex --> Behavior
  Copilot --> Behavior
  Cursor --> Behavior
  Windsurf --> Behavior
  Gemini --> Behavior
  AmazonQ --> Behavior
  Junie --> Behavior
  OSS --> Behavior
```

The adapter rule is: route each tool back to `.ai/` instead of copying policy into every platform format. See [Agent Adapter Strategy](AGENT_ADAPTER_STRATEGY.md) for the roadmap.

## Code Quality Intelligence Layer

```mermaid
flowchart TB
  Dev[Developer request] --> Prompt[Purpose-named prompt]
  Prompt --> Agent[AI agent]
  Agent --> RI[Repository intelligence]
  RI --> Detect[Detect language, version, framework, tooling, risk areas]
  Detect --> Universal[Universal quality profile]
  Detect --> Lang[Language quality profile]
  Detect --> Platform[Platform/domain quality profile]
  Detect --> Risk[API, database, concurrency, memory profiles]
  Universal --> Review[Code quality review]
  Lang --> Review
  Platform --> Review
  Risk --> Review
  Review --> Gates[Quality gates and evidence]
  Gates --> Human[Human review]
  Human --> Project[Controlled project change]

  classDef dev fill:#F5E9FF,stroke:#B65CFF,stroke-width:2px,color:#2A2140;
  classDef agent fill:#FFF2E8,stroke:#FF8A3D,stroke-width:2px,color:#3D2414;
  classDef intel fill:#E8FBFF,stroke:#18BFD6,stroke-width:2px,color:#15313A;
  classDef policy fill:#ECFFF4,stroke:#25C267,stroke-width:2px,color:#15351F;
  classDef output fill:#FFF9E8,stroke:#E1A600,stroke-width:2px,color:#3A2D0B;
  classDef project fill:#F0EDFF,stroke:#7C67FF,stroke-width:2px,color:#221B52;

  class Dev,Prompt dev;
  class Agent agent;
  class RI,Detect intel;
  class Universal,Lang,Platform,Risk policy;
  class Review,Gates,Human output;
  class Project project;
```

The quality layer is stack-aware but conservative. It prefers repository-defined commands and config, then fills gaps with profile-based manual review. The current bundled profiles cover universal engineering practice, Go, Java, Python, TypeScript/JavaScript, frontend HTML/CSS, web apps, mobile apps, desktop apps, infrastructure, DevOps, API contracts, database work, concurrency, and memory/resource lifecycle.

## Install Impact On A Project

```mermaid
flowchart TD
  Start[Run bootstrap in target git repo] --> Detect[Detect repo profile and current git state]
  Detect --> Copy[Copy AI-agent scaffold]
  Copy --> Policy[.ai policy, workflows, guards, evals, scripts]
  Copy --> Adapters[AGENTS.md, CLAUDE.md, .codex, .claude, .agents]
  Copy --> Prompts[.ai/PROMPTS.md]
  Copy --> Metadata[.ai-agent-kit backups, report, MR/Jira handoff drafts]
  Copy --> Gitignore[Managed .gitignore entries]

  Detect --> Tools[Check CodeGraph and CocoIndex]
  Tools --> ToolPlan[Read-only tools plan]
  ToolPlan --> ToolApply[Explicit tools install --apply]
  Tools --> Index[Refresh indexes when tools are available]
  ToolApply --> Index
  Index --> Validate[Validate agent config]
  Copy --> Ownership[Record generated-file and managed-section checksums]
  Ownership --> Validate
  Validate --> Diff[Print local diff and review commands]

  Policy --> NoApp[Application source unchanged]
  Adapters --> NoRemote[No branch, commit, push, MR, Jira, or deploy]
  Metadata --> Rollback[Rollback data available locally]
```

| Installed Area | Purpose | Application Source Impact |
| --- | --- | --- |
| `.ai/` | Shared policy, workflows, prompts, skills, guards, scripts, evals, quality gates, memory governance. | No app source change. |
| `AGENTS.md` and `CLAUDE.md` | Route Codex and Claude Code to the same team policy. | Managed sections only. |
| `.codex/`, `.claude/`, `.agents/` | Platform adapters, agent roles, generated skills, hooks, and rules. | No app source change. |
| `.mcp.json` | Local MCP wiring for repository intelligence tools. | No app source change. |
| `.ai-agent-kit/` | Local backups, transaction report, ownership checksums, detected manifests/versions, and copy-ready handoff drafts. | Local metadata only. |
| `.gitignore` | Ignores local AI-agent caches and backup folders. | Managed section only. |

## Prompt-To-Project Workflow

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant Prompt as Prompt Catalog
  participant Agent as AI Agent
  participant RI as Repository Intelligence
  participant Policy as .ai Policy
  participant Quality as Quality Profiles
  participant Project as Project Files
  participant Review as Human Review

  Dev->>Prompt: Pick start-task, plan-change, fix-bug, review-pr, etc.
  Prompt->>Agent: Copy-ready prompt plus ticket, diff, bug, or incident context
  Agent->>RI: Run gate, query CodeGraph, query CocoIndex
  RI-->>Agent: Structural impact and semantic evidence
  Agent->>Policy: Load workflow, risk model, guards, output contract
  Agent->>Quality: Detect stack and select profiles
  Agent->>Project: Read only relevant source, tests, docs, config
  Agent-->>Dev: Facts, assumptions, risk, plan, or review findings

  alt Existing-system change
    Agent-->>Review: Change-impact plan, approved scope, quality strategy
    Review-->>Agent: Explicit approval or requested changes
    Agent->>Project: Implement only approved scope
  else Read-only analysis or review
    Agent-->>Review: Findings and evidence, no implementation
  end

  Agent-->>Dev: Output contract, quality gates, code-quality review, validation results, memory candidates
  Dev->>Project: Manually review, stage, commit, PR/MR, Jira, deploy
```

This flow makes the first prompt matter. A developer does not ask the agent to "just fix it"; they choose a prompt whose purpose matches the work. The agent then follows repository intelligence, approval gates, quality gates, and output contracts before the project changes.

## Governance And Feedback Loop

```mermaid
flowchart LR
  Output[Agent output] --> Quality[Quality gates]
  Output --> Evidence[PR/MR and Jira evidence]
  Output --> Memory[Memory candidates]
  Output --> Evals[Golden eval cases]

  Quality --> Review[Human review]
  Evidence --> Review
  Memory --> Approver[Memory Approver]
  Evals --> Maintainer[Skill Maintainer]

  Review --> Merge[Manual commit, PR/MR, merge]
  Approver --> ApprovedMemory[Approved memory only]
  Maintainer --> PolicyUpdate[Policy, prompts, skills, validator updates]

  ApprovedMemory --> FutureTasks[Future tasks]
  PolicyUpdate --> FutureTasks
```

The loop turns good work into reusable team behavior. The memory policy prevents agents from retaining sensitive or speculative information, while golden cases capture reusable failure patterns.

## Daily Prompt Names

| Prompt | Purpose |
| --- | --- |
| `start-task` | Understand a new or unclear request before editing. |
| `plan-change` | Produce a change-impact plan and stop before implementation. |
| `implement-approved` | Implement a reviewed and approved scope. |
| `fix-bug` | Find root cause, first incorrect state, and regression coverage. |
| `code-quality-review` | Review code quality using detected stack and selected quality profiles. |
| `review-pr` | Review a diff by production risk, not style preference. |
| `investigate-incident` | Build an incident timeline, impact, evidence, and prevention plan. |
| `prepare-handoff` | Prepare PR/MR, Jira, quality gates, validation, and memory-candidate handoff. |

## Adapter Roadmap

Shipped today:

- Claude Code
- OpenAI Codex

Adapter-ready targets:

- GitHub Copilot coding agent
- Cursor
- Windsurf / Devin Desktop Cascade
- Google Gemini CLI / Gemini Code Assist
- Amazon Q Developer
- JetBrains Junie
- Cline
- Devin
- Aider
- Continue

## Why This Matters

Without a shared operating model, every developer invents a different prompt, every agent interprets risk differently, and review evidence becomes inconsistent. AI Agent Kit gives the team a repeatable path from prompt to plan, implementation, review, and learning while keeping the developer in control of source changes and external actions.
