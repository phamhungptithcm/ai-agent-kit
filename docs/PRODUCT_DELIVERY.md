# AI Agent Kit Delivery and Presentation Record

Document ID: AAK-DELIVERY-001. Revision: 3. Date: 2026-10-02. Product baseline: [AAK-PRODUCT-001 revision 3](PRODUCT_CONTRACT.md). Source baseline: `2f513e2` plus this local change set; package metadata currently declares `1.5.0`. A version string is not the identity of a future release artifact. Record its digest when frozen.

This is the delivery index for the user-approved product-flow and assurance change. The historical rows below describe the preceding documentation-only candidate, not the current runtime candidate. The [Product Delivery Contract](../assets/enterprise-ai-agent-os/.ai/core/product-delivery.md) governs future product work. Business rules/specs are in the [product contract](PRODUCT_CONTRACT.md), architecture in [High-Level Design](HIGH_LEVEL_DESIGN.md), and release prerequisites in [Public Launch Checklist](PUBLIC_LAUNCH_CHECKLIST.md). Detailed runtime/control-plane references remain linked from the README rather than copied here.

## Acceptance decisions

| Decision | Current scope | Required evidence |
| --- | --- | --- |
| Local implementation | LOCAL_CHECKS_PASSED; native review status in the current evidence record | Installation, mandatory context, synchronized skills, focused/full package checks |
| Synthetic presentation | REHEARSED for the local control-plane scenario | Actual `team demo` output, explicit synthetic labeling, timeline inspection, repeatable setup |
| Public release of this change | BLOCKED | Frozen candidate, current CI/platform results, authorized release decision and published-artifact readback |
| Live-host/production claims | NOT_TESTED for this change | Actual host-bound lifecycle attestation and product-specific target-environment acceptance |

Readiness is candidate- and scope-specific. No publish, deployment, tag, commit or external account change is recorded by this change.

## Current production-harness candidate

User scope: source-backed rules for all document/planning stages and stack-specific implementation/security/performance/memory acceptance. AAK-PRODUCTION-1 adds 21 mandatory controls through contract v2. Required declarations, source/stack hash freshness, forecast ceilings, story/AC/task links, UTC calendar/capacity/dependency schedules and AC-linked checks are validated. Performance/memory need matching numeric observations captured from command JSON stdout and satisfying declared limits; unrelated exit-zero commands leave those controls incomplete. Product-bound task reports and production release records enforce the harness. V1 remains local/legacy only.

Current complete local `npm run check`: **275/275 PASS**, evals, adapter conformance, release-evidence/supply-chain, build and clean installed smoke. Independent native review ran **30/30 focused checks**, returned COMPLETED with zero findings in this change's reviewed scope, and retained its result under `.ai-agent-kit/production-harness-evidence/native-review.json`. These are local source/fixture/package results, not target production workload/soak measurements, live release readback or formal SSDF/ASVS certification. Actual spent budget remains separate from declared forecasts. Detailed rules, standard versions and confidence meanings are in the [production harness guide](../assets/enterprise-ai-agent-os/.ai/docs/production-harness.md).

The local presentation baseline is deliberately labeled legacy/local until a real production v2 contract with product-specific budget, schedule, measurement workload and signed authority is accepted. Missing production controls remain visible; fixture success never fills real product evidence. Full screen-reader/platform/localization acceptance remains NOT_TESTED. No external publication or production-account mutation is authorized by this implementation.

## Previous product-flow candidate and review loop

The user approved closing the five review/requirements/release gaps and making
product development visible to novices. The implemented local flow provides
`start`, `product next/status/view`, registered canonical documents, revisioned
BR/spec/design/AC/task/check contracts, explicit local plan approval, actual
bounded command receipts, authenticated v2 review, and signed artifact/environment
release/sanity records. The coding host performs the steps; CLI state alone does
not start an autonomous worker or certify semantic document quality.

