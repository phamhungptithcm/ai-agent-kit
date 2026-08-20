---
name: run-product-genesis
description: Orchestrate a new product from a rough idea through experiments, business viability, trust/data assurance, approved requirements and design, iterative delivery, commit-bound verification, production readiness, release, live operation, and retirement. Use when the user has no codebase or asks for a professional end-to-end idea-to-production flow with fewer repeated prompts and durable evidence.
---

# Run Product Genesis

Use `.ai/core/product-genesis.md` and `.ai/workflows/product-genesis.md`. The repository workspace is authoritative; chat history is not.

1. If no workspace exists, run `ai-agent-kit product start --id <id> --idea <verbatim-idea> --profile <LEAN|STANDARD|HIGH_ASSURANCE>`.
2. Otherwise run `ai-agent-kit product resume --id <id>` and load only current artifact heads, exact approval hashes, current questions, and cited predecessors.
3. Run `ai-agent-kit product next --id <id>`. Invoke the returned skill; do not jump to a later stage.
4. Ask at most three highest-impact questions per round. Explain why each unlocks a decision. Record answers and context immediately.
5. Before every human gate, run `product analyze`; resolve blockers; present scope, non-goals, evidence limits, trade-offs, risks, cost/time range, and exact target hash.
6. Record only named human decisions with `product approve`. Agent recommendations never approve a baseline.
7. Use the risk profile to control design depth. `LEAN` reduces ceremony, never traceability or approval integrity.
8. Before a large BRD, require approved Alpha and investment baselines covering experiments, business viability, accessibility, privacy/legal, threat/security, and data lifecycle.
9. Before coding, require current BRD, solution, and delivery approvals. Run capacity-bounded iterations and preserve `BR-* -> FR/NFR-* -> AC-* -> backlog -> code -> test -> evidence receipt` links.
10. Generate GitHub issues in preview mode. Apply only after an exact current `GITHUB_ISSUE_PLAN` approval hash and a short-lived repository-trusted Ed25519 `MEMBER` action bound to the preview payload, with `product.github.write` and an `operator` or `team-lead` role. Treat the nonce as one attempt. If a create result is ambiguous, stop for remote reconciliation; use `--confirm-absent <item-id>` only after an operator verifies that no matching issue exists.
11. Run `product converge`, production readiness, immutable release-candidate, and human release gates. Provider or production claims require current provider-verified receipts and an environment attestation.
12. Operate with live outcome/support evidence and govern retirement/data deletion separately.

Stop and request a decision for material ambiguity, conflicting authority, stale approval, unresolved high-impact risk, or scope change. Never hide uncertainty, invent customer validation, overwrite history, or infer commit, push, issue creation, deployment, or release authority.

Return the current stage, confirmed/assumed/unknown/changed summary, current baseline hashes, blockers, no more than three questions, and one exact next action.
