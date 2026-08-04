import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { buildProofReplay, demoProof, proofToOtlp, renderProofCard, renderProofReplayHtml, renderTrustBadge, writeProofArtifacts } from "../src/proof-replay.mjs";
import { generatePolicyKey, initializePolicyBundle, signPolicyFile, verifyPolicyFile } from "../src/policy-overlays.mjs";
import { parseFailureArgs, parsePassportArgs, parsePolicyArgs, parseProofArgs } from "../src/cli.mjs";
import { createTask, inspectTask, simulateAction } from "../src/governed-runtime.mjs";
import { planFailureLab, runFailureLab, writeFailureReport } from "../src/failure-lab.mjs";
import { generatePassportKey, issueChangePassport, verifyChangePassport } from "../src/change-passport.mjs";
import { planTeam, startTeam } from "../src/team-orchestrator.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aak-proof-"));
}

test("demo creates a complete redacted proof pack without network dependencies", () => {
  const root = tempRoot();
  const proof = demoProof();
  const result = writeProofArtifacts({ target: root, output: ".ai-agent-kit/demo", proof, otlp: true });
  assert.match(fs.readFileSync(path.join(root, ".ai-agent-kit/.gitignore"), "utf8"), /^demo\/$/m);
  assert.equal(result.status, "GENERATED");
  for (const file of Object.values(result.files)) assert.equal(fs.existsSync(file), true);
  const html = fs.readFileSync(result.files.html, "utf8");
  assert.match(html, /Agent Proof Replay/);
  assert.match(html, /READY/);
  assert.doesNotMatch(html, /<script|https?:\/\//);
  assert.match(renderProofCard(proof), /AI Change Assurance/);
  assert.match(renderTrustBadge(proof), /governed ✓/);
  const otlp = proofToOtlp(proof);
  assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans.length, 8);
  assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans[0].attributes[0].key, "gen_ai.operation.name");
});

test("proof HTML escapes evidence-derived text and output cannot escape the repository", () => {
  const root = tempRoot();
  const proof = demoProof();
  proof.task.goal = "<img src=x onerror=alert(1)>";
  const html = renderProofReplayHtml(proof);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.throws(() => writeProofArtifacts({ target: root, output: "../outside", proof }), /must remain/);
});

test("policy CLI creates a trusted key, initializes, signs, and verifies a bundle", () => {
  const root = tempRoot();
  const key = generatePolicyKey({ target: root, keyId: "repo-owner", layer: "repository" });
  assert.match(fs.readFileSync(path.join(root, ".ai-agent-kit/.gitignore"), "utf8"), /^local\/$/m);
  const initialized = initializePolicyBundle({ target: root, layer: "repository", keyId: "repo-owner" });
  const bundleFile = path.join(root, initialized.file);
  const bundle = JSON.parse(fs.readFileSync(bundleFile, "utf8"));
  bundle.rules = { release: { mode: "ask" } };
  fs.writeFileSync(bundleFile, JSON.stringify(bundle, null, 2));
  assert.throws(() => signPolicyFile({ target: root, bundle: initialized.file, privateKey: key.private_key, keyId: "repo-owner" }), /--apply/);
  signPolicyFile({ target: root, bundle: initialized.file, privateKey: key.private_key, keyId: "repo-owner", apply: true });
  const verified = verifyPolicyFile({ target: root, bundle: initialized.file, kitVersion: "0.8.0" });
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.signer, "repo-owner");
  assert.equal(fs.statSync(path.join(root, key.private_key)).mode & 0o777, 0o600);
  assert.throws(() => initializePolicyBundle({ target: root, layer: "kit" }), /organization, team, repository, or task/);
});

test("proof and policy parsers require explicit bounded actions", () => {
  assert.deepEqual(parseProofArgs(["--id", "TASK-1", "--otlp"]), { target: process.cwd(), otlp: true, id: "TASK-1" });
  assert.throws(() => parseProofArgs([]), /requires --id/);
  const parsed = parsePolicyArgs(["sign", "--bundle", ".ai/policies/repository.json", "--private-key", ".ai-agent-kit/local/policy-keys/key.pem", "--apply"]);
  assert.equal(parsed.action, "sign");
  assert.equal(parsed.options.apply, true);
  assert.equal(parseFailureArgs(["plan", "--manifest", "failure.json"]).action, "plan");
  assert.throws(() => parseFailureArgs(["run", "--manifest", "failure.json", "--timeout-ms", "10"]), /100-600000/);
  assert.equal(parsePassportArgs(["verify", "--file", "passport.json"]).action, "verify");
});

test("policy simulation is read-only and never records or executes", () => {
  const root = tempRoot();
  execFileSync("git", ["init", "-q"], { cwd: root });
  createTask({ target: root, id: "SIM-1", tools: ["read"], paths: ["src/**"] });
  const before = inspectTask({ target: root, id: "SIM-1" });
  const result = simulateAction({ target: root, id: "SIM-1", tool: "read", path: "src/app.mjs" });
  const after = inspectTask({ target: root, id: "SIM-1" });
  assert.equal(result.mode, "SIMULATION");
  assert.equal(result.recorded, false);
  assert.equal(result.executed, false);
  assert.equal(after.action_count, before.action_count);
});

