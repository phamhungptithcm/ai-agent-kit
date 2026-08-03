# AI Agent Kit

[![npm version](https://img.shields.io/npm/v/@hunpeolabs/ai-agent-kit?color=cb3837)](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)
[![npm downloads](https://img.shields.io/npm/dm/@hunpeolabs/ai-agent-kit?label=downloads%2Fmonth&color=2563eb)](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)
[![CI](https://github.com/phamhungptithcm/ai-agent-kit/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/phamhungptithcm/ai-agent-kit/actions/workflows/npm-publish.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-43853d)](package.json)

Give every AI coding agent the same way to understand a repository, plan a
change, work within approval boundaries, and show what it verified.

AI Agent Kit brings repository context, quality profiles, governed actions,
and reviewable evidence to Claude Code, Codex, Copilot, Cursor, and eight other
coding agents.

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap
```

Bootstrap is local. It does not edit application code, commit, push, open a
pull request, update a ticket, or deploy.

[Features](#whats-included) · [Quick start](#quick-start) · [Latest release](#latest-release-v061) · [Supported agents](#supported-agents) · [Documentation](#documentation) · [npm](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)

![AI Agent Kit bootstrap flow](https://raw.githubusercontent.com/phamhungptithcm/ai-agent-kit/main/docs/assets/bootstrap-demo.gif)

## Why use it?

Coding agents are useful, but each one can approach the same repository
differently. Important context gets missed, plans drift from implementation,
and a confident answer can look more complete than the evidence supports.

AI Agent Kit gives them the same path:

```text
Understand → Inspect → Plan → Approve → Execute → Verify → Report
```

| Rules or prompts alone | AI Agent Kit |
| --- | --- |
| Instructions are available if the agent remembers to use them | The task workflow selects the relevant context, rules, and quality profiles |
| Approval lives in conversation history | Approval is tied to the task, repository state, scope, and protected action |
| “Done” may describe intent or local output | Completion reports separate verified work, missing evidence, and remaining risk |
| Optional indexing can become a blocker | CodeGraph and CocoIndex fall back to bounded `DEGRADED` repository inspection |

The kit does not decide what your team should approve. It makes the boundary
clear, keeps normal work moving, and leaves evidence another person can review.

## What's included

### Repository-aware workflow

- CodeGraph for structure and impact analysis.
- CocoIndex for semantic search across code and documentation.
- A bounded `DEGRADED` fallback when either index is unavailable.
- Task-specific context packs with sources, selection reasons, token budgets,
  and deterministic hashes.
- Ready-made workflows for planning, implementation, bug fixes, reviews,
  incidents, architecture, security, testing, releases, and handoff.

### Code quality

- Profiles for Go, Java, Python, TypeScript/JavaScript, and HTML/CSS.
- Web, mobile, desktop, infrastructure, and DevOps guidance.
- API, database, concurrency, memory, security, observability, dependency, and
  testing checks.
- Automatic profile selection based on the repository's language, framework,
  platform, and risk.

### Writing quality

- A `humanize-writing` skill for natural voice editing across posts, blogs,
  emails, and personal or marketing drafts.
- Task-local voice mirroring, a model-language pattern dictionary, and
  meaning-preserving rules for facts, attribution, authorship, and privacy.
- No fabricated experiences or specificity, and no claims that a rewrite can
  prove human authorship or bypass AI detectors.

### Website growth, end to end

The kit helps an agent understand what the website needs to say, build it well,
and measure what happens next.

```text
Context → Positioning → Page → SEO/GEO → Design & motion → Measure → Improve
```

- Marketing context, message match, funnels, landing pages, CTAs, attribution,
  and safe experiments.
- A claim ledger that keeps assumptions, missing proof, and invented customer
  stories out of public content.
- SEO and GEO rules for metadata, canonical URLs, structured data, hreflang,
  crawl policy, raw HTML, and evidence-backed public claims.
- Design and animation guidance that works with the existing system and keeps
  accessibility, performance, reduced motion, and content intact.
- Measurement plans with clear metrics, consent, privacy, source of truth, and
  an honest `NOT_MEASURED` result when evidence is missing.

Add the complete workflow to your repository:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap
```

### Governance and safety

![AI Agent Kit governed agent loop](docs/assets/agent-loop-v070.svg)

AI Agent Kit gives every coding agent the same path:

**Understand → Inspect → Plan → Approve → Execute → Verify → Report**

Inside Verify, the agent repeats review → fix → verify until a fresh review
passes. Release actions always require separate authorization.

- Existing-system changes stop for a reviewed impact plan and explicit approval.
- Protected edits are checked against the approved paths and current diff.
- Command policy separates safe, review-required, and forbidden operations.
- Task capabilities limit tools, paths, domains, risk, expiry, and action count.
- Protected execution returns `allow`, `ask`, or `deny` with hash-linked evidence.
- Zero-trust MCP checks server identity, permissions, network access,
  credentials, timeouts, and rate limits.

### Lifecycle and evidence

- Replay the same recorded repository task across Claude Code and Codex, then
  compare outcomes, trajectory, latency, cost, and action counts offline.
- Generate a concise PR evidence package with task scope, changed files,
  approval match, checks, receipt verification, and remaining uncertainty.
- Measure review accuracy, severity calibration, duplicates, actionable
  findings, accepted fixes, latency, and escaped defects without rewarding
  comment volume.
- Run a mandatory final implementation review before handoff. It checks
  requirements, security, code quality, failure paths, error handling,
  production readiness, and trade-offs. The agent fixes approved findings,
  verifies them, and reviews again until a fresh cycle passes; the report keeps
  every cycle, finding, fix, residual risk, and blocker.
- Read-only `status`, `doctor`, and managed `diff` commands.
- Dry-run bootstrap, update, uninstall, and tool-install planning.
- Migration-safe `update --apply` with backups, rollback, and conflict evidence.
- Approved memory with provenance and stale-state handling.
- Behavioral safety evaluations and an SPDX SBOM.
- Final task reports covering acceptance progress, checks, remaining work,
  blockers, Git state, token usage, estimated API-equivalent cost, and
  fail-closed readiness.

## Quick start

Run these commands inside a Git repository:

```bash
# See what will be installed
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --dry-run

# Install the governed workflow
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --preset governed

# Check the installation and view available workflows
npx --yes @hunpeolabs/ai-agent-kit@latest doctor
npx --yes @hunpeolabs/ai-agent-kit@latest prompts
```

Run the package without a command to use the interactive menu:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest
```

Use `npx` if you do not want to keep the package as a dependency. Running
`npm install @hunpeolabs/ai-agent-kit` also imports the governed workflow, but
keeps the package in `package.json` and `node_modules`.

## Latest release: v0.6.1

Version `0.6.1` helps agents improve writing and website growth without making
up proof, flattening the author's voice, or crossing protected publish,
messaging, tracking, and spend boundaries.

### Human writing without invented authenticity

The new `humanize-writing` skill edits posts, articles, emails, and marketing
copy while preserving meaning, attribution, authorship, and factual claims. It
can mirror a task-local voice sample, but it does not invent personal
experience, promise AI-detector evasion, or claim that text is provably human.

Progressive references keep voice guidance and common model-language patterns
available without loading them into every task.

### Evidence-based website growth

The new website-growth workflow connects context, positioning, page strategy,
SEO/GEO, design, motion, measurement, and iteration. Marketing briefs, claim
ledgers, measurement plans, experiment records, and review artifacts make
assumptions and missing evidence visible.

When a baseline or source of truth is missing, the workflow reports
`NOT_MEASURED` instead of presenting an estimate as a result. Dark patterns,
fabricated proof, invasive tracking, and unapproved publish, send, spend, or
analytics changes remain blocked.

### Portable, bounded skill resources

Canonical skill references now synchronize across Agents, Claude Code, Cursor,
Windsurf, and Cline alongside each `SKILL.md`. Bootstrap and maintenance
scripts reject symlink traversal, path escape, unsupported resource types, and
unbounded resource count or size.

Quality-profile validation also catches malformed quoted YAML and unsupported
explicit tags, with full safe-parser validation when PyYAML is available.

[Read the v0.6.1 release notes](https://github.com/phamhungptithcm/ai-agent-kit/releases/tag/v0.6.1)
or see the [full changelog](CHANGELOG.md).

## Daily use

Build a focused context pack for a task:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest context compile --id TASK-123 --budget 12000
npx --yes @hunpeolabs/ai-agent-kit@latest context inspect --id TASK-123
```

Review the final task report:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest runtime task report --id TASK-123 --format compact
```

Replay an offline evaluation or generate PR evidence:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest eval replay --fixture path/to/case.json
npx --yes @hunpeolabs/ai-agent-kit@latest evidence pr-package --id TASK-123
```

Update an existing installation safely:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest update --dry-run
npx --yes @hunpeolabs/ai-agent-kit@latest update --apply
```

Local edits are preserved. Non-overlapping changes can merge automatically;
conflicts stay untouched and are written to `.ai-agent-kit/conflicts/` for
review. Updates do not run Git commands.

## Supported agents

The kit currently ships adapters for:

- Claude Code and OpenAI Codex
- GitHub Copilot
- Cursor and Windsurf/Cascade
- Gemini CLI and Amazon Q Developer
- JetBrains Junie
- Cline, Devin, Aider, and Continue

All adapters share the same `.ai/` policy source. Install all of them, or only
the ones your team uses:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --agents all
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --agents codex,copilot,cursor
```

See [Agent Adapter Strategy](docs/AGENT_ADAPTER_STRATEGY.md) for details.

## Safety

- Critical operations are never autonomous.
- Protected actions return `allow`, `ask`, or `deny` with a reason.
- Production, infrastructure, database, release, Git, messaging, destructive,
  and secret operations still require explicit human approval.
- Runtime evidence excludes prompts, responses, source content, raw command
  output, credentials, secrets, and chain-of-thought.
- CodeGraph and CocoIndex are optional. If either is unavailable, the kit uses
  bounded native repository evidence in `DEGRADED` mode instead of blocking
  work or claiming full indexed coverage.
- A repository report does not prove that an undeployed system is ready in its
  live environment.

## How the kit evolved

| Version | Main additions |
| --- | --- |
| `0.1.0` | Local bootstrap, Claude and Codex setup, repository intelligence, backups, and validation. |
| `0.2.0` | Stack-aware quality profiles, SEO/GEO, design taste, animation engineering, lifecycle inspection, ownership protection, and packed smoke tests. |
| `0.3.0` | Governed runtime, approval-to-diff checks, command policy, capabilities, evidence receipts, approved memory, telemetry, evaluations, MCP trust contracts, and SBOM. |
| `0.4.x` | Clearer adoption flow, optional-index `DEGRADED` mode, interactive activation, and governed `npm install` import. |
| `0.5.0` | Migration-safe updates, deterministic task context, and adapters for 12 coding agents. |
| `0.6.0` | Execution-bound action gateway, zero-trust MCP broker, token/cost usage ledger, and evidence-driven final task reports. |
| `0.6.1` | Human writing integrity, evidence-based website growth, portable skill references, and hardened resource synchronization. |
| `0.7.0` | Replayable cross-agent evals, evidence-native PR packages, regression gates, and high-signal review measurement. |

## Documentation

- [Adoption Guide](docs/ADOPTION_GUIDE.md)
- [High-Level Design](docs/HIGH_LEVEL_DESIGN.md)
- [Runtime Enforcement and MCP Trust](docs/RUNTIME_ENFORCEMENT_AND_MCP_TRUST.md)
- [Code Quality Intelligence](docs/CODE_QUALITY_INTELLIGENCE.md)
- [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Development

```bash
npm ci
npm run check
npm run release:dry-run
```

The goal is simple: give AI agents enough context and freedom to be useful,
while keeping important decisions and risky actions in human hands.

## License

[MIT](LICENSE)
