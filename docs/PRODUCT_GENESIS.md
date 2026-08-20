# Product Genesis: idea to production

Product Genesis helps a person who has only a rough product idea work like a small, disciplined product company. The agent facilitates each decision, writes the required artifacts, keeps every version, and stops at human approval gates before advancing.

## What the agent does

| Stage | Agent support | Required exit evidence |
| --- | --- | --- |
| Idea | Capture the user's original words, outcomes, people, constraints, assumptions, and unknowns | Versioned idea snapshot |
| Discovery | Run focused rounds of at most three questions and expose contradictions and decisions | Sealed question/context ledger |
| Research | Investigate users, workflow, alternatives, feasibility, viability, privacy, cost, and risk | Human-approved discovery decision hash |
| Discovery validation / Alpha | Form hypotheses, run experiments, prototype, test usability, collect customer evidence, and decide continue/pivot/stop | Human-approved Alpha hash with immutable evidence receipts |
| Investment | Model business case, unit economics, pricing, GTM; close accessibility, market privacy/legal, threat/security, retention, migration, and deletion decisions | Human-approved viability/trust/data bundle hash |
| Business requirements | Write measurable outcomes, scope, requirements, and explicit business rules | Human-approved BRD hash |
| Specification and design | Define journeys, failure paths, functional/NFR behavior, acceptance, UX, domain, data, architecture, security, operations, tests, and rollout at risk-appropriate depth | Human-approved solution-bundle hash |
| Delivery | Slice the smallest end-to-end MVP into traceable Agile epics, stories, tests, and milestones | Approved implementation scope and ready backlog |
| Build and verify | Run capacity-bounded iterations with goal, progress, acceptance, review, retrospective, change propagation, and commit-bound convergence | Current Git commit, file hashes, tests, receipts, and reviewed iteration |
| Production readiness | Bind CI/CD, security, accessibility, privacy/legal, infrastructure, migration/retained data, observability/SLO, incidents, load, restore, rollback, analytics, and support to one environment | Provider-verified readiness hash and immutable release candidate |
| Release, operate, retire | Compare exact candidate with environment evidence; measure live outcomes/support; govern sunset and deletion | Human release/retirement decisions and live provider receipts |

Material changes never overwrite an approved baseline. They create a successor version, impact analysis, old-to-new trace map, and reapproval request.

## Fast path without fake certainty

The fastest credible path is not a fixed sequence of long documents. The agent uses short discussion and evidence loops, drafts documents incrementally, resolves high-risk unknowns early, and plans one vertical MVP. Gates remain strict where mistakes become expensive: business approval, specification approval, implementation authority, material changes, and release.

Small low-risk products can use `LEAN`. Commercial products default to `STANDARD`. Regulated, safety-critical, highly sensitive, high-value, or operationally severe products use `HIGH_ASSURANCE`. Profile depth changes, but evidence, traceability, named-human approval, security, verification, rollback, and release truth do not.

## Using it

Ask naturally:

```text
I only have an idea and no codebase. Help me start a product.
Thảo luận ý tưởng sản phẩm với mình.
Nghiên cứu cơ hội và tính khả thi của ý tưởng này.
Viết BRD từ discovery đã chốt.
Viết product spec từ BRD đã được duyệt.
Lập backlog Scrum từ spec đã duyệt.
```

Routing is explainable and fail-closed. Weak or ambiguous input returns `ABSTAIN`; users can invoke a skill explicitly.

For multi-stage work, invoke `run-product-genesis`. Product Workspace is authoritative:

```bash
ai-agent-kit product start --id my-product --idea "<original idea>" --profile standard
ai-agent-kit product resume --id my-product
ai-agent-kit product next --id my-product
```

Use `product artifact-validate` and `product artifact-put` for immutable versions, `product analyze` before every gate, and `product approve` only for a named human decision bound to the exact current hash. The added artifact types are `discovery-validation`, `business-viability`, `trust-compliance`, `data-lifecycle`, `iteration-plan`, `iteration-review`, `production-readiness`, `product-analytics`, `support-readiness`, `pilot-evaluation`, and `retirement`.

Evidence and dossier commands:

```bash
ai-agent-kit product evidence-put --id my-product --file inputs/evidence.json
ai-agent-kit product evidence-verify --id my-product --minimum-trust REPOSITORY_BOUND
ai-agent-kit product environment-put --id my-product --file inputs/environment.json
ai-agent-kit product analyze --id my-product --gate PRODUCTION_READINESS
ai-agent-kit product release-candidate --id my-product --release-class LIMITED_RELEASE
ai-agent-kit product dossier-status --id my-product
ai-agent-kit product dossier-export --id my-product --output product-dossier.md
```