Current complete `npm run check`: 273/273 PASS, including evals, conformance, supply-chain, build and clean installed start/next/view smoke at the recorded snapshot. The strict observation-clock guard is included. The operator persistence recovery also passed the fresh complete 273/273 check, build and clean installed smoke. Its fresh independent review result is retained in `.ai-agent-kit/product-delivery-evidence/native-review-cycle-3.json` when returned. Focused review-fix suite:
19/19 PASS at its recorded source snapshot. Host-dispatch preflight regression
suite: PASS at its recorded snapshot. These counts are not combined into a full
candidate count. Final handoff evidence is refreshed after the last complete check. No live package publish/readback is claimed.

Native independent review cycle 1 found four actionable findings: non-atomic
contract/approval binding, concurrent review-ledger fork/consumed authorization,
stale progress selecting monitor, and this outdated delivery record. The first
three have source fixes and focused executable regressions; this record now
separates historical and current candidates. Cycle 2 independently confirmed those fixes and passed 20/20 focused checks, then found release/sanity nonce consumption preceding flow persistence. Both operator paths now couple nonce rollback with sealed flow persistence and retain a bounded persisted-action replay guard; injected failures retry the identical signed inputs successfully. A clean cycle 3 native review is required before a clean local handoff; its returned result is retained separately from these source claims. The raw review and administrative status correction
remain under `.ai-agent-kit/product-delivery-evidence/`. An initial BLOCKED host
result was classified REJECTED for the approved fix loop; no finding was dropped.
Usage counters for the host session are unavailable, not measured zero usage.

The loop also exposed two integration defects: invalid external run identity
acquired an orphan claim before validation, and untracked `node_modules` symlinks
blocked clean installed product start. Preflight now validates before claiming;
source snapshots omit only untracked installed node_modules, while manifest/
lockfiles and tracked vendored dependencies remain candidate inputs. Packed
smoke exercises the installed start/next/view commands rather than relying on
source-only execution. Current receipt/review signatures establish input binding
and identity, not correctness against a malicious repository/trust-store owner.

## Historical documentation candidate verification

| Executed verification | Actual result | Evidence scope |
| --- | --- | --- |
| `npm run check` | PASSED; 252/252 tests; evals, adapter conformance, evidence verification, supply-chain checks, build and packed installation smoke completed | Modified local source/package candidate; host behavior and registry acceptance remain outside this result |
| `node --test --test-name-pattern='bootstrap creates local\|canonical contract manifest\|task-aware context compiler' test/bootstrap.test.mjs` | PASSED, 3/3 after adding missing-contract rejection coverage | Bootstrap installs the contract; manifest covers it; compiled context contains it and becomes BLOCKED when it is absent |
| `python3 -B assets/enterprise-ai-agent-os/.ai/scripts/sync_agent_assets.py --check` | PASSED | Generated skill mirrors agree with canonical sources |
| `git diff --check` and relative file-link inspection | PASSED | Changed-file whitespace and file references in README/product/design/release documents |
| `npm run release:dry-run` | PASSED; 853 files in the package preview | Final documentation and scaffold included; dry-run does not prove registry publication or acceptance |
| `team demo` on two new disposable Git repositories | READY, 6/6 assignments, 20 journal events on each run | Synthetic serial-persona local control plane; browser inspection confirms rendered timeline and visible synthetic disclosure |

Local evidence is retained under `.ai-agent-kit/product-delivery-evidence/`: full check log, focused check log, rehearsal/repeat summaries, snapshot manifest, and standalone `demo/team-timeline.html` plus JSON/text. The local record is deliberately outside the published package. The HTML is also opened in the local browser for presentation review.

The first full check caught missing canonical-manifest entries for the five new scaffold files. Those entries were added and the full check rerun successfully. The additional missing-contract assertion and final documentation/readme clarification were checked afterward; they do not change the tested runtime implementation. Pre-change 33-test results are historical and are not added to the modified candidate's test count.

