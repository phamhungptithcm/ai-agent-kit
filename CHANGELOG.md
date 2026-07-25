# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
