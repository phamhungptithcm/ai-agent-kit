import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  addProductQuestion,
  analyzeProduct,
  answerProductQuestion,
  approveProductBaseline,
  convergeProduct,
  createProductWorkspace,
  exportProductDossier,
  inspectProduct,
  inspectProductDossier,
  nextProductAction,
  planProductGithubIssues,
  productDigest,
  putProductArtifact,
  recordProductContext,
  recordProductEnvironment,
  recordProductEvidence,
  prepareProductReleaseCandidate,
  resumeProduct,
  syncProductGithubIssues,
  validateProductArtifact,
  verifyProductEvidence
} from "../src/product-genesis.mjs";

function repository(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aak-product-${label}-`));
  fs.writeFileSync(path.join(root, ".gitignore"), ".ai/\ninputs/\ndossier.md\n");
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "product-test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Product Test"], { cwd: root });
  spawnSync("git", ["remote", "add", "origin", `https://github.com/hunpeolabs/${label}.git`], { cwd: root });
  spawnSync("git", ["add", ".gitignore"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "test: initialize product fixture"], { cwd: root });
  return root;
}

function gitCommit(root, message = "test: add product evidence") {
  const paths = ["reports", "src", "test"].filter((item) => fs.existsSync(path.join(root, item)));
  spawnSync("git", ["add", "--", ...paths], { cwd: root });
  const result = spawnSync("git", ["commit", "-qm", message], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
}

function evidenceInput(root, now, { id, kind = "TEST_REPORT", trust = "REPOSITORY_BOUND", environment = null, file = "reports/discovery.txt", status = "PASSED" } = {}) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const bytes = fs.readFileSync(path.join(root, file));
  return {
    schema_version: 1, id, kind, status, trust_level: trust, producer: "Product test verifier",
    collected_at: now(), expires_at: "2027-08-20T12:00:00.000Z",
    repository: { commit, remote },
    subject: { path: file, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length },
    environment_attestation_id: environment, provider: trust === "PROVIDER_VERIFIED" ? { name: "test-provider", run_id: id, url: `https://provider.example/runs/${id}` } : null,
    summary: `${kind} evidence for ${id}`, limitations: ["Deterministic test fixture"]
  };
}

function writeJson(root, name, value) {
  const relative = path.join("inputs", name);
  fs.mkdirSync(path.join(root, "inputs"), { recursive: true });
  fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
  return relative;
}

function clock() {
  let minute = 0; const base = Date.parse("2026-08-20T12:00:00.000Z");
  return () => new Date(base + minute++ * 60_000).toISOString();
}

