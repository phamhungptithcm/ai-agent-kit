# Traceable Plugin Runtime

AI Agent Kit treats chat as a temporary interface, not the durable record of
engineering work.

## Decision Chronicle

Every decision is a sequence of immutable events with a monotonic offset and
hash-chain link. A proposal records the question, chosen option, alternatives,
rationale, assumptions, approval reference, affected artifacts, run/task links,
and repository binding. Approval, rejection, supersession, revocation, and
invalidation append new events instead of editing history.

```bash
ai-agent-kit decision record \
  --decision-id DEC-42 \
  --actor "repository-owner" \
  --question "How should exports be persisted?" \
  --choice "atomic local file" \
  --alternative "direct stream" \
  --rationale "recover safely after interruption" \
  --artifact src/export.mjs

ai-agent-kit decision transition \
  --decision-id DEC-42 \
  --action approve \
  --actor "repository-owner" \
  --rationale "reviewed against the approved plan"
```

`ai-agent-kit why src/export.mjs:80` traverses only recorded provenance. It
returns `UNKNOWN` or `AMBIGUOUS` rather than inventing missing history.

## Run Envelope

Run events record repository/worktree/branch/commit binding, task and decision
references, context and plugin receipt hashes, checks, findings, blockers,
failed attempts, untried paths, and the next action. Raw prompts, source bodies,
secrets, credentials, personal data, and hidden reasoning are rejected.

```bash
ai-agent-kit run record --run-id RUN-42 --phase start \
  --actor codex --decision-id DEC-42 --next-action implement
ai-agent-kit run inspect --run-id RUN-42
ai-agent-kit run recovery --run-id RUN-42
ai-agent-kit run resume --run-id RUN-42
# After reviewing the preview:
ai-agent-kit run resume --run-id RUN-42 --apply --approval-ref APPROVAL-42
```

Recovery is non-destructive and preview-only. Repository, branch, commit,
parent baseline, policy, approval, and plugin drift block unsafe resume.

## Portable `.aakrun`

```bash
ai-agent-kit run export --run-id RUN-42 --output .ai-agent-kit/exports/RUN-42.aakrun
ai-agent-kit run verify --file .ai-agent-kit/exports/RUN-42.aakrun
```

The v1 bundle is deterministic JSON with a content hash and strict privacy
profile. Inspection is read-only. Import or resume always requires repository
reconciliation and separate mutation approval. Unsigned valid bundles are
reported as `UNSIGNED`, not silently trusted.

## Governed plugins

A plugin manifest declares surfaces, host capability states, permissions,
dependencies, conflicts, provenance, checksum, signature, and SBOM. Lifecycle
changes are previewable.

Activation verifies the manifest checksum and Ed25519 signature, then requires
the signing key to be enrolled for that exact plugin ID, publisher, and surface
set in `.ai/plugins/trusted-signers.json`. A valid self-signature is
`UNTRUSTED_SIGNER`; incomplete or invalid evidence is `UNVERIFIED` or
`REJECTED`.

```bash
ai-agent-kit plugin inspect --file plugin.json
ai-agent-kit plugin plan --file plugin.json --state active --adapter codex
ai-agent-kit plugin apply --file plugin.json --state active \
  --adapter codex --approval-ref APPROVAL-42
ai-agent-kit plugin trust
```

Each invocation recomputes effective authority as:

```text
manifest ∩ task ∩ adapter ∩ policy ∩ capability token ∩ human approval
```

The capability token is a signed, expiring, single-use envelope bound to the
plugin, task, run, approval reference, policy hash, nonce, and permission
ceiling. Its issuer must be enrolled in
`.ai/plugins/trusted-capability-issuers.json`. Callers cannot supply their own
policy ceiling.

Drifted or untrusted content is quarantined. The Trust Center reports
`ATTENTION` whenever a plugin is unverified, signed by an unenrolled key,
tampered, or quarantined. Publisher identity and popularity are never security
evidence.

## TraceLab

```bash
ai-agent-kit tracelab list
ai-agent-kit tracelab run --scenario production-bug
```

TraceLab executes deterministic offline scenarios for missed failure paths,
plugin escape attempts, parent drift, incomplete evidence, agent crashes, and
conflicting findings. The output uses real control states but remains clearly
marked as synthetic—not production proof.

## Observability

`ai-agent-kit run otel --run-id RUN-42` creates a local, redacted trace shaped
for OpenTelemetry GenAI conventions. External export is disabled by default.
Telemetry is derived and never becomes the canonical decision or run record.
