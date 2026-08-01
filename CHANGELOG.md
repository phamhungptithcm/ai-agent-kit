# Changelog

All notable changes to this project will be documented in this file.

## 0.6.1 - 2026-08-01

- Added a cross-agent `humanize-writing` skill with progressive-disclosure
  pattern and voice references, meaning-preserving rewrite rules, and a
  dedicated human-writing quality profile.
- Extended canonical skill synchronization, bootstrap, validation, and
  ownership tracking so bundled text references ship with generated skills.
- Added an original evidence-based website marketing skill with discover, plan,
  implement, experiment, measure, and audit modes composed with SEO/GEO,
  design, animation, accessibility, privacy, and governed external actions.
- Added marketing context, brief, claim ledger, experiment, and review
  artifacts, plus integrity rules, quality checks, and golden cases for proof,
  message match, dark patterns, measurement, attribution, consent, low-traffic
  experiments, localization, and external publish/send/spend boundaries.
- Hardened canonical skill-resource synchronization against source and
  destination symlinks, path escape, unsupported resource types, and unbounded
  file count or size.
- Fixed malformed Java and frontend HTML/CSS quality-profile YAML and added
  fail-closed YAML validation with optional full-parser verification.

## 0.6.0 - 2026-07-31

- Added an evidence-derived final task report with weighted acceptance progress,
  completed and remaining work, commit-bound quality gates, Git cleanliness,
  scoped known-issue language, fail-closed production readiness, and blockers.
- Added privacy-minimized token usage recording for provider responses, adapter
  telemetry, cumulative sessions, deduplicated events, OpenAI and Anthropic
  cache semantics, exact model pricing, and explicit estimated, partial, or
  unavailable cost states.
- Added `runtime criterion record`, `runtime check record`, `runtime usage
  record|summary`, and `runtime task report` text, compact, and JSON surfaces,
  plus cross-agent completion guidance and fail-open Claude/Codex stop hooks.
- Added a universal action gateway that normalizes each protected action,
  enforces capability and policy at the execution boundary, invalidates stale
  authorization, and records privacy-minimized decision, execution, and
  verification receipts with stable reason codes.
- Added a deny-by-default MCP broker with exact server identity, scoped tools,
  filesystem and network boundaries, timeouts, persistent rate limiting,
  credential isolation and redaction, registry-drift review, and offline
  security fixtures for prompt injection, SSRF, token passthrough, and unsafe
  local startup.
- Routed Claude Code and Codex tool hooks through the same optional governed
  gateway while preserving normal bootstrap behavior when no governed task is
  active.
- Added runtime and MCP CLI surfaces, canonical workflows and generated skills,
  adapter guidance, validator coverage, and architecture documentation.

## 0.5.0 - 2026-07-29

- Added migration-safe `update --apply` with deterministic three-way decisions,
  dry-run parity, local-edit preservation, conflict evidence, backups,
  transaction journals, rollback, path/symlink protection, and machine-readable
  reports.
- Added a task-aware context compiler with deterministic selection, mandatory
  policy, approved memory, provenance, token budgets, JSON/Markdown output, and
  fail-closed READY semantics for stale repository intelligence.
- Added v0.1.0-v0.4.0 lifecycle compatibility coverage and fault-injection tests.
- Added a registry-driven adapter contract and `--agents <list|all>` selection for the next release while keeping the legacy `--claude-only` and `--codex-only` flags.
- Added next-release adapters for GitHub Copilot, Cursor, Windsurf/Cascade, Gemini CLI, Amazon Q Developer, JetBrains Junie, Cline, Devin, Aider, and Continue.
- Expanded generated skill synchronization, ownership tracking, status/doctor output, validation, documentation, and packed-package coverage across supported agent surfaces.

## 0.4.2 - 2026-07-28

- Added an interactive activation menu for previewing or importing the governed/full kit, with non-interactive command guidance and cleanup instructions for persistent npm installs.
- Added top-level project `postinstall` activation so `npm install @hunpeolabs/ai-agent-kit` imports the governed kit while transient `npx`, global, and repeated installs remain bounded.

## 0.4.1 - 2026-07-27

- Fixed repository-intelligence path normalization so `.ai/local/repository-intelligence-state.json` no longer invalidates its own worktree signature and makes healthy indexes appear stale.
- Changed missing, stale, unhealthy, or un-installable CodeGraph/CocoIndex from a hard blocker to an explicit `DEGRADED` mode with bounded native repository evidence.
- Preserved fail-closed human approval, sensitive-data, and critical-change protections while adding regression coverage for state stability and optional-index fallback.

## 0.4.0 - 2026-07-26

