import { PRODUCTION_RULES, productionHarnessReport, inspectProductionHarness } from "../src/production-harness.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";
import { main } from "../src/cli.mjs";
import { listProductFlows, validateProductContract, startProductFlow, recordProductDocument, bindProductContract, approveProductPlan, checkProduct, inspectProductFlow, renderProductFlow, recordProductRelease, recordProductSanity, writeProductView } from "../src/product-flow.mjs";
import { buildFinalTaskReport } from "../src/task-report.mjs";
import { transitionTask } from "../src/governed-runtime.mjs";
import { deliveryDigest, deliveryInput, deliveryCandidate, deliveryScopeSnapshot, readDeliveryFile, readDeliveryJson, writeDeliveryJson, runDeliveryCheck } from "../src/delivery-evidence.mjs";
import { recordFinalReview, inspectFinalReview } from "../src/final-review.mjs";
import { createEd25519TeamIdentity, createSignedTeamAction, generateTeamSigningKeyPair } from "../src/team-control-contract.mjs";
import { withTeamControlStore } from "../src/team-control-store.mjs";
import { resolveRepositoryIdentity } from "../src/memory-contract.mjs";

const id = "PRODUCT-1";
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-flow-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  fs.writeFileSync(path.join(root, ".gitignore"), ".ai-agent-kit/\n");
  fs.writeFileSync(path.join(root, "app.mjs"), "export const allowed = (owner, actor) => owner === actor;\n");
  fs.writeFileSync(path.join(root, "check.mjs"), "import assert from 'node:assert/strict'; import {allowed} from './app.mjs'; assert.equal(allowed('a','a'),true); assert.equal(allowed('a','b'),false);\n");
  fs.writeFileSync(path.join(root, "outside.mjs"), "export {};\n");
  execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  startProductFlow({ target: root, id, goal: "Only account owners can view their account" });
  const documents = ["discovery", "business_rules", "specification", "design", "plan", "implementation"].map((kind) => {
    const relative = `.ai-agent-kit/product/${id}/${kind}.md`;
    fs.writeFileSync(path.join(root, relative), `# ${kind}\nAccount ownership is checked before access.\n`);
    return { id: kind, kind, path: relative, sha256: readDeliveryFile(root, relative).sha256, owner: "fixture-domain-owner", summary: `Account ownership ${kind}` };
  });
  const contract = { schema_version: 1, task_id: id, revision: 1, documents, tasks: [{ id: "CODE-1", owner: "implementer", paths: ["app.mjs", "check.mjs"], depends_on: [] }], acceptance: [{ id: "AC-1", rule_document: "business_rules", spec_document: "specification", design_document: "design", task_id: "CODE-1", given: "An account belongs to a", when: "a or b requests it", then: "a is allowed and b is denied", environment: "local fixture", checks: ["ownership"] }], open_decisions: [] };
  writeDeliveryJson(root, `.ai-agent-kit/product/${id}/input.json`, contract);
  bindProductContract({ target: root, id, file: `.ai-agent-kit/product/${id}/input.json` });
  approveProductPlan({ target: root, id, approvedBy: "fixture-owner" });
  return root;
}
function trusted(root, principal, roles, capabilities) {
  const key = generateTeamSigningKeyPair({ keyId: `key-${principal}` });
  const issued = new Date(Date.now() - 1000).toISOString();
  const identity = createEd25519TeamIdentity({ schema_version: 1, principal_id: principal, type: "MEMBER", issuer: "fixture", subject: principal, roles, capabilities, issued_at: issued, expires_at: new Date(Date.now() + 3600000).toISOString(), evidence_digest: deliveryDigest({ principal }), authentication: { key_id: key.key_id, nonce: `identity-${principal}` } }, key.private_key_pem);
  withTeamControlStore({ target: root }, (store) => store.putTrustedKey({ key_id: key.key_id, issuer: "fixture", principal_id: principal, public_key_pem: key.public_key_pem, roles, capabilities, max_ttl_seconds: 7200, valid_from: issued }, { administeredBy: "fixture-owner", authorizationEvidenceHash: deliveryDigest({ fixtureApproval: principal }) }));
  return { key, identity };
}
function signRecord(root, record, signer, operation = "review.submit") {
  const copy = { ...record }; delete copy.reviewer_action; delete copy.action;
  const action = createSignedTeamAction({ privateKeyPem: signer.key.private_key_pem, keyId: signer.key.key_id, principalId: signer.identity.principal_id, repositoryId: resolveRepositoryIdentity({ target: root }).repository_id, taskId: id, operation, payloadHash: deliveryDigest(copy) });
  return { ...copy, [operation === "review.submit" ? "reviewer_action" : "action"]: action };
}
function review(root, receipt, author, reviewer, status = "PASSED", findings = []) {
  const dimensions = Object.fromEntries(["requirement_match", "security", "code_quality", "failure_paths", "error_handling", "production_readiness", "trade_offs"].map((name) => [name, { status: status === "BLOCKED" && name === "security" ? "FAILED" : "PASSED", summary: `${name} assessed within local fixture scope`, evidence_refs: [`execution:${receipt.receipt_hash}`] }]));
  if (status === "BLOCKED") for (const dimension of Object.values(dimensions)) dimension.status = "FAILED";
  return signRecord(root, { schema_version: 2, task_id: id, input_hash: deliveryInput(root, id), status, dimensions, findings, residual_risks: ["Live host and production acceptance not executed"], limitations: [], author_identity: author.identity, reviewer_identity: reviewer.identity }, reviewer);
}
function execute(root, code = null) {
  if (code) fs.writeFileSync(path.join(root, "app.mjs"), code);
  return checkProduct({ target: root, id, check: "ownership", command: process.execPath, args: ["check.mjs"], authorized: true });
}
function saveReview(root, input) { const file = `.ai-agent-kit/product/${id}/review-input.json`; writeDeliveryJson(root, file, input); return recordFinalReview({ target: root, id, file: path.join(root, file) }); }
function child(code, args) {
  return new Promise((resolve, reject) => { const worker = spawn(process.execPath, ["--input-type=module", "-e", code, ...args]); let error = ""; worker.stderr.on("data", (chunk) => { error += chunk; }); worker.on("error", reject); worker.on("close", (status) => resolve({ status, error })); });
}

