# Repository Intelligence Guide

This repository requires CodeGraph and CocoIndex before agents begin repository work. The gate prevents broad, duplicate repository scans and makes impact analysis auditable.

## One-Time Bootstrap

Windows PowerShell:

```powershell
.ai\scripts\bootstrap-repository-intelligence.ps1
```

Git Bash, macOS, or Linux:

```bash
.ai/scripts/bootstrap-repository-intelligence.sh
```

The bootstrap detects OS and architecture, checks runtimes, verifies tool identities, installs missing user-local tooling, configures local indexes, builds or refreshes indexes, and runs the health check. It does not modify application code.

## Manual Commands

CodeGraph is the verified `@colbymchenry/codegraph` package:

```bash
npx @colbymchenry/codegraph
codegraph init
```

CocoIndex Code is the verified `cocoindex-code[full]` package:

```bash
uv tool install --upgrade "cocoindex-code[full]"
ccc index
```

Check the gate:

```bash
python .ai/scripts/check-repository-intelligence.py
```

Refresh existing indexes after local changes:

```bash
python .ai/scripts/refresh-repository-index.py
```

## Expected Status

The gate prints:

```text
Repository Intelligence Gate

CodeGraph:
- Installation:
- Version:
- Configuration:
- Index status:
- Health check:

CocoIndex:
- Installation:
- Version:
- Configuration:
- Index status:
- Health check:

Repository commit:
Indexed commit:

Gate result:
READY / BLOCKED
```

## Agent Behavior

Agents must query CodeGraph first for structure and impact, then CocoIndex for semantic retrieval and documentation, then verify critical facts against source. The Team Lead Orchestrator creates a shared brief before assigning specialist agents. Specialist agents reuse that brief and only query indexes for role-specific gaps.

When the gate is blocked, agents may troubleshoot setup only. They must not analyze tickets, plan changes, review code, perform QA analysis, update docs, or edit application files.

## Sensitive Data Exclusions

Both indexes must exclude local indexes, generated caches, build outputs, logs, coverage, test reports, secrets, credentials, tokens, private keys, production data, downloaded customer data, CVV, and unmasked PAN. The authoritative pattern list lives in `.ai/guards/repository-intelligence-gate.yaml`.