test("Product Genesis governs idea through approved delivery, GitHub preview, and convergence", () => {
  const root = repository("flow"), now = clock(), id = "salon-pilot";
  const created = createProductWorkspace({ target: root, id, name: "Salon Pilot", idea: "An app that helps small salon owners manage appointments and reduce no-shows.", profile: "STANDARD", actor: "Alex", timestamp: now() });
  assert.equal(created.status, "CREATED");
  assert.equal(created.product.current_questions.length, 3);
  assert.equal(nextProductAction({ target: root, id }).skill, "discuss-product-idea");
  assert.equal(resumeProduct({ target: root, id }).prompt_context.questions.length, 3);

  assert.throws(() => addProductQuestion({ target: root, id, questionId: "Q-DUP", question: created.product.current_questions[0].text, rationale: "duplicate", timestamp: now() }), /duplicate product question/);
  for (const [questionId, answer] of [
    ["Q-PROBLEM", "Independent salon owners lose revenue because appointment tracking and reminders are fragmented."],
    ["Q-WORKAROUND", "They use paper, chat, and spreadsheets, spending about five hours each week reconciling bookings."],
    ["Q-OUTCOME", "Reduce missed appointments by 20% within eight weeks for the pilot cohort."]
  ]) answerProductQuestion({ target: root, id, questionId, answer, actor: "Alex", timestamp: now() });
  const resumedDiscovery = resumeProduct({ target: root, id });
  assert.equal(resumedDiscovery.prompt_context.answered_questions.length, 3);
  assert.equal(resumedDiscovery.prompt_context.context.confirmed.length, 3);

  const researchFile = writeJson(root, "research.json", {
    schema_version: 1, id: "RESEARCH-SALON-PILOT", version: 1, idea_version: "IDEA-SALON-PILOT@1",
    questions: [{ id: "RQ-001", question: "Is reminder pain material?", decision_criterion: "At least three credible workflow signals" }],
    evidence: [{ id: "EV-001", kind: "USER_INTERVIEW", source: "Three consented pilot interviews", retrieved_at: now(), claim: "All three owners manually reconcile reminders", confidence: "MEDIUM", limitations: ["Small convenience sample"] }],
    findings: [{ id: "F-001", statement: "Manual reminder work is a repeated pilot pain", evidence_ids: ["EV-001"] }], limitations: ["No willingness-to-pay validation"],
    decision: { recommendation: "PROCEED", rationale: "Proceed with a bounded workflow pilot while testing willingness to pay." }
  });
  assert.equal(putProductArtifact({ target: root, id, type: "research", file: researchFile, timestamp: now() }).status, "RECORDED");
  const staleResearchRoot = path.join(repository("stale-research"), "repo");
  fs.cpSync(root, staleResearchRoot, { recursive: true });
  const ideaV2File = writeJson(staleResearchRoot, "idea-v2.json", {
    schema_version: 1, id: "IDEA-SALON-PILOT", version: 2, status: "DISCOVERY", created_at: now(), created_by: "Alex",
    raw_idea: "An appointment and reminder pilot for independent salons.", problem: "Validate the current salon workflow pain.", people: ["Independent salon owner"], desired_outcomes: ["Lower no-shows"], constraints: ["Pilot only"], assumptions: [], unknowns: [], parent_versions: ["IDEA-SALON-PILOT@1"]
  });
  putProductArtifact({ target: staleResearchRoot, id, type: "idea", file: ideaV2File, timestamp: now() });
  const staleResearch = analyzeProduct({ target: staleResearchRoot, id, gate: "DISCOVERY_DECISION", timestamp: now() });
  assert.equal(staleResearch.status, "BLOCKED");
  assert.ok(staleResearch.findings.some((item) => item.code === "RESEARCH_IDEA_STALE"));
  assert.equal(analyzeProduct({ target: root, id, gate: "DISCOVERY_DECISION", timestamp: now() }).status, "READY_FOR_APPROVAL");
  assert.throws(() => approveProductBaseline({ target: root, id, type: "DISCOVERY_DECISION", approver: "agent", authority: "Product owner", scope: ["Pilot discovery"], timestamp: now() }), /named human approver/);
  approveProductBaseline({ target: root, id, type: "DISCOVERY_DECISION", approver: "Alex Nguyen", authority: "Product owner", scope: ["Salon pilot discovery evidence"], timestamp: now() });

  recordProductContext({ target: root, id, category: "ASSUMPTION", contextId: "CTX-PRICE", statement: "Owners may pay for measurable no-show reduction.", source: "TEAM_HYPOTHESIS", actor: "Alex", timestamp: now() });
  assert.equal(inspectProduct({ target: root, id }).stage, "NEEDS_DECISION");
  const brd = {
    schema_version: 1, id: "BRD-SALON-PILOT", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["IDEA-SALON-PILOT@1", "RESEARCH-SALON-PILOT@1"],
    problem: "Small salon owners lose time and revenue managing fragmented appointments and reminders.",
    stakeholders: [{ role: "Product owner", decision_rights: ["Pilot scope", "Budget"] }],
    goals: [{ id: "GOAL-001", outcome: "Fewer missed appointments", metric: "No-show rate", baseline: "Pilot baseline", target: "20% relative reduction", window: "8 weeks", owner: "Product owner" }],
    scope: ["Appointment capture", "Reminder workflow", "Pilot outcome measurement"], non_goals: ["Payroll", "Inventory"],
    requirements: [{ id: "BR-001", statement: "The pilot must let an authorized salon operator schedule an appointment and trigger a reminder.", rationale: "Tests the primary value loop.", priority: "MUST", status: "PROPOSED", source_ids: ["EV-001"], acceptance_method: "End-to-end pilot scenario", owner: "Product owner" }],
    risks: ["Reminder delivery dependency"], decisions: ["Pilot is limited to one salon timezone"]
  };
  const brdFile = writeJson(root, "brd.json", brd);
  assert.throws(() => putProductArtifact({ target: root, id, type: "brd", file: brdFile, timestamp: now() }), /current investment approval/);
  approveProductBaseline({ target: root, id, type: "DISCOVERY_DECISION", approver: "Alex Nguyen", authority: "Product owner", scope: ["Discovery evidence plus CTX-PRICE assumption"], timestamp: now() });
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports/discovery.txt"), "Three pilot interviews, one prototype task set, and the recorded decision threshold passed.\n");
  gitCommit(root, "test: add discovery evidence");
  for (const [evidenceIdValue, kind] of [["EVID-DISCOVERY", "CUSTOMER_RESEARCH"], ["EVID-USABILITY", "USABILITY_TEST"], ["EVID-ACCESSIBILITY-DISCOVERY", "ACCESSIBILITY_REVIEW"], ["EVID-PRIVACY-DISCOVERY", "PRIVACY_LEGAL_REVIEW"], ["EVID-THREAT", "THREAT_MODEL"]]) {
    const discoveryReceiptFile = writeJson(root, `${evidenceIdValue}.json`, evidenceInput(root, now, { id: evidenceIdValue, kind }));
    recordProductEvidence({ target: root, id, file: discoveryReceiptFile, timestamp: now() });
  }
  const discoveryValidationFile = writeJson(root, "discovery-validation.json", {
    schema_version: 1, id: "DISCOVERY-VALIDATION-SALON", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["IDEA-SALON-PILOT@1", "RESEARCH-SALON-PILOT@1"],
    hypotheses: [{ id: "HYP-001", statement: "Operators complete the reminder loop without assistance", risk: "Usability", success_criterion: "At least 3 of 3 pilot operators complete the critical task", status: "SUPPORTED", evidence_receipt_ids: ["EVID-DISCOVERY"] }],
    experiments: [{ id: "EXP-001", hypothesis_id: "HYP-001", method: "Moderated workflow prototype", success_criterion: "3 of 3 critical-task completions", result: "Threshold met in the bounded sample", decision: "CONTINUE", evidence_receipt_ids: ["EVID-DISCOVERY"] }],
    prototypes: [{ id: "PROTO-001", summary: "Appointment-to-reminder workflow prototype", evidence_receipt_ids: ["EVID-USABILITY"] }],
    usability_tests: [{ id: "UT-001", summary: "Three consented pilot task sessions", evidence_receipt_ids: ["EVID-USABILITY"] }],
    customer_evidence: [{ id: "CE-001", summary: "Three owner workflow interviews", evidence_receipt_ids: ["EVID-DISCOVERY"] }],
    decision: { recommendation: "CONTINUE", rationale: "The bounded Alpha threshold passed; willingness-to-pay remains a tracked assumption.", evidence_receipt_ids: ["EVID-DISCOVERY"] }
  });
  putProductArtifact({ target: root, id, type: "discovery-validation", file: discoveryValidationFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "ALPHA_DECISION", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "ALPHA_DECISION", approver: "Alex Nguyen", authority: "Product owner", scope: ["HYP-001 and EXP-001 bounded Alpha"], timestamp: now() });

  const viabilityFile = writeJson(root, "business-viability.json", {
    schema_version: 1, id: "VIABILITY-SALON", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["DISCOVERY-VALIDATION-SALON@1"],
    assumptions: [{ id: "VA-001", statement: "A paid reminder workflow can cover delivery and support cost", evidence_receipt_ids: ["EVID-DISCOVERY"] }],
    unit_economics: { currency: "USD", unit: "active salon month", model: "Range model; no live revenue claim", confidence: "LOW", evidence_receipt_ids: ["EVID-DISCOVERY"] },
    pricing_options: [{ id: "PRICE-001", model: "Monthly pilot subscription", evidence_receipt_ids: ["EVID-DISCOVERY"] }],
    go_to_market: [{ id: "GTM-001", segment: "Independent salons", channel: "Owner-led pilot", evidence_receipt_ids: ["EVID-DISCOVERY"] }], risks: ["Willingness to pay remains unvalidated"],
    decision: { recommendation: "INVEST", rationale: "Fund only the bounded pilot and measure willingness to pay." }
  });
  putProductArtifact({ target: root, id, type: "business-viability", file: viabilityFile, timestamp: now() });
  const trustFile = writeJson(root, "trust-compliance.json", {
    schema_version: 1, id: "TRUST-SALON", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["DISCOVERY-VALIDATION-SALON@1"], markets: ["US pilot"],
    accessibility: { status: "READY", rationale: "Keyboard and screen-reader critical flow reviewed", evidence_receipt_ids: ["EVID-ACCESSIBILITY-DISCOVERY"] },
    privacy_legal: [{ market: "US pilot", status: "READY", owner: "Product owner", rationale: "Pilot consent, retention, and processor terms are requirements; not legal advice", requirements: ["Consent", "Retention"], evidence_receipt_ids: ["EVID-PRIVACY-DISCOVERY"] }],
    threat_model: { status: "READY", rationale: "Tenant boundary and reminder-provider abuse paths reviewed", evidence_receipt_ids: ["EVID-THREAT"] }, security_findings: []
  });
  putProductArtifact({ target: root, id, type: "trust-compliance", file: trustFile, timestamp: now() });
  const dataFile = writeJson(root, "data-lifecycle.json", {
    schema_version: 1, id: "DATA-SALON", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["DISCOVERY-VALIDATION-SALON@1"],
    data_classes: [{ id: "DC-001", data: "Appointment contact and schedule", classification: "PERSONAL" }], retention_rules: [{ id: "RET-001", period: "Pilot plus 30 days", owner: "Product owner" }],
    migrations: [{ id: "MIG-001", strategy: "Forward-compatible appointment schema", rollback: "Restore prior schema and replay accepted writes", status: "PLANNED", evidence_receipt_ids: ["EVID-DISCOVERY"] }], retained_data_validations: [{ id: "RDV-001", status: "PLANNED", evidence_receipt_ids: ["EVID-DISCOVERY"] }], deletion_workflows: [{ id: "DEL-001", trigger: "Pilot exit", owner: "Product owner", verification: "Provider and database deletion receipts", evidence_receipt_ids: ["EVID-DISCOVERY"] }]
  });
  putProductArtifact({ target: root, id, type: "data-lifecycle", file: dataFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "INVESTMENT_DECISION", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "INVESTMENT_DECISION", approver: "Alex Nguyen", authority: "Product and business owner", scope: ["Bounded pilot viability, trust, and data lifecycle"], timestamp: now() });
  assert.equal(validateProductArtifact("brd", brd).status, "VALID");
  putProductArtifact({ target: root, id, type: "brd", file: brdFile, timestamp: now() });
  const rulesFile = writeJson(root, "rules.json", {
    schema_version: 1, id: "RULES-SALON-PILOT", version: 1, status: "READY_FOR_APPROVAL", source_versions: ["BRD-SALON-PILOT@1"],
    rules: [{ id: "RULE-001", name: "Operator authorization", condition: "An operator manages an appointment", outcome: "Only appointments for that operator's salon may be viewed or changed", owner: "Product owner", source_requirement_ids: ["BR-001"], examples: ["Salon A cannot access Salon B"], exceptions: [] }]
  });
  putProductArtifact({ target: root, id, type: "business-rules", file: rulesFile, timestamp: now() });
  const staleRulesRoot = path.join(repository("stale-rules"), "repo");
  fs.cpSync(root, staleRulesRoot, { recursive: true });
  const changedBrd = structuredClone(brd); changedBrd.version = 2; changedBrd.problem = "Updated salon workflow problem that requires a reviewed business-rule successor.";
  const changedBrdFile = writeJson(staleRulesRoot, "brd-v2.json", changedBrd);
  putProductArtifact({ target: staleRulesRoot, id, type: "brd", file: changedBrdFile, timestamp: now() });
  const staleRules = analyzeProduct({ target: staleRulesRoot, id, gate: "BUSINESS_REQUIREMENTS", timestamp: now() });
  assert.equal(staleRules.status, "BLOCKED");
  assert.ok(staleRules.findings.some((item) => item.code === "BUSINESS_RULES_BRD_STALE"));
  assert.equal(analyzeProduct({ target: root, id, gate: "BUSINESS_REQUIREMENTS", write: true, timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "BUSINESS_REQUIREMENTS", approver: "Alex Nguyen", authority: "Product owner", scope: ["BR-001 and RULE-001"], timestamp: now() });

  const brdHead = inspectProduct({ target: root, id }).artifacts.brd;
  const spec = {
    schema_version: 1, id: "SPEC-SALON-PILOT", version: 1, status: "READY_FOR_APPROVAL", approved_brd: { id: brdHead.id, version: brdHead.version, hash: brdHead.hash },
    journeys: [{ id: "J-001", actor: "Salon operator", trigger: "Customer requests a booking", happy_path: ["Create appointment", "Schedule reminder", "Record delivery"], bad_paths: ["Reminder provider unavailable", "Time slot conflict"], outcome: "Tracked appointment and reminder", requirement_ids: ["BR-001"] }],
    functional_requirements: [{ id: "FR-001", statement: "An authorized operator can create an appointment and schedule its reminder.", source_requirement_ids: ["BR-001"], verification_ids: ["AC-001"] }],
    non_functional_requirements: [{ id: "NFR-001", statement: "95% of accepted appointment commands complete within 2 seconds during the pilot load.", source_requirement_ids: ["BR-001"], verification_ids: ["AC-001"] }],
    acceptance_criteria: [{ id: "AC-001", given: "An authorized operator and available time slot", when: "The operator creates an appointment", then: "The appointment and reminder schedule are persisted and visible", verifies: ["FR-001", "NFR-001"] }],
    data_and_integrations: [{ id: "INT-001", kind: "PROVIDER", data: "Reminder request and delivery status", owner: "Engineering", failure_behavior: "Retry with idempotency and surface terminal failure", requirement_ids: ["BR-001"] }],
    operations: { service_levels: ["Pilot command SLO"], observability: ["Reminder success and latency"], support: ["Operator retry guidance"], backup_restore: ["Daily backup with restore drill before pilot"], rollback: ["Disable reminder sending while retaining appointments"] },
    traceability: [{ source_id: "BR-001", target_ids: ["FR-001", "NFR-001", "AC-001"] }]
  };
  const specFile = writeJson(root, "spec.json", spec);
  putProductArtifact({ target: root, id, type: "specification", file: specFile, timestamp: now() });
  const specHead = inspectProduct({ target: root, id }).artifacts.specification;
  const tracks = ["ux", "domain", "data", "architecture", "security", "operations", "test", "rollout"].map((trackId) => ({ id: trackId, status: "READY", summary: `${trackId} design is bounded for the pilot`, rationale: "Required by STANDARD profile", artifacts: [`design/${trackId}.md`], requirement_ids: ["BR-001"], risks: [] }));
  const designFile = writeJson(root, "design.json", { schema_version: 1, id: "DESIGN-SALON-PILOT", version: 1, status: "READY_FOR_APPROVAL", risk_profile: "STANDARD", approved_brd: { id: brdHead.id, version: brdHead.version, hash: brdHead.hash }, specification: { id: specHead.id, version: specHead.version, hash: specHead.hash }, tracks, decisions: [], risks: [] });
  putProductArtifact({ target: root, id, type: "design", file: designFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "SOLUTION_BASELINE", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "SOLUTION_BASELINE", approver: "Alex Nguyen", authority: "Product owner", scope: ["BRD, rules, specification, and STANDARD design bundle"], timestamp: now() });

  const solution = inspectProduct({ target: root, id });
  const deliveryFile = writeJson(root, "delivery.json", {
    schema_version: 1, id: "DELIVERY-SALON-PILOT", version: 1, status: "READY_FOR_APPROVAL",
    approved_baselines: [{ id: brdHead.id, hash: brdHead.hash }, { id: "SOLUTION-SALON-PILOT", hash: solution.approvals.SOLUTION_BASELINE.artifact_hash }],
    mvp_outcome: "One salon completes the appointment-to-reminder loop and measures no-shows.", milestones: [{ id: "M-001", outcome: "Pilot loop verified" }],
    items: [{ id: "STORY-001", type: "STORY", title: "Complete appointment reminder loop", outcome: "Operator schedules and observes a reminder", parent_id: null, milestone_id: "M-001", requirement_ids: ["BR-001"], acceptance_ids: ["AC-001"], dependencies: [], estimate: { low: 3, high: 5, unit: "days", confidence: "MEDIUM" }, risk: "MEDIUM", assurance: ["Tenant authorization test", "Provider failure test", "Pilot telemetry"] }],
    definition_of_ready: ["Current solution baseline approved", "Acceptance and owner confirmed"], definition_of_done: ["Code, test, security, operations, rollback, and evidence traces recorded"]
  });
  putProductArtifact({ target: root, id, type: "delivery", file: deliveryFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "DELIVERY_BASELINE", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "DELIVERY_BASELINE", approver: "Alex Nguyen", authority: "Product owner", scope: ["STORY-001 pilot slice"], timestamp: now() });

  const planned = planProductGithubIssues({ target: root, id, repository: "hunpeolabs/salon-pilot", timestamp: now() });
  assert.equal(planned.status, "PREVIEW");
  let calls = 0;
  const runGh = (args) => {
    calls += 1;
    if (args[1] === "list") return { status: 0, stdout: "[]", stderr: "" };
    return { status: 0, stdout: "https://github.com/hunpeolabs/salon-pilot/issues/101\n", stderr: "" };
  };
  assert.equal(syncProductGithubIssues({ target: root, id }, { runGh }).status, "PREVIEW");
  assert.equal(calls, 0);
  const githubApproval = approveProductBaseline({ target: root, id, type: "GITHUB_ISSUE_PLAN", approver: "Alex Nguyen", authority: "Repository product owner", scope: ["Create STORY-001 issue only"], timestamp: now() });
  assert.throws(() => syncProductGithubIssues({ target: root, id, apply: true, approvalHash: "0".repeat(64), timestamp: now() }, { runGh }), /exact human approval hash/);
  const wrongRepositoryGh = (args) => args[1] === "list"
    ? { status: 0, stdout: "[]", stderr: "" }
    : { status: 0, stdout: "https://github.com/attacker/other/issues/9\n", stderr: "" };
  const ambiguousRoot = path.join(repository("github-ambiguous"), "repo");
  fs.cpSync(root, ambiguousRoot, { recursive: true });
  const partial = syncProductGithubIssues({ target: ambiguousRoot, id, apply: true, approvalHash: githubApproval.approval.approval_hash, timestamp: now() }, { runGh: wrongRepositoryGh });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.retry_safe, false);
  assert.match(partial.error, /did not return an issue URL/);
  const reconciliationGh = (args) => args[1] === "list"
    ? { status: 0, stdout: "[]", stderr: "" }
    : { status: 0, stdout: "https://github.com/hunpeolabs/salon-pilot/issues/102\n", stderr: "" };
  const reconciliationRequired = syncProductGithubIssues({ target: ambiguousRoot, id, apply: true, approvalHash: githubApproval.approval.approval_hash, timestamp: now() }, { runGh: reconciliationGh });
  assert.equal(reconciliationRequired.status, "RECONCILIATION_REQUIRED");
  const reconciled = syncProductGithubIssues({ target: ambiguousRoot, id, apply: true, approvalHash: githubApproval.approval.approval_hash, confirmAbsent: ["STORY-001"], timestamp: now() }, { runGh: reconciliationGh });
  assert.equal(reconciled.status, "APPLIED");
  let concurrentMutationChecked = false;
  const guardedRunGh = (args, input) => {
    if (args[1] === "list" && !concurrentMutationChecked) {
      assert.throws(() => recordProductContext({ target: root, id, category: "UNKNOWN", contextId: "CTX-RACE", statement: "Must not land during an approved GitHub apply.", actor: "Alex", timestamp: now() }), /active transaction completes/);
      concurrentMutationChecked = true;
    }
    return runGh(args, input);
  };
  const applied = syncProductGithubIssues({ target: root, id, apply: true, approvalHash: githubApproval.approval.approval_hash, timestamp: now() }, { runGh: guardedRunGh });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.created.length, 1);
  assert.equal(concurrentMutationChecked, true);
  assert.equal(calls, 2);
  const replayed = syncProductGithubIssues({ target: root, id, apply: true, approvalHash: githubApproval.approval.approval_hash, timestamp: now() }, { runGh });
  assert.equal(replayed.created.length, 0);
  assert.equal(replayed.skipped.length, 1);
  assert.equal(calls, 3);

  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/appointments.mjs"), "export const scheduleReminder = (appointment) => ({ ...appointment, reminder: 'scheduled' });\n");
  fs.writeFileSync(path.join(root, "test/appointments.test.mjs"), "// deterministic acceptance evidence fixture\n");
  fs.writeFileSync(path.join(root, "reports/implementation.txt"), "Acceptance, authorization, provider failure, and rollback checks passed for the committed pilot slice.\n");
  const implementationCommit = gitCommit(root, "test: implement salon pilot slice");
  const implementationReceiptFile = writeJson(root, "evidence-implementation.json", evidenceInput(root, now, { id: "EVID-IMPLEMENTATION", file: "reports/implementation.txt" }));
  recordProductEvidence({ target: root, id, file: implementationReceiptFile, timestamp: now() });
  const beforeIteration = inspectProduct({ target: root, id });
  const iterationPlanFile = writeJson(root, "iteration-plan.json", {
    schema_version: 1, id: "ITERATION-PLAN-SALON", version: 1, status: "READY_FOR_APPROVAL", iteration_id: "SPRINT-001", goal: "Complete and verify the appointment-to-reminder pilot slice", starts_at: now(), ends_at: "2026-09-03T12:00:00.000Z",
    baseline_hashes: [beforeIteration.artifacts.delivery.hash, beforeIteration.approvals.SOLUTION_BASELINE.artifact_hash], capacity: { unit: "days", available: 5, committed: 5 }, item_ids: ["STORY-001"], definition_of_done: ["Acceptance, security, operations, rollback, and evidence are current"]
  });
  putProductArtifact({ target: root, id, type: "iteration-plan", file: iterationPlanFile, timestamp: now() });
  const iterationReviewFile = writeJson(root, "iteration-review.json", {
    schema_version: 1, id: "ITERATION-REVIEW-SALON", version: 1, status: "READY_FOR_APPROVAL", iteration_id: "SPRINT-001", goal_status: "MET",
    progress: [{ item_id: "STORY-001", status: "DONE" }], acceptance: [{ id: "AC-001", status: "PASSED", evidence_receipt_ids: ["EVID-IMPLEMENTATION"] }], review: "The committed vertical slice meets AC-001.", retrospective: "Keep provider failure evidence in the same iteration.", changes: [], evidence_receipt_ids: ["EVID-IMPLEMENTATION"], completed_at: now()
  });
  putProductArtifact({ target: root, id, type: "iteration-review", file: iterationReviewFile, timestamp: now() });

  const current = inspectProduct({ target: root, id });
  const convergenceFile = writeJson(root, "convergence.json", {
    schema_version: 1,
    baseline_hashes: [current.artifacts.brd.hash, current.artifacts.specification.hash, current.artifacts.design.hash, current.artifacts.delivery.hash],
    implementation_commit: implementationCommit,
    items: [{ requirement_id: "BR-001", status: "VERIFIED", task_ids: ["STORY-001"], code_refs: ["src/appointments.mjs"], test_refs: ["test/appointments.test.mjs"], evidence_refs: ["EVID-IMPLEMENTATION"] }]
  });
  const duplicateConvergenceFile = writeJson(root, "convergence-duplicate.json", {
    schema_version: 1,
    baseline_hashes: [current.artifacts.brd.hash, current.artifacts.specification.hash, current.artifacts.design.hash, current.artifacts.delivery.hash],
    implementation_commit: implementationCommit,
    items: [
      { requirement_id: "BR-001", status: "VERIFIED", task_ids: ["STORY-001"], code_refs: ["src/appointments.mjs"], test_refs: ["test/appointments.test.mjs"], evidence_refs: ["EVID-IMPLEMENTATION"] },
      { requirement_id: "BR-001", status: "NOT_RUN", task_ids: [], code_refs: [], test_refs: [], evidence_refs: [] }
    ]
  });
  assert.throws(() => convergeProduct({ target: root, id, file: duplicateConvergenceFile, timestamp: now() }), /duplicate convergence evidence/);
  const converged = convergeProduct({ target: root, id, file: convergenceFile, timestamp: now() });
  assert.equal(converged.status, "CONVERGED");
  assert.equal(inspectProduct({ target: root, id }).stage, "VERIFIED");
  const staleConvergenceRoot = path.join(repository("stale-convergence"), "repo");
  fs.cpSync(root, staleConvergenceRoot, { recursive: true });
  const changedDelivery = JSON.parse(fs.readFileSync(path.join(root, deliveryFile), "utf8")); changedDelivery.version = 2; changedDelivery.mvp_outcome = "A revised pilot loop is verified against the current delivery successor.";
  const changedDeliveryFile = writeJson(staleConvergenceRoot, "delivery-v2.json", changedDelivery);
  putProductArtifact({ target: staleConvergenceRoot, id, type: "delivery", file: changedDeliveryFile, timestamp: now() });
  const revisedDeliveryAnalysis = analyzeProduct({ target: staleConvergenceRoot, id, gate: "DELIVERY_BASELINE", timestamp: now() });
  assert.equal(revisedDeliveryAnalysis.status, "READY_FOR_APPROVAL", JSON.stringify(revisedDeliveryAnalysis.findings));
  approveProductBaseline({ target: staleConvergenceRoot, id, type: "DELIVERY_BASELINE", approver: "Alex Nguyen", authority: "Product owner", scope: ["Revised STORY-001 delivery successor"], timestamp: now() });
  const staleConvergence = analyzeProduct({ target: staleConvergenceRoot, id, gate: "RELEASE_DECISION", timestamp: now() });
  assert.equal(staleConvergence.status, "BLOCKED");
  assert.ok(staleConvergence.findings.some((item) => item.code === "CONVERGENCE_MISSING"));

  const verification = (version, environment) => ({
    schema_version: 1, id: "VERIFY-SALON-PILOT", version, status: "READY_FOR_APPROVAL",
    approved_delivery: { id: current.artifacts.delivery.id, version: current.artifacts.delivery.version, hash: current.artifacts.delivery.hash }, environment,
    acceptance_status: "PASSED", security_status: "PASSED", operational_status: "READY", rollback_status: "READY",
    evidence: [
      { id: `VERIFY-${version}-ACCEPTANCE`, kind: "ACCEPTANCE", environment, status: "PASSED", ref: "evidence/acceptance.json", collected_at: now() },
      { id: `VERIFY-${version}-SECURITY`, kind: "SECURITY", environment, status: "PASSED", ref: "evidence/security.json", collected_at: now() },
      { id: `VERIFY-${version}-OPERATIONS`, kind: "OPERATIONS", environment, status: "PASSED", ref: "evidence/operations.json", collected_at: now() },
      { id: `VERIFY-${version}-ROLLBACK`, kind: "ROLLBACK", environment, status: "PASSED", ref: "evidence/rollback.json", collected_at: now() }
    ], limitations: []
  });
  const localVerification = writeJson(root, "verification-local.json", verification(1, "LOCAL"));
  putProductArtifact({ target: root, id, type: "verification", file: localVerification, timestamp: now() });
  const localRelease = analyzeProduct({ target: root, id, gate: "RELEASE_DECISION", timestamp: now() });
  assert.equal(localRelease.status, "BLOCKED");
  assert.ok(localRelease.findings.some((item) => item.code === "NON_RELEASE_ENVIRONMENT"));
  const pilotVerification = writeJson(root, "verification-pilot.json", verification(2, "PILOT"));
  putProductArtifact({ target: root, id, type: "verification", file: pilotVerification, timestamp: now() });
  const environmentId = "ENV-PILOT-001", providerVerifier = () => ({ status: "VERIFIED" });
  const providerEvidence = [
    ["EVID-CI", "CI_RUN"], ["EVID-ACCEPTANCE", "TEST_REPORT"], ["EVID-DEPLOY", "DEPLOYMENT"], ["EVID-SECURITY", "SECURITY_SCAN"], ["EVID-ACCESSIBILITY", "ACCESSIBILITY_REVIEW"], ["EVID-PRIVACY", "PRIVACY_LEGAL_REVIEW"], ["EVID-OBS", "OBSERVABILITY"], ["EVID-INCIDENT", "INCIDENT_DRILL"],
    ["EVID-MIGRATION", "MIGRATION"], ["EVID-RETAINED", "RETAINED_DATA"], ["EVID-LOAD", "LOAD_TEST"], ["EVID-RESTORE", "BACKUP_RESTORE"], ["EVID-ROLLBACK", "ROLLBACK_DRILL"],
    ["EVID-ANALYTICS", "ANALYTICS"], ["EVID-SUPPORT", "SUPPORT"]
  ];
  for (const [evidenceIdValue, kind] of providerEvidence) {
    const file = writeJson(root, `${evidenceIdValue}.json`, evidenceInput(root, now, { id: evidenceIdValue, kind, trust: "PROVIDER_VERIFIED", environment: environmentId, file: "reports/implementation.txt" }));
    recordProductEvidence({ target: root, id, file, timestamp: now() }, { verifyProviderReceipt: providerVerifier });
  }
  const environmentFile = writeJson(root, "environment.json", {
    schema_version: 1, id: environmentId, name: "Salon bounded pilot", environment_class: "PILOT", trust_level: "PROVIDER_VERIFIED", repository_commit: implementationCommit,
    declared_by: "Release owner", declared_at: now(), expires_at: "2027-08-20T12:00:00.000Z", provider: { name: "test-provider", environment_id: "pilot-001", url: "https://provider.example/environments/pilot-001" },
    evidence_receipt_ids: providerEvidence.map(([evidenceIdValue]) => evidenceIdValue), limitations: ["Deterministic provider-adapter fixture; not a real deployment claim"]
  });
  recordProductEnvironment({ target: root, id, file: environmentFile, timestamp: now() }, { verifyProviderReceipt: providerVerifier });
  const readinessFile = writeJson(root, "production-readiness.json", {
    schema_version: 1, id: "READINESS-SALON", version: 1, status: "READY_FOR_APPROVAL", environment_attestation_id: environmentId, release_scope: "One bounded salon pilot", decision: "READY_FOR_LIMITED_RELEASE",
    checks: {
      ci_cd: { status: "READY", evidence_receipt_ids: ["EVID-CI"] }, acceptance: { status: "READY", evidence_receipt_ids: ["EVID-ACCEPTANCE"] }, infrastructure: { status: "READY", evidence_receipt_ids: ["EVID-DEPLOY"] }, security: { status: "READY", evidence_receipt_ids: ["EVID-SECURITY"] }, accessibility: { status: "READY", evidence_receipt_ids: ["EVID-ACCESSIBILITY"] }, privacy_legal: { status: "READY", evidence_receipt_ids: ["EVID-PRIVACY"] }, observability: { status: "READY", evidence_receipt_ids: ["EVID-OBS"] },
      incident_readiness: { status: "READY", evidence_receipt_ids: ["EVID-INCIDENT"] }, migration: { status: "READY", evidence_receipt_ids: ["EVID-MIGRATION", "EVID-RETAINED"] }, capacity: { status: "READY", evidence_receipt_ids: ["EVID-LOAD"] },
      backup_restore: { status: "READY", evidence_receipt_ids: ["EVID-RESTORE"] }, rollback: { status: "READY", evidence_receipt_ids: ["EVID-ROLLBACK"] }
    }
  });
  putProductArtifact({ target: root, id, type: "production-readiness", file: readinessFile, timestamp: now() });
  const analyticsFile = writeJson(root, "product-analytics.json", {
    schema_version: 1, id: "ANALYTICS-SALON", version: 1, status: "READY_FOR_APPROVAL", environment_attestation_id: environmentId, measurement_window: "Eight-week pilot",
    instrumentation: [{ id: "EVENT-REMINDER", definition: "Reminder scheduled and delivery outcome" }], metrics: [{ id: "GOAL-001", definition: "No-show rate", source: "Pilot event store", owner: "Product owner", status: "READY" }], evidence_receipt_ids: ["EVID-ANALYTICS"]
  });
  putProductArtifact({ target: root, id, type: "product-analytics", file: analyticsFile, timestamp: now() });
  const supportFile = writeJson(root, "support-readiness.json", {
    schema_version: 1, id: "SUPPORT-SALON", version: 1, status: "READY_FOR_APPROVAL", owner: "Pilot support owner", channels: ["Pilot support inbox"], runbook: "Triage reminder failures and appointment recovery", service_window: "Pilot business hours", escalations: ["Product owner", "Engineering on-call"], customer_success_workflow: "Onboard, weekly check-in, outcome review, exit/export", evidence_receipt_ids: ["EVID-SUPPORT"]
  });
  putProductArtifact({ target: root, id, type: "support-readiness", file: supportFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "PRODUCTION_READINESS", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "PRODUCTION_READINESS", approver: "Alex Nguyen", authority: "Product and release owner", scope: ["Bounded pilot readiness dossier"], timestamp: now() });
  const candidate = prepareProductReleaseCandidate({ target: root, id, releaseClass: "LIMITED_RELEASE", limitations: ["Pilot only"], timestamp: now() });
  assert.equal(candidate.status, "RELEASE_CANDIDATE");
  assert.equal(analyzeProduct({ target: root, id, gate: "RELEASE_DECISION", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "RELEASE_DECISION", approver: "Alex Nguyen", authority: "Product and release owner", scope: ["Limited pilot release only"], timestamp: now() });
  assert.equal(inspectProduct({ target: root, id }).stage, "OPERATING");
  assert.equal(inspectProductDossier({ target: root, id, timestamp: now() }).status, "LIMITED_RELEASE_AUTHORIZED");
  assert.equal(exportProductDossier({ target: root, id, output: "dossier.md", timestamp: now() }).status, "EXPORTED");
  const releaseDriftRoot = path.join(repository("release-drift"), "repo");
  fs.cpSync(root, releaseDriftRoot, { recursive: true });
  fs.appendFileSync(path.join(releaseDriftRoot, "reports/implementation.txt"), "stale after approval\n");
  const staleDossier = inspectProductDossier({ target: releaseDriftRoot, id, timestamp: now() });
  assert.equal(staleDossier.status, "STALE");
  assert.equal(staleDossier.claim_boundaries.production_claim_authorized, false);
  assert.ok(staleDossier.release_currency.reasons.some((reason) => reason.includes("TRACKED_WORKTREE_DIRTY") || reason.includes("FILE_DRIFT")));
  const outcomeFile = writeJson(root, "outcome.json", { schema_version: 1, id: "OUTCOME-SALON-PILOT", version: 1, status: "DRAFT", environment: "PILOT", metrics: [{ id: "GOAL-001", target: "20% relative reduction", actual: "Measurement pending", window: "8 weeks", source: "Pilot analytics" }], evidence: [{ ref: "evidence/pilot-analytics.json" }], recommendation: "ITERATE", rationale: "Continue the bounded pilot until the measurement window closes.", limitations: ["Outcome window incomplete"] });
  putProductArtifact({ target: root, id, type: "outcome", file: outcomeFile, timestamp: now() });
  assert.equal(nextProductAction({ target: root, id }).skill, "review-product-outcome");
  assert.match(productDigest({ product: id }), /^[a-f0-9]{64}$/);

  const deletionEvidenceFile = writeJson(root, "EVID-DELETION.json", evidenceInput(root, now, { id: "EVID-DELETION", kind: "DATA_DELETION", trust: "PROVIDER_VERIFIED", environment: environmentId, file: "reports/implementation.txt" }));
  recordProductEvidence({ target: root, id, file: deletionEvidenceFile, timestamp: now() }, { verifyProviderReceipt: providerVerifier });
  const retirementFile = writeJson(root, "retirement.json", {
    schema_version: 1, id: "RETIREMENT-SALON", version: 1, status: "READY_FOR_APPROVAL", trigger: "Pilot owner elects to close the bounded pilot", owner: "Product owner", customer_communication: "Notify pilot users, offer export, confirm closure window", data_deletion: [{ system: "Pilot datastore and backups", status: "VERIFIED_FIXTURE", evidence_receipt_ids: ["EVID-DELETION"] }], dependency_shutdown: "Disable reminder provider route and revoke pilot access", rollback: "Reopen only within the approved retention window", decision: "RETIRE", evidence_receipt_ids: ["EVID-DELETION"]
  });
  putProductArtifact({ target: root, id, type: "retirement", file: retirementFile, timestamp: now() });
  assert.equal(analyzeProduct({ target: root, id, gate: "RETIREMENT_DECISION", timestamp: now() }).status, "READY_FOR_APPROVAL");
  approveProductBaseline({ target: root, id, type: "RETIREMENT_DECISION", approver: "Alex Nguyen", authority: "Product and data owner", scope: ["Bounded pilot retirement fixture"], timestamp: now() });
  assert.equal(inspectProduct({ target: root, id }).stage, "RETIRED");

  const integrityState = inspectProduct({ target: root, id });
  const artifactTamperRoot = path.join(repository("artifact-tamper"), "repo");
  fs.cpSync(root, artifactTamperRoot, { recursive: true });
  const outcomeArtifactFile = path.join(artifactTamperRoot, integrityState.artifacts.outcome.path);
  const outcomeArtifact = JSON.parse(fs.readFileSync(outcomeArtifactFile, "utf8")); outcomeArtifact.recommendation = "RELEASE";
  fs.writeFileSync(outcomeArtifactFile, `${JSON.stringify(outcomeArtifact, null, 2)}\n`);
  assert.throws(() => inspectProduct({ target: artifactTamperRoot, id }), /outcome artifact hash mismatch/);

  const approvalTamperRoot = path.join(repository("approval-tamper"), "repo");
  fs.cpSync(root, approvalTamperRoot, { recursive: true });
  const approvalFile = path.join(approvalTamperRoot, integrityState.approvals.DELIVERY_BASELINE.path);
  const approvalRecord = JSON.parse(fs.readFileSync(approvalFile, "utf8")); approvalRecord.authority = "tampered authority";
  fs.writeFileSync(approvalFile, `${JSON.stringify(approvalRecord, null, 2)}\n`);
  assert.throws(() => inspectProduct({ target: approvalTamperRoot, id }), /approval integrity verification failed/);

  const convergenceTamperRoot = path.join(repository("convergence-tamper"), "repo");
  fs.cpSync(root, convergenceTamperRoot, { recursive: true });
  const convergenceState = JSON.parse(fs.readFileSync(path.join(convergenceTamperRoot, ".ai/products", id, "product.json"), "utf8"));
  const convergenceReportFile = path.join(convergenceTamperRoot, convergenceState.convergence.path);
  const convergenceReport = JSON.parse(fs.readFileSync(convergenceReportFile, "utf8")); convergenceReport.status = "GAPS_FOUND";
  fs.writeFileSync(convergenceReportFile, `${JSON.stringify(convergenceReport, null, 2)}\n`);
  assert.throws(() => inspectProduct({ target: convergenceTamperRoot, id }), /convergence report integrity verification failed/);

  const stateFile = path.join(root, ".ai/products", id, "product.json");
  const tampered = JSON.parse(fs.readFileSync(stateFile, "utf8")); tampered.stage = "OPERATING";
  fs.writeFileSync(stateFile, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => inspectProduct({ target: root, id }), /state hash mismatch/);
});