test("beginner entry point shows why/output/location/next without inventing completed documents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-start-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root }); execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture"); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const logs = []; assert.equal(await main(["start", "Build an ownership checker", "--id", "BEGINNER", "--target", root], { log: (s) => logs.push(s) }), 0);
  assert.match(logs.join("\n"), /Why:.*\nOutput:.*\nWhere:/); assert.match(logs.join("\n"), /NOT_TESTED/); assert.match(logs.join("\n"), /expected; not created yet/);
  const next = []; await main(["delivery", "next", "--id", "BEGINNER", "--target", root, "--format", "json"], { log: (s) => next.push(s) });
  assert.equal(JSON.parse(next[0]).agent_handoff.trust, "TRUSTED_CONTROL");
  assert.equal(fs.existsSync(path.join(root, "docs/product/BEGINNER/discovery.md")), false);
});
test("contract refuses broken links, stale documents, cycles and unresolved implementation decisions", () => {
  const root = fixture(); const file = `.ai-agent-kit/product/${id}/input.json`; const contract = readDeliveryJson(root, file);
  contract.revision = 2; contract.acceptance[0].design_document = "missing"; writeDeliveryJson(root, file, contract);
  assert.throws(() => bindProductContract({ target: root, id, file }), /design_document/);
  contract.acceptance[0].design_document = "design"; contract.tasks[0].depends_on = ["CODE-1"]; writeDeliveryJson(root, file, contract);
  assert.throws(() => bindProductContract({ target: root, id, file }), /dependencies/);
  contract.tasks[0].depends_on = []; contract.open_decisions = [{ question: "Who may override ownership?", owner: "domain-owner", blocking: true }]; writeDeliveryJson(root, file, contract);
  bindProductContract({ target: root, id, file }); assert.throws(() => approveProductPlan({ target: root, id, approvedBy: "owner" }), /blocking decisions/);
});
test("new repositories begin discovery and HTML safely displays untrusted user content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-greenfield-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  startProductFlow({ target: root, id: "NEW", goal: '<script>alert("injection")</script> ownership checker' });
  const view = writeProductView({ target: root, id: "NEW" }); const html = fs.readFileSync(view.path, "utf8");
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/); assert.match(html, /saved progress view/); assert.match(html, /expected destination/);
  assert.equal(inspectProductFlow({ target: root, id: "NEW" }).next_step.id, "discovery");
});
test("untracked installed dependencies do not block source evidence while lockfiles remain bound", () => {
  const root = fixture(); const before = deliveryCandidate(root);
  fs.mkdirSync(path.join(root, "node_modules")); fs.symlinkSync(path.join(root, "app.mjs"), path.join(root, "node_modules", "linked.mjs"));
  assert.deepEqual(deliveryCandidate(root), before); assert.equal(Object.keys(deliveryScopeSnapshot(root)).some((name) => name.startsWith("node_modules/")), false);
  assert.equal(execute(root).status, "PASSED");
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n"); assert.notDeepEqual(deliveryCandidate(root), before);
  assert.throws(() => execute(root), /exceed approved/);
});
test("direct runtime transition cannot bypass changed product documents", () => {
  const root = fixture(); fs.appendFileSync(path.join(root, `.ai-agent-kit/product/${id}/specification.md`), "Changed rule\n");
  assert.throws(() => transitionTask({ target: root, id, to: "VERIFYING", evidence: { implementation_summary: "declared", diff_scope: "app.mjs" } }), /stale/);
});
test("contract binding retries the same requirements after an interrupted mirror write", () => {
  const root = fixture(); const file = `.ai-agent-kit/product/${id}/input.json`; const input = readDeliveryJson(root, file); input.revision = 2; writeDeliveryJson(root, file, input);
  const rename = fs.renameSync;
  try { fs.renameSync = (from, to) => { if (to === path.join(root, `.ai-agent-kit/product/${id}/contract.json`)) throw new Error("injected mirror interruption"); return rename(from, to); }; assert.throws(() => bindProductContract({ target: root, id, file }), /injected mirror/); }
  finally { fs.renameSync = rename; }
  const repaired = bindProductContract({ target: root, id, file }); assert.equal(repaired.contract.revision, 2); assert.equal(repaired.approval, null); assert.equal(repaired.status, "IN_PROGRESS");
  assert.equal(bindProductContract({ target: root, id, file }).contract.revision, 2);
});
test("concurrent contract bindings cannot split flow/task/mirror revisions", async () => {
  const root = fixture(); const original = readDeliveryJson(root, `.ai-agent-kit/product/${id}/input.json`);
  const files = [2, 3].map((revision) => { const file = `.ai-agent-kit/product/${id}/input-${revision}.json`; writeDeliveryJson(root, file, { ...original, revision }); return file; });
  const code = `import fs from 'node:fs'; import {bindProductContract} from ${JSON.stringify(new URL("../src/product-flow.mjs", import.meta.url).href)}; const rename=fs.renameSync; fs.renameSync=(from,to)=>{if(to.endsWith('/contract.json')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100); return rename(from,to)}; try { bindProductContract({target:process.argv[1],id:process.argv[2],file:process.argv[3]}); } catch(e) { console.error(e.message); process.exit(1); }`;
  const results = await Promise.all(files.map((file) => child(code, [root, id, file]))); assert.ok(results.some((result) => result.status === 0));
  for (const result of results.filter((item) => item.status !== 0)) assert.match(result.error, /being updated|newer revision/);
  const report = inspectProductFlow({ target: root, id }); assert.equal(report.status, "IN_PROGRESS");
  assert.equal(readDeliveryJson(root, `.ai-agent-kit/runtime/tasks/${id}.json`).product_contract.hash, report.contract.hash);
  assert.equal(deliveryDigest(readDeliveryJson(root, `.ai-agent-kit/product/${id}/contract.json`)), report.contract.hash);
});
test("actual command evidence rejects failures, unauthorized commands and changes outside approved scope", () => {
  const root = fixture(); assert.throws(() => runDeliveryCheck({ target: root, id, check: "ownership", command: process.execPath }), /explicitly authorized/);
  assert.equal(execute(root).status, "PASSED");
  execute(root, "export const allowed = () => true;\n"); assert.equal(inspectProductFlow({ target: root, id }).next_step.id, "verification");
  fs.writeFileSync(path.join(root, "outside.mjs"), "export const drift = true;\n"); assert.equal(inspectProductFlow({ target: root, id }).status, "STALE");
  assert.throws(() => execute(root), /exceed approved/);
});
test("a later failed execution cannot hide behind an earlier passing receipt", () => {
  const root = fixture(); execute(root);
  const failed = checkProduct({ target: root, id, check: "ownership", command: process.execPath, args: ["-e", "process.exit(1)"], authorized: true });
  assert.equal(failed.status, "FAILED"); assert.equal(inspectProductFlow({ target: root, id }).next_step.id, "verification");
});
test("checks reject expired or missing execution authority before running a command", () => {
  const root = fixture(); const file = `.ai-agent-kit/runtime/tasks/${id}.json`; const task = readDeliveryJson(root, file);
  for (const expiry of [new Date(Date.now() - 1000).toISOString(), null]) {
    task.capability.expires_at = expiry; task.capability_hash = deliveryDigest(task.capability); writeDeliveryJson(root, file, task);
    assert.throws(() => execute(root), /authority is missing, expired/);
  }
  assert.equal(readDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`).executions.length, 0);
});
test("authenticated review rejects invented references, self review and changed signed content", () => {
  const root = fixture(); const receipt = execute(root); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  const fake = review(root, receipt, author, reviewer); fake.dimensions.security.evidence_refs = ["test://claimed-pass"]; assert.throws(() => saveReview(root, signRecord(root, fake, reviewer)), /must resolve/);
  assert.throws(() => saveReview(root, review(root, receipt, reviewer, reviewer)), /SELF_REVIEW/);
  const altered = review(root, receipt, author, reviewer); altered.dimensions.security.summary = "Altered after signature"; assert.throws(() => saveReview(root, altered), /payload binding/);
  const valid = review(root, receipt, author, reviewer); saveReview(root, valid); assert.equal(inspectFinalReview({ target: root, id }).assurance.status, "VERIFIED");
  assert.throws(() => saveReview(root, valid), /replayed/);
});
test("authenticated review requires execution even with normalized lowercase statuses and refuses hidden secrets", () => {
  const root = fixture(); const receipt = execute(root); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  const input = review(root, receipt, author, reviewer); input.status = " passed ";
  for (const dimension of Object.values(input.dimensions)) { dimension.status = " passed "; dimension.evidence_refs = [`file:app.mjs#${readDeliveryFile(root, "app.mjs").sha256}`]; }
  assert.throws(() => saveReview(root, signRecord(root, input, reviewer)), /requires executed/);
  input.author_identity.private_key_pem = "must never persist"; assert.throws(() => saveReview(root, signRecord(root, input, reviewer)), /secret field/);
});
test("failed atomic review write preserves retry authority and concurrent signed submissions form one chain", async () => {
  const root = fixture(); const receipt = execute(root); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  const first = review(root, receipt, author, reviewer); const firstFile = `.ai-agent-kit/product/${id}/review-1.json`; writeDeliveryJson(root, firstFile, first);
  assert.throws(() => recordFinalReview({ target: root, id, file: path.join(root, firstFile) }, { renameSync: () => { throw new Error("injected append failure"); } }), /injected append/);
  recordFinalReview({ target: root, id, file: path.join(root, firstFile) });
  const files = [2, 3].map((number) => { const file = `.ai-agent-kit/product/${id}/review-${number}.json`; writeDeliveryJson(root, file, review(root, receipt, author, reviewer)); return file; });
  const code = `import {recordFinalReview} from ${JSON.stringify(new URL("../src/final-review.mjs", import.meta.url).href)}; for(let i=0;i<100;i++){try{recordFinalReview({target:process.argv[1],id:process.argv[2],file:process.argv[3]}); process.exit(0)}catch(e){if(!e.message.includes('being updated')){console.error(e.message);process.exit(1)}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}}process.exit(1)`;
  const results = await Promise.all(files.map((file) => child(code, [root, id, path.join(root, file)]))); for (const result of results) assert.equal(result.status, 0, result.error);
  const inspection = inspectFinalReview({ target: root, id }); assert.equal(inspection.status, "PASSED"); assert.equal(inspection.cycle_count, 3);
});
test("real defect reproduction, fix, executed regression and fresh authenticated review preserve the loop", () => {
  const root = fixture(); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  const failure = execute(root, "export const allowed = () => true;\n"); assert.equal(failure.status, "FAILED");
  const finding = { id: "OWNERSHIP-1", severity: "MEDIUM", status: "OPEN", category: "authorization", location: "app.mjs:1", summary: "Other account owners can access this account", resolution: null, evidence_refs: [`execution:${failure.receipt_hash}`] };
  saveReview(root, review(root, failure, author, reviewer, "BLOCKED", [finding]));
  const passed = execute(root, "export const allowed = (owner, actor) => owner === actor;\n");
  assert.throws(() => saveReview(root, review(root, passed, author, reviewer)), /resolve prior blocking findings/);
  const fixed = { ...finding, status: "FIXED", resolution: "Enforced exact owner identity and executed allow/deny regression", evidence_refs: [`execution:${passed.receipt_hash}`] };
  saveReview(root, review(root, passed, author, reviewer, "PASSED", [fixed]));
  const result = inspectProductFlow({ target: root, id }); assert.equal(result.review.cycles, 2); assert.equal(result.review.fixes.length, 1); assert.equal(result.next_step.id, "release"); assert.match(renderProductFlow(result), /AUTHENTICATED_REVIEW/);
  assert.ok(result.steps.find((step) => step.id === "verification").actual_outputs.some((file) => file.endsWith(`${passed.receipt_hash}.json`)));
  assert.deepEqual(result.steps.find((step) => step.id === "review").actual_outputs, [`.ai-agent-kit/runtime/reviews/${id}.jsonl`]);
  fs.appendFileSync(path.join(root, "app.mjs"), "export const changed = true;\n"); assert.equal(inspectFinalReview({ target: root, id }).status, "STALE");
});
test("changed specs and revoked reviewer authority invalidate downstream acceptance", () => {
  const root = fixture(); const receipt = execute(root); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  saveReview(root, review(root, receipt, author, reviewer));
  withTeamControlStore({ target: root }, (store) => store.revokeTrustedKey(reviewer.key.key_id, { administeredBy: "fixture-owner", authorizationEvidenceHash: deliveryDigest({ revoke: reviewer.key.key_id }) })); assert.equal(inspectFinalReview({ target: root, id }).status, "REJECTED");
  fs.appendFileSync(path.join(root, `.ai-agent-kit/product/${id}/specification.md`), "New ownership rule\n"); assert.equal(inspectProductFlow({ target: root, id }).status, "STALE");
});
test("release/sanity require signed operator evidence bound to the exact artifact and environment", () => {
  const root = fixture(); const receipt = execute(root); const author = trusted(root, "author", ["implementer"], ["result.publish"]); const reviewer = trusted(root, "reviewer", ["reviewer"], ["review.submit"]);
  saveReview(root, review(root, receipt, author, reviewer)); const operator = trusted(root, "operator", ["operator"], ["release.record", "release.sanity"]);
  const artifactPath = `.ai-agent-kit/product/${id}/release-artifact.txt`; fs.writeFileSync(path.join(root, artifactPath), "fixture artifact");
  const artifact = { path: artifactPath, sha256: readDeliveryFile(root, artifactPath).sha256 };
  const release = signRecord(root, { schema_version: 1, task_id: id, input_hash: deliveryInput(root, id), artifact, environment: "fixture target", environment_kind: "FIXTURE", release_reference: "fixture://release/1", rollback_reference: "fixture://release/previous", observation_plan: "Observe the ownership journey for one millisecond in this fixture", identity: operator.identity }, operator, "release.record");
  const productionFile = `.ai-agent-kit/product/${id}/production-release.json`;
  const production = { ...release, environment_kind: "PRODUCTION" }; delete production.action;
  writeDeliveryJson(root, productionFile, signRecord(root, production, operator, "release.record"));
  assert.throws(() => recordProductRelease({ target: root, id, file: productionFile }), /contract v2/);
  const file = `.ai-agent-kit/product/${id}/release.json`; writeDeliveryJson(root, file, release);
  const rename = fs.renameSync;
  const failFlowWrite = (from, to) => { if (to === path.join(root, `.ai-agent-kit/product/${id}/flow.json`)) throw new Error("injected operator persistence failure"); return rename(from, to); };
  try { fs.renameSync = failFlowWrite; assert.throws(() => recordProductRelease({ target: root, id, file }), /injected operator/); } finally { fs.renameSync = rename; }
  assert.equal(inspectProductFlow({ target: root, id }).next_step.id, "release");
  assert.equal(recordProductRelease({ target: root, id, file }).next_step.id, "sanity");
  const evidencePath = `.ai-agent-kit/product/${id}/readback.json`; writeDeliveryJson(root, evidencePath, { synthetic: true, artifact: artifact.sha256, status: "PASSED" });
  const sanity = { schema_version: 1, task_id: id, input_hash: deliveryInput(root, id), artifact_sha256: artifact.sha256, environment: "wrong target", environment_kind: "FIXTURE", readback_reference: "fixture://readback/1", observation_started_at: new Date(Date.now() - 1000).toISOString(), observation_finished_at: new Date().toISOString(), required_observation_ms: 1, evidence: [{ path: evidencePath, sha256: readDeliveryFile(root, evidencePath).sha256, status: "PASSED" }], identity: operator.identity };
  const sanityFile = `.ai-agent-kit/product/${id}/sanity.json`; writeDeliveryJson(root, sanityFile, signRecord(root, sanity, operator, "release.sanity")); assert.throws(() => recordProductSanity({ target: root, id, file: sanityFile }), /binding mismatch/);
  sanity.environment = "fixture target"; const finished = sanity.observation_finished_at; sanity.observation_finished_at = new Date(Date.now() + 60000).toISOString();
  writeDeliveryJson(root, sanityFile, signRecord(root, sanity, operator, "release.sanity")); assert.throws(() => recordProductSanity({ target: root, id, file: sanityFile }), /window has not completed/);
  sanity.observation_finished_at = finished; writeDeliveryJson(root, sanityFile, signRecord(root, sanity, operator, "release.sanity")); try { fs.renameSync = failFlowWrite; assert.throws(() => recordProductSanity({ target: root, id, file: sanityFile }), /injected operator/); } finally { fs.renameSync = rename; }
  assert.equal(inspectProductFlow({ target: root, id }).next_step.id, "sanity");
  const accepted = recordProductSanity({ target: root, id, file: sanityFile });
  const persisted = readDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`);
  assert.equal(persisted.operator_actions.length, 2);
  assert.equal(persisted.operator_actions[0].nonce, release.action.nonce);
  // Simulate a crash after the flow rename but before SQLite commits its nonce.
  withTeamControlStore({ target: root }, (store) => store.database.prepare("DELETE FROM action_nonces WHERE task_id = ?").run(id));
  const restoreFlow = () => writeDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`, persisted);
  const withoutSanity = { ...persisted, release: { ...persisted.release } }; delete withoutSanity.release.sanity; delete withoutSanity.flow_hash; withoutSanity.flow_hash = deliveryDigest(withoutSanity);
  writeDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`, withoutSanity);
  assert.throws(() => recordProductSanity({ target: root, id, file: sanityFile }), /already been persisted/);
  const withoutRelease = { ...persisted, release: null }; delete withoutRelease.flow_hash; withoutRelease.flow_hash = deliveryDigest(withoutRelease);
  writeDeliveryJson(root, `.ai-agent-kit/product/${id}/flow.json`, withoutRelease);
  assert.throws(() => recordProductRelease({ target: root, id, file }), /already been persisted/);
  restoreFlow(); assert.equal(accepted.evidence.level, "OPERATOR_ATTESTED_FIXTURE"); assert.equal(accepted.status, "TARGET_ATTESTED");
  assert.equal(accepted.next_step.id, "monitor");
  const demo = `.ai-agent-kit/product/${id}/demo.md`; fs.writeFileSync(path.join(root, demo), "Recorded fixture demo\n"); const documented = recordProductDocument({ target: root, id, kind: "demo", file: demo, owner: "fixture-owner", summary: "Fixture presenter notes" });
  assert.notEqual(documented.next_step.id, "monitor"); assert.equal(documented.review.status, "STALE");
  fs.appendFileSync(path.join(root, demo), "Changed demo\n"); const stale = inspectProductFlow({ target: root, id }); assert.equal(stale.status, "STALE"); assert.equal(stale.next_step.id, "repair");
  fs.writeFileSync(path.join(root, artifactPath), "different artifact"); assert.notEqual(inspectProductFlow({ target: root, id }).status, "LIVE_VERIFIED");
});

function productionContract(root) {
  const contract = readDeliveryJson(root, `.ai-agent-kit/product/${id}/input.json`);
  contract.schema_version = 2; contract.revision += 1;
  for (const kind of ["budget", "timeline", "stories", "tasks"]) {
    const file = `.ai-agent-kit/product/${id}/${kind}.md`; fs.writeFileSync(path.join(root, file), `# ${kind}\nSynthetic ownership fixture; not a production plan.\n`);
    contract.documents.push({ id: kind, kind, path: file, sha256: readDeliveryFile(root, file).sha256, owner: "fixture-owner", summary: `Synthetic ${kind} source` });
  }
  const source = { path: contract.documents[0].path, sha256: contract.documents[0].sha256 };
  contract.tasks[0].story_id = "STORY-1"; contract.tasks[0].estimate_hours = 2;
  contract.quality = { policy: "AAK-PRODUCTION-1", controls: PRODUCTION_RULES.map((rule) => ({ id: rule.id, document_id: rule.document_kind, applicability: "REQUIRED", fields: Object.fromEntries(rule.fields.map((f) => [f, `Fixture ${f} declaration requires reviewer judgment`])), sources: [source], check_ids: rule.executable ? ["ownership"] : [] })), stack: { languages: [{ name: "JavaScript", version: "ES2022", rationale: "Fixture source language", evidence: source }], runtimes: [{ name: "Node", version: "20+", rationale: "Fixture process runtime", evidence: source }], frameworks: [{ name: "Node standard library", version: "20+", rationale: "No external fixture framework", evidence: source }] }, measurements: ["PERF-BUDGET", "MEMORY-LIFECYCLE"].map((control_id, index) => ({ id: `MEASURE-${index}`, control_id, metric: "Fixture metric declaration", unit: "ms", limit: 10, comparison: "LTE", workload: "Synthetic fixture", environment: "local fixture", check_id: "ownership" })), budget: { currency: "USD", limit: 10, forecast: 2, owner: "fixture-owner", stop_condition: "Stop before spending above the approved ceiling" }, stories: [{ id: "STORY-1", actor: "account owner", outcome: "view owned account", acceptance_ids: ["AC-1"] }], milestones: [{ id: "MILESTONE-1", start: "2026-10-02T00:00:00Z", end: "2026-10-03T00:00:00Z", capacity_hours: 4, task_ids: ["CODE-1"] }] };
  return contract;
}
test("production policy identifies legacy gaps without inventing assurance", () => {
  const root = fixture(); const report = inspectProductFlow({ target: root, id });
  assert.equal(inspectProductionHarness(root, id).evidence_complete, false);
  const taskReport = buildFinalTaskReport({ target: root, id, productionTarget: true });
  assert.equal(taskReport.production_harness.evidence_complete, false);
  assert.ok(taskReport.production_readiness.blockers.some((blocker) => /production harness/.test(blocker)));
  assert.equal(report.quality.evidence_complete, false); assert.ok(report.quality.controls.every((c) => c.status === "MISSING"));
  assert.match(renderProductFlow(report), /Incomplete production harness/);
  assert.match(fs.readFileSync(writeProductView({ target: root, id }).path, "utf8"), /Production document and engineering checks/);
});
test("production contract binds every document control, stack, budget, story and timeline", () => {
  const root = fixture(); const contract = productionContract(root);
  assert.doesNotThrow(() => validateProductContract(root, contract, id));
  assert.equal(productionHarnessReport(contract).evidence_complete, false);
  assert.equal(productionHarnessReport(contract, ["ownership"]).evidence_complete, false);
  const reject = (modify, pattern) => { const copy = structuredClone(contract); modify(copy); assert.throws(() => validateProductContract(root, copy, id), pattern); };
  reject((c) => c.quality.controls.pop(), /Missing production rule/);
  reject((c) => c.quality.controls[0].sources[0].sha256 = "0".repeat(64), /stale/);
  reject((c) => c.quality.controls[0].fields.owner = "TODO", /concrete/);
  reject((c) => c.quality.controls[0].applicability = "NOT_APPLICABLE", /cannot be excluded/);
  reject((c) => c.quality.controls.find((r) => r.id === "PERF-BUDGET").check_ids = ["unmapped"], /acceptance criterion/);
  reject((c) => c.quality.stack.languages[0].evidence.sha256 = "0".repeat(64), /stale/);
  reject((c) => c.quality.budget.forecast = 11, /Budget/);
  reject((c) => c.quality.measurements[0].limit = -1, /numeric bound/);
  reject((c) => c.quality.measurements.pop(), /measurable budget/);
  reject((c) => c.tasks[0].story_id = "UNKNOWN", /known story/);
  reject((c) => c.quality.milestones[0].capacity_hours = 1, /capacity/);
  reject((c) => c.quality.milestones[0].end = c.quality.milestones[0].start, /dates/);
  reject((c) => c.quality.milestones[0].start = "2026-02-30T00:00:00Z", /dates/);
  reject((c) => c.quality.private_key_pem = "hidden", /credentials/);
  reject((c) => c.quality.budget.stop_condition = "password: hidden-value", /secret-like/);
  const file = `.ai-agent-kit/product/${id}/input.json`; writeDeliveryJson(root, file, contract); bindProductContract({ target: root, id, file }); approveProductPlan({ target: root, id, approvedBy: "fixture-owner" });
  assert.equal(inspectProductFlow({ target: root, id }).quality.evidence_complete, false);
  execute(root); assert.equal(inspectProductFlow({ target: root, id }).quality.evidence_complete, false);
  const observations = contract.quality.measurements.map((m) => ({ id: m.id, value: 5, unit: m.unit, workload: m.workload, environment: m.environment }));
  const checkFile = path.join(root, "check.mjs"); const script = fs.readFileSync(checkFile, "utf8");
  observations[0].value = 11; fs.writeFileSync(checkFile, script + `console.log(${JSON.stringify(JSON.stringify({ measurements: observations }))});\n`);
  execute(root); assert.equal(inspectProductFlow({ target: root, id }).quality.controls.find((c) => c.id === "PERF-BUDGET").status, "FAILED");
  observations[0].value = 5; fs.writeFileSync(checkFile, script + `console.log(${JSON.stringify(JSON.stringify({ measurements: observations }))});\n`);
  execute(root); assert.equal(inspectProductFlow({ target: root, id }).quality.evidence_complete, true);
  assert.equal(inspectProductionHarness(root, id).evidence_complete, true);
  const sourcePath = `.ai-agent-kit/product/${id}/external-source.md`; fs.writeFileSync(path.join(root, sourcePath), "Synthetic independently located source\n");
  contract.revision += 1; contract.quality.controls[0].sources = [{ path: sourcePath, sha256: readDeliveryFile(root, sourcePath).sha256 }];
  writeDeliveryJson(root, file, contract); bindProductContract({ target: root, id, file }); approveProductPlan({ target: root, id, approvedBy: "fixture-owner" });
  fs.appendFileSync(path.join(root, sourcePath), "Changed assertion\n");
  assert.throws(() => deliveryInput(root, id), /source evidence is stale/);
  assert.throws(() => transitionTask({ target: root, id, to: "VERIFYING", evidence: { diff_scope: "fixture approved scope" } }), /source evidence is stale/);
  assert.equal(inspectProductFlow({ target: root, id }).status, "STALE");
});