- Reworked the README for adoption and search discovery with a conversion-first hero, proof-oriented demo asset, outcome-led use cases, shipped-versus-roadmap support, a concise operating-model comparison, and role-based documentation paths.
- Added complete, provenance-correct release highlights from `0.1.0` through `0.4.0`.
- Expanded npm package description and keywords for accurate AI coding agent, Claude Code, Codex, repository-intelligence, and AI-governance discovery.

## 0.3.0 - 2026-07-26

- Added executable approval-to-diff validation, protected-edit and command-policy hooks, offline behavioral safety evaluations, and explicit repository-maintainer governance ownership.
- Added a deterministic governed runtime with sequential task states, transition evidence, task-scoped capabilities, expiry, action budgets, risk ceilings, and stable policy reason codes.
- Added privacy-minimized hash-linked action receipts, OpenTelemetry-compatible JSONL spans, independent evidence verification, and evidence export.
- Added MCP trust registry, sandbox and secret-broker contracts, four governance maturity profiles, capability/evidence templates, and a governed-runtime skill.
- Added an SPDX 2.3 SBOM to built and published packages and expanded runtime, policy, tamper-detection, and behavioral regression coverage.
- Added goal contracts, sourced facts, explicit assumptions, adaptive plan revisions, human-approved provenance-aware memory, and deterministic task-intelligence scoring.

## 0.2.0 - 2026-07-25

- Added an evidence-based SEO/GEO quality profile, mandatory public-web rules, a plan/implement/audit skill, review template, workflow, prompt, and Web Growth Engineer adapters.
- Added SEO/GEO golden cases covering metadata, raw HTML discoverability, schema fabrication, hreflang, crawler-policy separation, `llms.txt` claim boundaries, and private-route exclusions.
- Added context-aware visual-design rules and quality profile, a four-mode design-taste skill, design brief/direction/review/state artifacts, public-website workflow composition, and Web Growth Engineer integration.
- Added visual-design golden cases for generic AI layouts, design-system preservation, surface classification, regulated services, audit-first redesign, reference boundaries, motion, responsive states, localization, contrast, SEO/content integrity, evidence claims, and fabricated trust signals.
- Added animation-integrity rules, a motion-engineering quality profile, a five-mode animation skill, motion brief/contract/inventory/review artifacts, public-website workflow composition, and Web Growth Engineer integration.
- Added animation golden cases for purpose, frequency, explicit properties, timing, stale completion, resource cleanup, compositor layers, under-load performance, touch, gestures, reduced motion, persistent and scroll motion, stagger, focus, View Transitions, dependencies, compatibility, evidence claims, surface fit, and static SEO content.

- Added read-only `status`, `doctor`, and managed `diff` lifecycle commands.
- Added preview-only `update --dry-run` and `uninstall --dry-run` commands.
- Added installation ownership metadata for future transactional lifecycle operations.
- Added SHA-256 ownership verification for generated files and kit-managed marker sections.
- Rejected ownership path traversal, oversized ownership targets, and writes through repository symlinks.
- Made `.ai/manifest.yaml` the canonical complete contract used by `status` and `doctor` to detect missing or drifted policy.
- Split global tool installation from bootstrap with read-only `tools plan` and explicit `tools install --apply`.
- Pinned CodeGraph and CocoIndex installation packages and fixed CocoIndex availability checks to use its supported `--help` command.
- Changed `--deep` to refresh available indexes without installing global tools.
- Upgraded repository detection to inspect bounded package, Java, Python, Go, and Flutter manifests and record detected versions.
- Aligned the npm executable with the built `dist/` artifact and added a packed-tarball `npx --yes` smoke test.
- Added macOS and Windows package smoke jobs while preserving the required Linux Node.js 20/24 validation jobs.
- Added explicit `governed` and `full` presets with the same quality contract.
- Derived CLI and bootstrap versions from `package.json` instead of hard-coded constants.
- Fixed single-adapter bootstrap so excluded adapter skills are not generated.
- Made bootstrap dry-run avoid creating local transaction directories.
- Added regression tests for quality-contract parity, lifecycle read-only behavior, adapter isolation, and version provenance.

## 0.1.0 - 2026-07-20

- Initial `@hunpeolabs/ai-agent-kit` package identity.
- Added local-only bootstrap CLI for Claude Code and Codex repository setup.
- Bundled enterprise AI-agent operating system scaffold.
- Added CodeGraph and CocoIndex repository-intelligence checks.
- Added safe managed-section merging, generated-file backups, rollback, and validation reports.
- Added GitHub Actions validation and npm trusted publishing workflow.
