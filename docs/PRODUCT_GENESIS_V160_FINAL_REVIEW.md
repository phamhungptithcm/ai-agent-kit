# Product Genesis v1.6.0 Final Review Record

Review date: 2026-08-20

Approved scope: local integration, commit, push, two draft pull requests, and
non-publishing CI dispatch; concurrent Product Content WIP excluded.

Reviewed base: `c9f2cb984fa6a648a76c9f36de243ca07e9dd9f7`

Reviewed implementation commit: `822e1aa0e27a26f9691f33af868279113931f5ff`

## Result

Implementation review status: `PASSED`

Draft-PR readiness: `READY`

Publishing and production status: `BLOCKED`

No unresolved security or final-implementation-review finding remains in the
reviewed implementation. This decision authorizes no merge, tag, GitHub
Release, npm publication, deployment, or production activation. Supported CI
and the non-publishing release workflow must still pass on the updated pushed
branches.

## Reviewed dimensions

- approved idea-to-production scope, v1.5 ancestry, compatibility, and explicit
  Product Content WIP exclusion;
- discovery, Alpha, investment, BRD, specification, design, delivery,
  iteration, production, operation, outcome, and retirement artifacts/gates;
- evidence and environment identity, forge and commit binding, expiry, file
  hashes, provider adapters, tamper detection, and stale propagation;
- GitHub preview/apply authority, human approval, repository trust, member
  identity, role, capability, signature binding, nonce replay, duplicate
  protection, partial results, and reconciliation;
- path, symlink, hard-link, secret-like content, size, state, event, and
  concurrency limits;
- canonical skills, generated agent adapters, routing, capability coverage,
  package build, SBOM, packed install, operator guidance, and release claims;
- product language meaning, state coverage, all eight Human Interface
  principles, cross-platform CLI/Markdown fit, accessibility, localization,
  privacy, and limitations.

## Findings resolved

| ID | Severity | Finding | Resolution and verification |
| --- | --- | --- | --- |
| PGSEC-001 | Medium | Caller-entered approval identity could reach external GitHub issue creation without authenticated human/operator write authority. | Apply now requires the exact current plan approval plus a repository-trusted Ed25519 `MEMBER`, `operator` or `team-lead` role, `product.github.write`, exact repository/product/operation/target/plan binding, and a durable one-use nonce before any remote call. Missing authority, non-member identity, and replay tests pass. |
| PGSEC-002 | Low | Repository remote normalization discarded forge hostname, allowing GitHub and GitLab repositories with the same owner/path to collide. | Canonical binding now preserves hostname, optional port, and repository path. HTTPS and SCP forms for the same GitHub repository match; GitHub versus GitLab is rejected by an adversarial test. |
| PGSEC-003 | Low | Lexical Windows path equality initially fixed separator and drive-letter variance but could conflate distinct objects inside a case-sensitive Windows directory. | Existing repository, Git-common-directory, and worktree paths now bind through native realpath plus filesystem device/inode identity and fail closed when identity cannot be resolved. Equivalent and distinct directory tests pass. |

## Verification evidence

- `npm run check`: passed, including lint across 126 files, typecheck across 119
  files, `262/262` tests, Product/Pulse/system-design/team/routing/memory evals,
  adapter conformance, canonical evidence verification, supply-chain checks,
  build, and packed-install smoke.
- v1.5.0 `npm run check`: passed with `253/253` tests after the shared
  filesystem-identity hardening.
- Canonical Product Genesis capability coverage: 58 skills, 32 routed skills,
  56 required artifacts, and two provenance-locked external sources.
- Routing fixture: `50/50` passed with accuracy and coverage 1.0 and false
  positive rate 0.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `npm pack --dry-run`: v1.6.0, 1,085 files, about 1.2 MB packed and 4.4 MB
  unpacked.
- Local 100-iteration Product Workspace benchmark: read p95 4.665 ms, dossier
  p95 1.139 ms, mutation p95 7.393 ms. It excludes model, network, provider,
  reviewer, and GitHub latency and is not a production SLO.
- Codex Security diff scan
  `877a4f59-d53e-4567-879b-536d9acb586f`: 102/102 authoritative review rows
  closed, complete coverage, zero findings on `88eb8c6..eb2b956`.
- Codex Security incremental diff scan
  `1714224e-7678-4e89-a6dc-34fd948f4d89`: 4/4 executable source rows closed,
  complete coverage, zero findings on `903c257..822e1aa` after the Windows
  filesystem-object identity hardening.
- Governed final-review ledger: all seven required dimensions passed; all three
  findings are recorded as fixed; no unresolved finding remains.
- Product Content review: all eight mandatory Human Interface principles and
  every applicable CLI/Markdown state passed source-and-runtime review.

## Current draft-release state

- Draft PR #107 targets `main` from `hunpeolabs/release-v1.5.0`.
- Draft PR #108 is stacked on `hunpeolabs/release-v1.5.0` from
  `hunpeolabs/release-v1.6.0`.
- Earlier non-publishing runs passed Node 20, Node 24, and macOS but exposed a
  Windows canonical-path failure. The updated fix is locally verified; fresh
  CI evidence on the exact pushed commits remains required.

## Remaining release gates

- Push the updated v1.6.0 candidate and keep both pull requests in draft.
- Pass supported Node/OS CI and fresh explicitly non-publishing workflows on
  the exact final pushed commits; `publish=false` must continue to skip npm.
- Release owner reviews limitations, package contents, CI evidence, and stacked
  merge order.
- After separate authorization only: merge, tag the exact merge SHA, create the
  GitHub Release, publish npm with provenance, verify `gitHead` and tarball
  integrity, and perform any deployment or production activation.

## Honest boundaries

- No live GitHub issue was created during review; the provider boundary was
  exercised with injected adapters and packed/local runtime tests.
- A human repository owner must provision the trusted public key and keep its
  private key outside agent-visible context.
- TAC advisory status was unavailable because the Codex Security access
  connector was not connected; this did not authorize or gate the scan.
- Local and synthetic evidence does not prove customer demand, legal approval,
  provider behavior, deployed availability, production capacity, or live
  business outcomes.
