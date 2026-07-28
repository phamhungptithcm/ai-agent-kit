# Repository Intelligence Guide

This repository prefers CodeGraph and CocoIndex for efficient, auditable evidence. Neither tool is a single point of failure: missing, stale, unhealthy, or failed installation produces `DEGRADED` mode with a bounded native-inspection fallback.

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
READY / DEGRADED
```

## Agent Behavior

Agents query CodeGraph first for structure and impact, then CocoIndex for semantic retrieval and documentation when available, and verify critical facts against source. The Team Lead Orchestrator creates a shared brief before assigning specialist agents. Specialist agents reuse that brief and only query indexes for role-specific gaps.

When the gate is degraded, agents attempt recovery once, then continue with `rg --files`, `rg`, targeted source and documentation reads, Git history, compiler or language-server diagnostics, and relevant tests. They must record missing evidence and avoid unsupported completeness or blast-radius claims. Human approval and critical-change gates remain fail-closed.

## Sensitive Data Exclusions

Both indexes must exclude local indexes, generated caches, build outputs, logs, coverage, test reports, secrets, credentials, tokens, private keys, production data, downloaded customer data, CVV, and unmasked PAN. The authoritative pattern list lives in `.ai/guards/repository-intelligence-gate.yaml`.