The CLI can measure `LOCAL_VERIFIED` and `REPOSITORY_BOUND` receipts. `PROVIDER_VERIFIED` and `SIGNED_ATTESTATION` require an authorized host adapter calling the runtime verifier interface; merely writing those trust strings is rejected. This keeps CI, scanners, cloud environments, deployments, analytics, and support providers pluggable without adding credentials or mandatory network access to the package.

`product github-plan` is a non-mutating preview. A `product github-sync` preview returns the exact repository ID, product task ID, operation, and payload hash that must be signed. Before delegating issue apply, a human repository owner must provision the operator's public key through the Team Control Plane trust workflow and keep the private key outside agent-visible context. Remote apply requires the current issue-plan approval hash plus that repository-trusted Ed25519 `MEMBER` identity and a one-use action with the `product.github.write` capability and an `operator` or `team-lead` role:

```bash
ai-agent-kit product github-sync --id my-product
ai-agent-kit team action-sign --file inputs/github-sync-action.json --identity-key-env AAK_TEAM_PRIVATE_KEY_PEM
ai-agent-kit product github-sync --id my-product --apply \
  --approval-hash <current-approval-hash> \
  --identity-file inputs/operator-identity.json \
  --action-file inputs/signed-github-sync-action.json
```

The action-sign input maps preview fields `repository_id`, `task_id`, `operation`, and `payload_hash` to `repositoryId`, `taskId`, `operation`, and `payloadHash`, then adds the trusted `keyId`, `principalId`, a fresh `nonce`, and a 1–300 second `issuedAt`/`expiresAt` window. Its nonce is durably consumed before GitHub is contacted, so every retry needs a new short-lived signed action. If a remote create result is ambiguous, synchronization stops at `RECONCILIATION_REQUIRED`; after checking GitHub, an operator may explicitly retry an absent item with `--confirm-absent <delivery-item-id>`. `product converge` requires a clean tracked worktree, current full commit, existing code/test files with measured SHA-256 hashes, current baselines, and current receipt IDs.

## Feasibility and performance boundaries

The deterministic workspace operations are local and do not call a model or remote service. Resume loads the sealed context, answered decisions, current heads, evidence receipts, environments, and cited predecessors instead of a full transcript; discussion exposes no more than three current questions. Artifacts are bounded to 4 MiB, state to 8 MiB, receipts to 1,000, environments to 100, questions to 1,000, and the event ledger to 20,000 records. Integrity verification is intentionally linear in these bounded collections. GitHub synchronization inventories at most 1,000 issues and creates planned items sequentially under a workspace lock with a retry-safe local ledger; network and review time remain external variables.

Run `npm run benchmark:product` to measure this checkout and machine. On the 2026-08-20 local Apple arm64 run (Node v25.9.0, 100 iterations), three sealed read operations averaged 2.944 ms, dossier status averaged 0.921 ms, two mutations averaged 4.924 ms, and the workspace was 121,828 bytes. These are machine-specific diagnostic observations, not a universal SLO, model-quality claim, or measurement of research/reviewer/provider time.

Product Genesis is practically useful for preserving intent, reducing repeated context collection, detecting contradictory/stale artifacts, and making approval scope explicit. It cannot replace customer interviews, business authority, legal/security specialists, provider validation, or production observation. Desk research is not customer validation, approved documents are not working software, and local/synthetic tests are not release evidence.

Local approval identity is a named-human assertion recorded with authority, scope, constraints, risks, and an exact hash; it is not cryptographic identity proof. Organizations that need authenticated approvals must bind this record to their identity and signing system. Each local file update is atomic and immutable versions are never auto-promoted after a failed write; a process or machine failure between related file updates can leave an unreferenced recovery artifact that requires operator inspection. GitHub sync creates the approved issues and preserves parent, dependency, and milestone intent in the sealed plan and issue bodies, but this version does not configure GitHub sub-issue relationships or create milestones automatically.

## External-skill safety

The public registry is discovery input, not a trusted package source. `external-skill-sources.lock.json` records exact upstream commits, paths, licenses, hashes, review decisions, and adapted concepts. Unknown-license catalogs cannot be vendored. Upstream code is never executed during intake.

Run:

```bash
npm run validate:capabilities
npm run eval:routing
npm run eval:product
```

These checks ensure all canonical skills have an explicit dispatch mode, every routed skill has one real route, Product Genesis artifacts exist and are registered, and external provenance satisfies policy.
