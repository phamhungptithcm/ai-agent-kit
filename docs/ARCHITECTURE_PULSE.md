# Native Architecture Pulse

Architecture Pulse is AI Agent Kit's local, deterministic structural sensor. It helps a team review whether a change improved repository structure, kept it stable, or introduced a named regression without pretending that one score can understand an entire architecture.

## Why it exists

Tests prove selected behavior, linters enforce local conventions, and reviews inspect a change. Those checks can all pass while dependency cycles, cross-boundary imports, graph depth, hotspots, or blast radius quietly grow. Pulse makes those signals reviewable and binds the evidence to repository state.

Pulse is a clean-room, first-party module. It does not copy, vendor, invoke, wrap, or depend on Sentrux code, packages, binaries, services, assets, telemetry, or runtime behavior.

## Workflow

```text
Git inventory → bounded source scan → language extractors → dependency graph
             → versioned metrics → trusted baseline → explicit policy rules
             → task report / Change Passport evidence
```

The scanner uses `git ls-files --cached --others --exclude-standard`, normalizes repository-relative paths, refuses symlinks and hard links, enforces file and byte budgets, and never reads outside the repository. Generated, vendored, binary, oversized, unsupported, unreadable, and excluded files remain visible as coverage evidence.

Initial extractors cover JavaScript/TypeScript, Python, Go, Rust, Java/Kotlin, and C#. Resolution stays within one language ecosystem by default. A cross-language edge exists only when configuration names both inventoried files explicitly.

## Commands

Run a read-only scan:

```bash
ai-agent-kit pulse scan --format text
ai-agent-kit pulse scan --output .ai-agent-kit/pulse/results/latest.json
```

Create and verify a trusted baseline:

```bash
ai-agent-kit pulse baseline create --config pulse.json
ai-agent-kit pulse baseline verify --config pulse.json
```

Compare the current repository with the baseline:

```bash
ai-agent-kit pulse check --config pulse.json --format text
ai-agent-kit pulse explain --file .ai-agent-kit/pulse/results/comparison.json
```

Bind evidence to a governed task:

```bash
ai-agent-kit pulse check --task-id TASK-123 --config pulse.json
```

This writes `.ai-agent-kit/pulse/tasks/TASK-123.json`. A final task report accepts the artifact only when its digest is valid and its task binding matches. A Change Passport can include it explicitly with `--pulse-result`.

## Configuration

```json
{
  "schema_version": 1,
  "exclude": ["fixtures/generated"],
  "boundaries": [
    {
      "name": "domain-must-not-depend-on-ui",
      "from": "src/domain",
      "deny": ["src/ui"]
    }
  ],
  "bridges": [
    {
      "id": "explicit-service-contract",
      "from": "web/client.ts",
      "to": "service/api.py"
    }
  ],
  "rules": [
    {
      "id": "no-new-cycles",
      "type": "new-cycles",
      "threshold": 0,
      "severity": "block"
    }
  ]
}
```

Supported rule types are `new-cycles`, `boundary-violations`, `depth-increase`, `cohesion-loss`, `hotspot-growth`, `blast-radius-growth`, `coverage-drop`, and `confidence-drop`. Severity is `info`, `warning`, or `block`. Blocking is opt-in; the diagnostic Pulse index never blocks by itself.

## Outcomes and exit codes

| Outcome | Meaning | CLI exit |
| --- | --- | --- |
| `IMPROVED` | One or more configured signals improved and none regressed | `0` |
| `STABLE` | No configured signal changed beyond its threshold | `0` |
| `REGRESSED` | At least one configured rule regressed | `0`, or `2` when a violated rule is `block` |
| `STALE` | Baseline semantics or configuration are not comparable | `3` |
| `UNTRUSTED` | Integrity or repository binding failed | `3` |
| `DEGRADED` | Analysis evidence is incomplete or low confidence | `3` |

## Metrics and evidence

Pulse computes strongly connected components, condensation DAG depth across all roots, module cohesion, configured boundary violations, fan-in/fan-out hotspots, and bounded reachable-dependent blast radius. Each result contains units implied by the named metric, semantic versions, supporting graph evidence, coverage, confidence, repository identity, commit/branch/dirty state, source/config digests, and a canonical result digest.

Baselines are reviewable JSON documents bound to repository identity, source and configuration digests, analyzer versions, repository state, and optional plan/approval provenance. Integrity is checked before comparison. Source changes are expected; foreign repository identity, changed analysis configuration, incompatible metric semantics, or a changed baseline payload fail closed.

Task reports and Change Passports also compare the artifact's commit and privacy-minimized worktree digest with the current repository. A formerly valid artifact becomes `STALE` after source drift; Pulse's own `.ai-agent-kit`, CodeGraph, and CocoIndex state is excluded from that digest.

## Limits

- Static extraction cannot see every dynamic import, reflection target, generated dependency, runtime route, framework convention, or data dependency.
- Unsupported and partially parsed source reduces coverage and confidence.
- A passing Pulse policy is not production readiness and does not replace human architecture review.
- Hotspot and blast-radius values describe the extracted graph, not every runtime failure path.
- Blast radius is exact through 2,000 graph nodes. Larger graphs use a deterministic 200-node sample combining high-degree and repository-wide nodes, report `blast_radius_complete: false`, and return `DEGRADED` instead of presenting sampled evidence as complete.
- A baseline is never written from `DEGRADED` evidence. Raise the configured limits only within their hard caps or reduce the included scope, then review and create a new baseline.
- Baselines must be recreated deliberately when analysis configuration or metric semantics change.
- Pulse has no hosted service, implicit network access, telemetry, or automatic rewrite capability.

Start in diagnostic mode. Add blocking rules only after the team has reviewed representative results, chosen thresholds, and accepted the baseline.