Rehearsal HTML SHA-256: `f0a6f531441ebf572dc38607b302233ecd8d50f6e022618b1afe5e6f93f4d211`. Event timestamps and usage inside the synthetic scenario are fixture values, not measured host duration, real token consumption or proof of chronological production activity. The new target on the second run acts as a clean reset; both runs preserve their own summaries.

Repository intelligence for this change uses bounded source, Git and executable tests; no fresh CodeGraph/CocoIndex certification is claimed. The earlier documentation-only change received self-review and local checks. Current native independent review is recorded separately below. Live registry readback and Windows CI are not inferred from local tests.

## Reproducible presenter procedure

Run from the checked-out repository with its declared Node/dependency prerequisites. Use a disposable, initialized Git target. Run `node bin/ai-agent-kit.mjs --help` to inspect supported options and `node bin/ai-agent-kit.mjs --version` to show the local package version. Do not use an unpinned registry `latest` command to demonstrate this unreleased change.

1. Explain the user problem: coordinating AI-assisted coding requires bounded tasks, evidence handoffs and review that reopens failed work.
2. Run `node bin/ai-agent-kit.mjs team demo --target DEMO_REPO`, replacing `DEMO_REPO` with the actual disposable Git repository path. The command writes `.ai-agent-kit/demo/agent-department/` inside that target and cleans its internal fixture.
3. Open the returned timeline HTML. Show the approval gate, assurance rejection, implementation retry, fresh downstream verification and final review. Point to the returned summary JSON and `synthetic: true` disclosure.
4. Show BR-03/SPEC-03/AC-03 and BR-06/SPEC-06/AC-06 in the product contract. Connect the demonstrated sequence to the real orchestration code and executed regression checks.
5. Explain the new document flow: an agreed rule becomes an observable spec/AC, tasks use the approved baseline, and changed baselines invalidate affected evidence. Show the mandatory contract in a compiled context or its exercised regression test; do not claim automatic semantic verification of every project document.
6. Close with the decision boundary: this demonstrates local coordination. Actual AI-host execution and published-candidate acceptance require separate evidence. State the relevant pending release action from this record.

Repeatability: use a new disposable target for each rehearsal, preserving prior evidence rather than overwriting a release record. Confirm the same scenario reaches `READY` and the output stays under the target. Never run the demo against an unrelated production repository. If it fails, disclose the failure or show an explicitly labeled prior recording from the same verified candidate; do not improvise fabricated results.

## Authorized release and sanity procedure

The existing CI workflow requires Node 20/24 validation and macOS/Windows packed smoke before publication. Confirm all required jobs for the exact frozen commit; a local Linux/macOS result is not all-platform evidence. Review package contents and digest, source/spec revision, release operator authorization, artifact identity, rollback availability and current independent review before publishing.

After authorized publication, read back the exact npm version, tarball integrity and provenance, compare them with the frozen candidate, and install that exact tarball/version in a clean supported environment. Execute dry-run, selected-adapter bootstrap, status/doctor, update preview and ownership-preservation checks. Separately execute required live-host lifecycle checks; inspect current evidence rather than assuming an adapter declaration proves host compatibility.

For an incorrect package, stop promotion; the authorized release operator chooses deprecation and a verified forward-fix version or restoring the previous distribution tag as applicable. Already-installed projects require a tested kit update/restore plan. Moving a registry tag does not undo their local files. Do not assert npm artifact removal is a safe universal rollback.

The release operator must define the observation window, installation-failure signals, support route and stop/escalation criteria before public promotion. Operational owner and future release approval are unassigned in this change and therefore block release acceptance. The revised CI automates exact registry metadata/integrity/byte readback and a clean installed CLI journey after publishing the frozen archive. That live workflow has not run for this change. Independent native-host acceptance, public-key provenance verification and operational observation still require separate evidence.
