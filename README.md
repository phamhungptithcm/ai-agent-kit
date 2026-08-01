# AI Agent Kit

[![npm version](https://img.shields.io/npm/v/@hunpeolabs/ai-agent-kit?color=cb3837)](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)
[![npm downloads](https://img.shields.io/npm/dm/@hunpeolabs/ai-agent-kit?label=downloads%2Fmonth&color=2563eb)](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)
[![CI](https://github.com/phamhungptithcm/ai-agent-kit/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/phamhungptithcm/ai-agent-kit/actions/workflows/npm-publish.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-43853d)](package.json)

One shared engineering workflow for AI coding agents.

AI Agent Kit adds repository rules, project context, quality checks, approval
gates, safe execution boundaries, and reviewable evidence. The same workflow
can be used across Claude Code, Codex, Copilot, Cursor, and other supported
agents.

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --dry-run
```

Bootstrap is local. It does not edit application code, commit, push, open a
pull request, update a ticket, or deploy.

[Features](#whats-included) · [Quick start](#quick-start) · [Latest release](#latest-release-v060) · [Supported agents](#supported-agents) · [Documentation](#documentation) · [npm](https://www.npmjs.com/package/@hunpeolabs/ai-agent-kit)

![AI Agent Kit bootstrap flow](https://raw.githubusercontent.com/phamhungptithcm/ai-agent-kit/main/docs/assets/bootstrap-demo.gif)

## Why use it?

Coding agents often work differently. One may skip repository context, another
may miss tests, and another may change more than requested.

AI Agent Kit gives them the same path:

```text
Understand → Inspect → Plan → Approve → Execute → Verify → Review
```

It helps teams keep scope clear, use project-specific rules, apply the right
quality checks, and review what happened afterward.

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

### Public website workflow

- SEO and GEO rules for metadata, canonical URLs, structured data, hreflang,
  crawl policy, raw HTML discoverability, and evidence-backed public claims.
- Design-taste guidance that adapts to the existing design system instead of
  replacing it with a generic AI-style layout.
- Animation guidance for purpose, timing, lifecycle cleanup, performance,
  touch input, gestures, reduced motion, and static SEO content.
- One Web Growth workflow that combines content, SEO/GEO, visual design,
  accessibility, motion, implementation, and review.

### Governance and safety

- Existing-system changes stop for a reviewed impact plan and explicit approval.
- Protected edits are checked against the approved paths and current diff.
- Command policy separates safe, review-required, and forbidden operations.
- Task capabilities limit tools, paths, domains, risk, expiry, and action count.
- Protected execution returns `allow`, `ask`, or `deny` with hash-linked evidence.
- Zero-trust MCP checks server identity, permissions, network access,
  credentials, timeouts, and rate limits.

### Lifecycle and evidence

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

## Latest release: v0.6.0

Version `0.6.0` focuses on safer execution and clearer completion reports.

### Actions are checked at execution time

Protected actions go through one gateway shared by Claude Code, Codex, the CLI,
and MCP tools. Approval is tied to the exact task, repository commit, policy,
agent, capability, and action. If any of those change, the old approval cannot
be reused.

Each decision, execution, and verification step creates a separate receipt.
The receipt keeps useful evidence without storing raw commands, file paths,
source, output, prompts, or secrets.

### MCP starts from zero trust

MCP servers are denied by default. A server must match its reviewed identity
before it can run. The broker also checks allowed tools, folders, domains,
timeouts, rate limits, and credentials.

Changed or expired server definitions are blocked, along with private-network
SSRF, prompt injection, token passthrough, and unsafe startup patterns.

### Final reports use evidence, not confidence

The final task report shows verified acceptance criteria, remaining work,
quality checks, blockers, Git state, token usage, and estimated API-equivalent
cost.

Missing or stale evidence cannot produce a `READY` result. Cost is clearly
marked as estimated, partial, or unavailable—it is never presented as the
provider's actual bill.

[Read the v0.6.0 release notes](https://github.com/phamhungptithcm/ai-agent-kit/releases/tag/v0.6.0)
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