test("failure lab previews safely, redacts output, and requires explicit execution", () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "failure-case.mjs"), "process.stderr.write('private output');\n");
  const manifestFile = path.join(root, "failure-lab.json");
  fs.writeFileSync(manifestFile, JSON.stringify({ schema_version: 1, cases: [{ id: "timeout-path", category: "resilience", command: ["node", "failure-case.mjs"], expected_exit_code: 0, env: { FAILURE_MODE: "timeout" } }] }));
  const preview = planFailureLab({ target: root, manifest: "failure-lab.json" });
  assert.equal(preview.executed, false);
  assert.throws(() => runFailureLab({ target: root, manifest: "failure-lab.json" }), /requires --apply/);
  const report = runFailureLab({ target: root, manifest: "failure-lab.json", apply: true });
  assert.equal(report.status, "PASSED");
  assert.doesNotMatch(JSON.stringify(report), /private output/);
  const written = writeFailureReport({ target: root, report });
  assert.equal(fs.existsSync(path.join(root, written.file)), true);
  assert.match(fs.readFileSync(path.join(root, ".ai-agent-kit/.gitignore"), "utf8"), /^failure-lab\/$/m);
  fs.writeFileSync(path.join(root, "bad.json"), JSON.stringify({ schema_version: 1, cases: [{ id: "bad", command: ["sh", "-c", "exit 0"] }] }));
  assert.throws(() => planFailureLab({ target: root, manifest: "bad.json" }), /not allowed/);
});

test("change passport signs READY proof and rejects tampering or untrusted identity", () => {
  const root = tempRoot();
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "passport@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Passport"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "passport\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "passport fixture"], { cwd: root });
  const key = generatePassportKey({ target: root, keyId: "maintainer" });
  assert.equal(fs.statSync(path.join(root, key.private_key)).mode & 0o777, 0o600);
  const issued = issueChangePassport({ target: root, id: "PASS-1", keyId: "maintainer", privateKey: key.private_key, apply: true }, { buildProofReplay: () => demoProof() });
  const file = path.join(root, issued.file);
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "VERIFIED");
  fs.appendFileSync(path.join(root, "README.md"), "changed\n");
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "STALE");
  fs.writeFileSync(path.join(root, "README.md"), "passport\n");
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "VERIFIED");
  const original = fs.readFileSync(file, "utf8");
  const passport = JSON.parse(original);
  passport.assurance.readiness = "NOT_READY";
  fs.writeFileSync(file, JSON.stringify(passport));
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "REJECTED");
  fs.writeFileSync(file, original);
  const store = path.join(root, ".ai/passports/trusted-keys.json");
  fs.writeFileSync(store, JSON.stringify({ schema_version: 1, keys: [] }));
  assert.equal(verifyChangePassport({ target: root, file: issued.file }).status, "VALID_UNTRUSTED");
});

test("proof readiness fails closed when receipt integrity is tampered", () => {
  const root = tempRoot();
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "proof@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Proof"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "proof\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "proof fixture"], { cwd: root });
  createTask({ target: root, id: "PROOF-1", goal: "private prompt must be hashed" });
  const initial = buildProofReplay({ target: root, id: "PROOF-1" });
  assert.equal(initial.evidence.status, "VERIFIED");
  assert.equal(initial.task.goal, "Governed task PROOF-1");
  assert.doesNotMatch(JSON.stringify(initial), /private prompt/);
  const ledger = path.join(root, ".ai-agent-kit/runtime/evidence/PROOF-1.jsonl");
  const receipts = fs.readFileSync(ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const receipt = receipts[0];
  receipt.data.state = "TAMPERED";
  fs.writeFileSync(ledger, `${[receipt, ...receipts.slice(1)].map((item) => JSON.stringify(item)).join("\n")}\n`);
  const rejected = buildProofReplay({ target: root, id: "PROOF-1" });
  assert.equal(rejected.evidence.status, "REJECTED");
  assert.equal(rejected.readiness.status, "NOT_READY");
});

test("proof binds workcell type, execution mode, and incomplete team readiness", () => {
  const root = tempRoot();
  execFileSync("git", ["init", "-q"], { cwd: root });
  createTask({ target: root, id: "TEAM-PROOF", goal: "Implement a new API feature", risk: "medium", paths: ["src/**"] });
  planTeam({ target: root, id: "TEAM-PROOF" });
  startTeam({ target: root, id: "TEAM-PROOF", adapter: "codex" });
  const proof = buildProofReplay({ target: root, id: "TEAM-PROOF" });
  assert.equal(proof.team.team_type, "PRODUCT_WORKCELL");
  assert.equal(proof.team.execution_mode, "NATIVE_SUBAGENTS");
  assert.equal(proof.team.review_independence, "VERIFIED");
  assert.equal(proof.team.status, "NOT_READY");
  assert.match(renderProofReplayHtml(proof), /Engineering team/);
});
