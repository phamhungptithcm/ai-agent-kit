# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