test("Product Genesis rejects unsafe paths, secret-like ideas, and invalid artifacts", () => {
  const root = repository("safety"), now = clock();
  assert.throws(() => createProductWorkspace({ target: root, id: "secret-product", idea: "Use key sk-abcdefghijklmnopqrstuvwxyz1234567890", timestamp: now() }), /restricted secret/);
  createProductWorkspace({ target: root, id: "safe-product", idea: "A bounded workflow tool", timestamp: now() });
  assert.throws(() => recordProductContext({ target: root, id: "safe-product", category: "CHANGED", contextId: "CTX-CHANGE", statement: "Changed statement", supersedes: "CTX-MISSING", rationale: "Test", timestamp: now() }), /does not exist/);
  const outside = path.join(root, "..", `outside-${path.basename(root)}.json`);
  fs.writeFileSync(outside, JSON.stringify({ schema_version: 1 }));
  assert.throws(() => putProductArtifact({ target: root, id: "safe-product", type: "research", file: path.relative(root, outside), timestamp: now() }), /remain inside/);
  assert.equal(validateProductArtifact("brd", { schema_version: 1 }).status, "INVALID");
  assert.equal(validateProductArtifact("specification", { schema_version: 1, id: "SPEC-BAD", version: 1, status: "READY_FOR_APPROVAL", approved_brd: { hash: "a".repeat(64) }, journeys: [{}], functional_requirements: [{}], non_functional_requirements: [], acceptance_criteria: [{}], data_and_integrations: [], operations: {}, traceability: [{}] }).status, "INVALID");
  const activeLock = path.join(root, ".ai/products/.locks/safe-product.lock");
  fs.mkdirSync(path.dirname(activeLock), { recursive: true });
  fs.writeFileSync(activeLock, JSON.stringify({ pid: process.pid, hostname: os.hostname(), acquired_at: "2026-08-20T00:00:00.000Z" }));
  const old = new Date(Date.now() - 60 * 60 * 1_000); fs.utimesSync(activeLock, old, old);
  assert.throws(() => addProductQuestion({ target: root, id: "safe-product", question: "Can an active lock be stolen?", rationale: "Lock safety", timestamp: now() }), /active transaction completes/);
  fs.unlinkSync(activeLock);
  fs.unlinkSync(outside);
});

