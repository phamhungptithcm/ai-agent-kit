# Implementation Approval Record

Plan ID/version: AAK-PRODUCT-GENESIS-AUTO-ENTRY-V161

Repository intelligence gate status: DEGRADED — the main checkout indexes were
stale and the isolated exact-tag clone had no CodeGraph or CocoIndex data.
Implementation therefore used bounded source, Git tag, configuration, runtime,
test, and adapter evidence as permitted by the Repository Intelligence fallback.

Approval status: APPROVED

Approver: repository owner (`hunpeo97`)

Approval timestamp or task reference: explicit approval in the active Codex
task to implement the reviewed Product Genesis Auto Entry design as version
`1.6.1`.

Approved scope:

- Start from the released `v1.6.0` tag and keep the change in `v1.6.1`.
- Add a Conversation Entry Gate before Repository Intelligence.
- Detect natural Vietnamese and English raw product ideas without requiring the
  user to name Product Genesis, v1.6, or a skill.
- Discover and safely resume one active Product Workspace; require confirmation
  for multiple products, conflicting intent, or starting a new product beside
  an active one.
- Route governed task creation through `run-product-genesis` for high-confidence
  product intent while preserving existing-system routing.
- Add CLI, configuration, evaluation, benchmark, adapter instructions,
  documentation, tests, package metadata, and generated assets.

Required constraints:

- Detection is local, deterministic, bounded, explainable, and network-free.
- Routing output and evidence must not repeat or persist the raw user request.
- Auto-entry selects a workflow only. It does not approve artifacts, authorize
  implementation, create GitHub issues, commit, push, deploy, publish, or release.
- Existing named-human exact-hash Product Genesis gates remain unchanged.
- Multiple, invalid, or conflicting workspace state fails closed.
- Host enforcement claims must match actual adapter capability. Instruction-only
  hosts remain advisory.
- Add no new runtime dependency or hosted service.
- Update canonical `.ai/skills-src` and regenerate adapter mirrors; do not edit
  generated skill copies directly.
- Do not commit, push, open a pull request, tag, publish, or deploy without
  separate authorization.

Approved paths:

- `assets/enterprise-ai-agent-os/**`
- `src/**`
- `dist/**`
- `scripts/**`
- `test/**`
- `docs/**`
- `README.md`
- `CHANGELOG.md`
- `package.json`
- `package-lock.json`

Delta approval is required for a new dependency, external prompt service,
credential flow, production mutation, autonomous approval, or change outside
the listed scope.
