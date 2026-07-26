# Governed Agent Runtime

Natural-language instructions guide reasoning; executable controls authorize actions.

## Task States

`DISCOVER → ANALYZE → PLAN_READY → APPROVED → IMPLEMENTING → VERIFYING → REVIEW_READY → RELEASED`

Transitions are sequential and require machine-readable evidence. Approval is bound to a capability hash, base revision, exact paths, risk ceiling, expiry, and action budget. Agents cannot self-authorize, skip states, reuse expired approval, or elevate capability.

## Goal, Context, And Adaptive Plan

Every non-trivial task declares one goal and measurable acceptance criteria. Repository-backed facts record a source; assumptions remain explicitly separate and carry confidence. Plans are revisioned, hash-linked, and may change only with a recorded trigger. A failed check, new impact boundary, or contradicted assumption causes replanning instead of blind retry.

## Policy Decision Contract

Every protected action produces `allow`, `ask`, or `deny` plus a stable reason code, policy revision, capability hash, resource hash, and receipt hash.

`deny` never executes. `ask` requires a new human decision. `allow` remains subject to sandbox, secret, network, quality, and post-action verification controls.

## Evidence

Receipts are hash-linked and contain metadata and hashes, not chain-of-thought, secrets, source contents, or raw command output. A verifier independent from the implementing agent checks receipt integrity, task transitions, diff scope, tests, and release evidence.

## Governed Memory

Task output is not automatically trusted as memory. An agent may propose a repository learning with source, commit, scope, confidence, and content hash. It becomes queryable only after a named human approver promotes it. Changed source or expired review dates require refresh before reuse.