test("Product evidence binding rejects drift, forged trust, expiry, and unsafe files", () => {
  const root = repository("evidence"), now = clock(), id = "evidence-product";
  createProductWorkspace({ target: root, id, idea: "A product whose evidence must fail closed", timestamp: now() });
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports/evidence.txt"), "current evidence\n");
  gitCommit(root, "test: add bound evidence subject");

  const validFile = writeJson(root, "valid-evidence.json", evidenceInput(root, now, { id: "EVID-VALID", file: "reports/evidence.txt" }));
  assert.equal(recordProductEvidence({ target: root, id, file: validFile, timestamp: now() }).status, "VERIFIED");
  assert.equal(verifyProductEvidence({ target: root, id, evidenceId: "EVID-VALID", timestamp: now() }).status, "VERIFIED");
  assert.throws(() => recordProductEvidence({ target: root, id, file: validFile, timestamp: now() }), /already exists and is immutable/);

  fs.writeFileSync(path.join(root, "reports/evidence.txt"), "drifted evidence\n");
  const drifted = verifyProductEvidence({ target: root, id, evidenceId: "EVID-VALID", timestamp: now() });
  assert.equal(drifted.status, "STALE");
  assert.ok(drifted.results[0].reasons.includes("FILE_DRIFT"));

  const forgedProvider = evidenceInput(root, now, { id: "EVID-FORGED-PROVIDER", kind: "DEPLOYMENT", trust: "PROVIDER_VERIFIED", environment: "ENV-FAKE", file: "reports/evidence.txt" });
  const forgedProviderFile = writeJson(root, "forged-provider.json", forgedProvider);
  assert.throws(() => recordProductEvidence({ target: root, id, file: forgedProviderFile, timestamp: now() }), /authorized provider verifier adapter/);

  const foreign = evidenceInput(root, now, { id: "EVID-FOREIGN", file: "reports/evidence.txt" });
  foreign.repository.commit = "0".repeat(40);
  const foreignFile = writeJson(root, "foreign.json", foreign);
  assert.throws(() => recordProductEvidence({ target: root, id, file: foreignFile, timestamp: now() }), /current full Git commit/);

  const expired = evidenceInput(root, now, { id: "EVID-EXPIRED", file: "reports/evidence.txt" });
  expired.collected_at = "2026-08-20T10:00:00.000Z"; expired.expires_at = "2026-08-20T11:00:00.000Z";
  const expiredFile = writeJson(root, "expired.json", expired);
  assert.throws(() => recordProductEvidence({ target: root, id, file: expiredFile, timestamp: "2026-08-20T12:00:00.000Z" }), /already expired/);

  const selfDeclared = evidenceInput(root, now, { id: "EVID-SELF", kind: "DEPLOYMENT", trust: "SELF_DECLARED", file: "reports/evidence.txt" });
  delete selfDeclared.subject;
  const selfDeclaredFile = writeJson(root, "self-declared.json", selfDeclared);
  recordProductEvidence({ target: root, id, file: selfDeclaredFile, timestamp: now() });
  const insufficient = verifyProductEvidence({ target: root, id, evidenceId: "EVID-SELF", minimumTrust: "PROVIDER_VERIFIED", timestamp: now() });
  assert.equal(insufficient.status, "STALE");
  assert.ok(insufficient.results[0].reasons.includes("INSUFFICIENT_TRUST"));

  fs.symlinkSync("evidence.txt", path.join(root, "reports/symlink.txt"));
  const symlinked = evidenceInput(root, now, { id: "EVID-SYMLINK", file: "reports/evidence.txt" }); symlinked.subject.path = "reports/symlink.txt";
  const symlinkFile = writeJson(root, "symlink.json", symlinked);
  assert.throws(() => recordProductEvidence({ target: root, id, file: symlinkFile, timestamp: now() }), /symbolic link/);

  fs.linkSync(path.join(root, "reports/evidence.txt"), path.join(root, "reports/hardlink.txt"));
  const hardlinked = evidenceInput(root, now, { id: "EVID-HARDLINK", file: "reports/evidence.txt" }); hardlinked.subject.path = "reports/hardlink.txt";
  const hardlinkFile = writeJson(root, "hardlink.json", hardlinked);
  assert.throws(() => recordProductEvidence({ target: root, id, file: hardlinkFile, timestamp: now() }), /non-linked regular file/);
});