test("product inventory is read-only, explicit and rejects corrupt or linked flows", async () => {
  const root = fixture();
  try {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(),"aak-inventory-empty-"));
    try { assert.deepEqual(listProductFlows({target:empty}).products, []); } finally { fs.rmSync(empty,{recursive:true,force:true}); }
    startProductFlow({target:root,id:"SALON",goal:"Build salon appointments"});
    startProductFlow({target:root,id:"SHOP",goal:"Build shop inventory"});
    const active = fs.readFileSync(path.join(root,".ai-agent-kit/product/active.json"),"utf8");
    const logs = [];
    assert.equal(await main(["delivery","list","--target",root,"--format","json"], {log:s=>logs.push(s)}),0);
    assert.deepEqual(JSON.parse(logs[0]).products.map(p=>p.task_id),["PRODUCT-1","SALON","SHOP"]);
    assert.equal(fs.readFileSync(path.join(root,".ai-agent-kit/product/active.json"),"utf8"),active);
    const file = path.join(root,".ai-agent-kit/product/SALON/flow.json");
    const flow = JSON.parse(fs.readFileSync(file,"utf8")); flow.goal="tampered";
    fs.writeFileSync(file,JSON.stringify(flow));
    assert.throws(()=>listProductFlows({target:root}),/integrity/);
    fs.rmSync(path.join(root,".ai-agent-kit/product/SALON"),{recursive:true});
    fs.symlinkSync(path.join(root,".ai-agent-kit/product/SHOP"),path.join(root,".ai-agent-kit/product/LINK"),"dir");
    assert.throws(()=>listProductFlows({target:root}),/unsupported/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test("delivery view commands keep the execution namespace distinct from Genesis", () => {
  const root = fixture();
  try {
    const view = writeProductView({target:root,id});
    const html = fs.readFileSync(view.path,"utf8");
    assert.match(html,/ai-agent-kit delivery next/);
    assert.match(html,/ai-agent-kit delivery view/);
    assert.doesNotMatch(html,/ai-agent-kit product (next|view)/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
