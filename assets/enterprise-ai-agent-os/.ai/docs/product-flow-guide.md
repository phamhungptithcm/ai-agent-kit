# Product flow guide

Ask the active coding agent: “Develop this product from my goal. Follow the
installed product workflow, explain each step, continue approved work, and show
output paths, review findings, evidence limits and the next action.” The agent
follows `.ai/workflows/develop-product.md`. Node 20+, Git and an active coding
host are required. The CLI does not supply a model or run while the host stops.
A new Git repo can start discovery without a commit; final review needs a real
commit identity.

## User controls

```sh
ai-agent-kit start "Build a product for my users"
ai-agent-kit delivery next
ai-agent-kit delivery view
ai-agent-kit delivery status --format json
```

`start` records the goal and active ID. `next` explains what, why, expected
output/path and action; JSON includes a host-agent handoff. `view` saves an HTML
snapshot and prints its absolute path. Regenerate to refresh. Resume commands
can omit `--id` for the active product; `--target` selects another repository.
No document is claimed complete just because `start` ran.

## Agent contract

Register completed canonical files, bind the JSON contract, record existing
authorization and execute declared checks:

```sh
ai-agent-kit delivery document --kind discovery --file docs/product/brief.md --owner product-owner --summary "Users, outcome and sourced decisions"
ai-agent-kit delivery bind --file docs/product/contract.json
ai-agent-kit delivery approve --approved-by decision-maker
ai-agent-kit delivery check --check acceptance -- node test/acceptance.mjs
```

The installed `product-contract.schema.json` describes schema 1 and the production v2 extension: matching
`task_id`, increasing `revision`, `documents`, `tasks`, `acceptance`, and
`open_decisions`. Runtime reads actual hashes, resolves links and rejects cycles.
Each document has unique `id`, `kind`, relative `path`, actual `sha256`, owner
and summary. Discovery, business_rules, specification, design and plan are
required. Each task has unique ID, owner, concrete file paths and depends_on
task IDs. Each AC has ID, rule_document, spec_document, design_document,
task_id, observable given/when/then, environment and check IDs. Every task serves
an AC. Open decisions have question, owner and boolean blocking. Blocking
decisions prevent implementation. Do not populate contracts with example rules.

Hashes detect drift; they do not assess prose correctness. Approval snapshots
preserve dirty WIP and reject subsequent changes outside task/document paths.
Check receipts record exit status, time and command/output/input hashes without
raw logs. Save a bounded redacted report when reviewers need observed details.
Source snapshots omit untracked installed node_modules, while manifests, lockfiles and Git-tracked vendored dependencies remain candidate inputs. Latest execution governs each check; failures cannot hide behind earlier passes.
The bounded runner uses host permissions, not an isolation boundary, and grants
no authority to access production or paid services.

## Independent review

Use `runtime review record --id <id> --file <review.json>`. Schema v2 adds current
input_hash, author_identity, reviewer_identity and reviewer_action to seven
dimensions and finding history. References resolve `execution:<receipt_sha256>`
or `file:<relative_path>#<sha256>` against actual files. PASS needs a current
passing execution and no unresolved finding, including accepted-risk findings.
Preserve earlier findings and verified fixes in later cycles.

Both identities use existing Ed25519 repository trust policies. Reviewer must
have a different principal and subject, role reviewer and capability
review.submit. Sign a review.submit action for the repository, task and digest
of the complete review before reviewer_action is added. `team action-sign` uses
a private-key environment variable and grants no authority. Operators enroll
public keys with `team trust-register` using explicit approval or a trusted
operator. See the team-control-plane guide. Never put private keys in documents,
JSON inputs, screenshots or logs. Do not enroll identities for both sides and
claim an independent human review.

Legacy v1 is readable history (`LEGACY_UNVERIFIED`), never production readiness.
Key revocation invalidates acceptance. Signatures prove identity/input binding,
not correctness of conclusions. Local receipt hashes are not tamper-proof
against an actor controlling the repository and trust store.

## Release and sanity formats

`delivery release --file <record.json>` needs current authenticated review and
all checks. Schema 1 has matching task_id/input_hash; release_reference; environment;
environment_kind (PRODUCTION, STAGING, LOCAL or FIXTURE); artifact with relative
path and sha256; rollback_reference and observation_plan descriptions; identity;
and signed release.record action. This records evidence, not a deployment.

`delivery sanity --file <record.json>` binds task/input/artifact_sha256/
environment/environment_kind; concrete readback_reference; observation_started_at, observation_finished_at and required_observation_ms; nonempty evidence entries with path,
sha256 and status PASSED; identity and signed release.sanity action.
Observation must fulfill the required duration. Files must be bounded/redacted.
Operator role and its public-key policy require the respective release capability.
Sign the digest of the entire record before action is added. Replay is rejected.

PRODUCTION yields LIVE_ATTESTED; others yield TARGET_ATTESTED. Both state
operator attestation explicitly. Missing/failed/stale evidence never becomes
live proof. No confidence percentage is invented.

The kit's npm workflow freezes one archive, publishes it, reads back exact
registry version/integrity/bytes, then clean-installs and runs version, dry-run,
bootstrap, status and update preview. Post-publish failure leaves the published
release unverified for maintainer investigation/recovery. Native-host execution,
public-key provenance verification and operational observation remain separate.

For production work, use contract v2 and the [production harness](production-harness.md). V1 remains readable/local but cannot authorize PRODUCTION release. The view reports missing controls and current evidence separately from document declarations.
