# Traceable Plugin Runtime Security Review

## Executive summary

The v1.1/v1.2 traceability and plugin surfaces were reviewed as a local Node.js
CLI handling untrusted manifests, repository paths, append-only ledgers,
portable bundles, and derived HTML. No unresolved critical or high-severity
finding remains in the reviewed scope. The implementation is fail-closed for
tampering, path/symlink escape, permission expansion, forged lifecycle state,
unsafe resume, and sensitive trace content.

This review does not prove a third-party plugin is safe, replace an independent
penetration test, or authorize publication.

## Resolved findings

### SEC-001 · High · Plugin provenance was initially declarative

Impact: a malicious manifest could have claimed a checksum or signature without
cryptographic verification.

Resolution: activation now recomputes the canonical payload checksum, verifies
the Ed25519 signature, and requires the signing key to be enrolled for the
plugin ID, publisher, and declared surfaces before returning `VERIFIED`.
Invocation rechecks provenance and quarantines a plugin when verification no
longer passes.

### SEC-002 · High · Plugin state needed receipt binding

Impact: editing the local state document independently could have made an
unapproved plugin appear active.

Resolution: effective state must match the latest verified lifecycle receipt,
manifest hash, and approval reference (`src/plugin-runtime.mjs:150`). Forged or
drifted state is quarantined before authority is granted.

### SEC-003 · High · Repository path and symlink escape

Impact: a crafted manifest, output, or local plugin directory could read or
write outside the repository boundary.

Resolution: manifest inputs and generated outputs require contained,
non-symlinked repository paths (`src/plugin-runtime.mjs:21`,
`src/traceability.mjs:255`). Plugin state and receipt paths verify every path
component before access.

### SEC-004 · Medium · Concurrent append writers

Impact: two processes could calculate the same monotonic offset and break the
ledger chain.

Resolution: decision, run, and plugin receipt writers acquire an exclusive
local writer lock and fail explicitly on contention (`src/traceability.mjs:77`,
`src/plugin-runtime.mjs:76`). Existing chains are verified before append.

### SEC-005 · Medium · Sensitive values in otherwise allowed fields

Impact: a rationale, finding, or next action could have contained a credential
even when its key name was harmless.

Resolution: trace records reject private keys, common provider credentials,
bearer tokens, secret assignments, and email identifiers before persistence
(`src/traceability.mjs:10`). Portable bundles re-chain redacted records and hash
actor identity (`src/traceability.mjs:268`).

### SEC-006 · Medium · Permission expansion at invocation time

Impact: install-time approval alone could allow a plugin to request broader
filesystem, process, network, MCP, hook, or external-action authority later.

Resolution: every invocation intersects requested permissions with the manifest
and a signed capability ceiling. Capabilities are issuer-trusted, expiring,
single-use, and bound to plugin, task, run, approval, and policy. Any unmatched
permission returns `DENIED`; unsafe paths and domain patterns are rejected
before lifecycle evaluation.

### SEC-007 · High · Self-signed plugin could establish its own trust

Impact: a plugin could sign its manifest with a key shipped in that same
manifest and be labeled `VERIFIED` without an independent trust decision.

Resolution: cryptographic validity and trust are separate states. A signing key
must match an explicit repository enrollment scoped to key ID, plugin ID,
publisher, and surfaces. Valid but unenrolled signatures are
`UNTRUSTED_SIGNER`, cannot activate, and are quarantined if already installed.

### SEC-008 · High · Caller-controlled invocation authority

Impact: a caller could provide both requested permission and its alleged policy
ceiling, allowing authorization without a valid delegated capability.

Resolution: caller-authored ceilings are rejected. Authorization requires a
trusted issuer signature over the full capability body and atomically consumes
the token so concurrent replay cannot produce a second `ALLOWED` receipt.

### SEC-009 · Medium · Untracked files were absent from resume drift

Impact: a run could resume against new, untracked context that did not exist at
the checkpoint.

Resolution: each run event now records a deterministic worktree signature over
the tracked binary diff and bounded untracked-file metadata/content. Local
`.ai-agent-kit` evidence is excluded to prevent the ledger from invalidating
itself. Resume blocks when that signature changes.

### SEC-010 · Low · Trust Center could remain healthy with unverified plugins

Impact: the aggregate health label could hide incomplete or unenrolled plugin
trust evidence.

Resolution: `UNVERIFIED` and `UNTRUSTED_SIGNER` both count as unverified health;
either forces aggregate status to `ATTENTION`.

## Residual limitations

- Plugin code is not executed by this implementation. A future executable
  sandbox requires a separate threat model and approval.
- SBOM presence is provenance metadata; package-to-SBOM component verification
  remains a release/conformance responsibility.
- Local files can be deleted by the repository owner. Deletion is reported as
  missing evidence; this system does not claim tamper-proof remote retention.
- `.aakrun` v1 provides content integrity and an explicit `UNSIGNED` trust
  state. Cross-organization signing and trust-store policy remain future work.
- Secret-pattern rejection is intentionally conservative but cannot detect
  every possible private identifier. Users must still avoid entering sensitive
  content in decisions and run summaries.

## Verification coverage

Automated tests cover hash tampering, offset races, secret-like content,
symlink paths, repository escape, unsigned and invalid provenance, Ed25519
verification, unenrolled self-signatures, manifest drift, forged lifecycle
state, missing/expired/replayed capabilities, excessive authority, tracked and
untracked unsafe resume, Trust Center fail-closed health, bundle tampering,
synthetic-evidence labeling, and package-state leakage. Full project checks also
include supply-chain validation, adapter conformance, eval gates, build, and
packed npm smoke.
