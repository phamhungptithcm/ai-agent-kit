import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTask } from "../src/governed-runtime.mjs";
import { startTeam } from "../src/team-orchestrator.mjs";
import { acknowledgeTeamHandoff, briefHash, claimTeamWork, decideTeamConflict, inspectTeamContext, publishTeamHandoff, recordTeamConflict, teamContextSummary } from "../src/team-context.mjs";

function setup(id = "TEAM-CONTEXT") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-context-"));
  fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const ready = true;\n");
  createTask({ target: root, id, goal: "Implement a new API feature", acceptanceCriteria: ["Feature is verified"], paths: ["src/**"], risk: "medium" });
  startTeam({ target: root, id, adapter: "codex" }); return root;
}

function handoff(root, id, assignment, agent, extra = {}, acknowledge = true) {
  const context = inspectTeamContext({ target: root, id });
  const claim = claimTeamWork({ target: root, id, assignment, agent, expectedRevision: context.revision });
  const result = publishTeamHandoff({ target: root, id, claim: claim.claim.claim_id, agent, expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: [`${assignment} result`], evidence: [{ path: "src/feature.mjs", line_start: 1, line_end: 1 }], status: "COMPLETED", ...extra } });
  if (acknowledge) acknowledgeTeamHandoff({ target: root, id, assignment, handoffHash: result.handoff_hash, status: extra.status ?? "COMPLETED" });
  return result.handoff_hash;
}

test("shared context uses revisions without making independent read claims stale", () => {
  const root = setup(); const initial = inspectTeamContext({ target: root, id: "TEAM-CONTEXT" });
  const first = claimTeamWork({ target: root, id: "TEAM-CONTEXT", assignment: "domain-analyst", agent: "analyst-a", expectedRevision: initial.revision });
  const second = claimTeamWork({ target: root, id: "TEAM-CONTEXT", assignment: "impact-explorer", agent: "explorer-b", expectedRevision: first.revision });
  assert.equal(first.claim.context_revision, 0); assert.equal(second.claim.context_revision, 0);
  assert.throws(() => claimTeamWork({ target: root, id: "TEAM-CONTEXT", assignment: "impact-explorer", agent: "explorer-c", expectedRevision: second.revision }), /already claimed/);
  assert.throws(() => claimTeamWork({ target: root, id: "TEAM-CONTEXT", assignment: "domain-analyst", agent: "analyst-c", expectedRevision: initial.revision }), /revision conflict/);
});

test("dependencies consume immutable handoffs before implementation can claim work", () => {
  const root = setup("TEAM-DEPS"); const context = inspectTeamContext({ target: root, id: "TEAM-DEPS" });
  assert.throws(() => claimTeamWork({ target: root, id: "TEAM-DEPS", assignment: "implementation-engineer", agent: "builder", expectedRevision: context.revision }), /no accepted completed handoff/);
  const unaccepted = handoff(root, "TEAM-DEPS", "domain-analyst", "analyst", {}, false);
  let current = inspectTeamContext({ target: root, id: "TEAM-DEPS" });
  assert.throws(() => claimTeamWork({ target: root, id: "TEAM-DEPS", assignment: "implementation-engineer", agent: "builder", expectedRevision: current.revision }), /no accepted completed handoff/);
  acknowledgeTeamHandoff({ target: root, id: "TEAM-DEPS", assignment: "domain-analyst", handoffHash: unaccepted, status: "COMPLETED" }); handoff(root, "TEAM-DEPS", "impact-explorer", "explorer");
  current = inspectTeamContext({ target: root, id: "TEAM-DEPS" });
  const claimed = claimTeamWork({ target: root, id: "TEAM-DEPS", assignment: "implementation-engineer", agent: "builder", expectedRevision: current.revision, paths: ["src/feature.mjs"] });
  assert.deepEqual(claimed.claim.paths, ["src/feature.mjs"]);
});

test("handoffs reject stale briefs, secrets, traversal, and write-scope expansion", () => {
  const root = setup("TEAM-GUARDS"); let context = inspectTeamContext({ target: root, id: "TEAM-GUARDS" });
  let claim = claimTeamWork({ target: root, id: "TEAM-GUARDS", assignment: "domain-analyst", agent: "analyst", expectedRevision: context.revision });
  assert.throws(() => publishTeamHandoff({ target: root, id: "TEAM-GUARDS", claim: claim.claim.claim_id, agent: "analyst", expectedRevision: claim.revision, payload: { brief_hash: "a".repeat(64), facts: [], evidence: [] } }), /brief is stale/);
  assert.throws(() => publishTeamHandoff({ target: root, id: "TEAM-GUARDS", claim: claim.claim.claim_id, agent: "analyst", expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: ["Bearer abcdefghijklmnopqrstuvwxyz"], evidence: [] } }), /secret-like/);
  assert.throws(() => claimTeamWork({ target: root, id: "TEAM-GUARDS", assignment: "impact-explorer", agent: "explorer", expectedRevision: claim.revision, paths: ["../outside"] }), /inside the repository/);

  const analystHandoff = publishTeamHandoff({ target: root, id: "TEAM-GUARDS", claim: claim.claim.claim_id, agent: "analyst", expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), facts: ["done"], evidence: [{ path: "src/feature.mjs" }] } });
  acknowledgeTeamHandoff({ target: root, id: "TEAM-GUARDS", assignment: "domain-analyst", handoffHash: analystHandoff.handoff_hash, status: "COMPLETED" });
  handoff(root, "TEAM-GUARDS", "impact-explorer", "explorer"); context = inspectTeamContext({ target: root, id: "TEAM-GUARDS" });
  claim = claimTeamWork({ target: root, id: "TEAM-GUARDS", assignment: "implementation-engineer", agent: "builder", expectedRevision: context.revision, paths: ["src/feature.mjs"] });
  assert.throws(() => publishTeamHandoff({ target: root, id: "TEAM-GUARDS", claim: claim.claim.claim_id, agent: "builder", expectedRevision: claim.revision, payload: { brief_hash: briefHash(context), affected_paths: ["docs/outside.md"], evidence: [{ path: "src/feature.mjs" }] } }), /exceeds claimed write scope/);
});

test("conflicts block shared context until the lead records an evidence-bound decision", () => {
  const root = setup("TEAM-CONFLICT"); const left = handoff(root, "TEAM-CONFLICT", "domain-analyst", "analyst"); const right = handoff(root, "TEAM-CONFLICT", "impact-explorer", "explorer");
  let context = inspectTeamContext({ target: root, id: "TEAM-CONFLICT" });
  const conflict = recordTeamConflict({ target: root, id: "TEAM-CONFLICT", expectedRevision: context.revision, handoffHashes: [left, right], summary: "The two specialists disagree about compatibility." });
  assert.equal(teamContextSummary({ target: root, id: "TEAM-CONFLICT" }).status, "BLOCKED");
  const decision = decideTeamConflict({ target: root, id: "TEAM-CONFLICT", expectedRevision: conflict.revision, conflict: conflict.conflict_id, selectedHandoff: right, reason: "The impact explorer traced the current consumer contract.", decidedBy: "team-lead" });
  assert.match(decision.decision_hash, /^[a-f0-9]{64}$/); assert.equal(teamContextSummary({ target: root, id: "TEAM-CONFLICT" }).status, "READY");
});

test("production-path handoff evidence is content-bound and becomes stale after drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-team-context-stale-")); fs.mkdirSync(path.join(root, "src")); fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const value = 1;\n");
  createTask({ target: root, id: "TEAM-STALE", goal: "Fix a typo in one document", paths: ["src/**"], risk: "low" }); startTeam({ target: root, id: "TEAM-STALE", adapter: "codex" });
  const handoffHash = handoff(root, "TEAM-STALE", "implementation-engineer", "builder", { affected_paths: ["src/feature.mjs"] });
  const context = inspectTeamContext({ target: root, id: "TEAM-STALE" }); const published = context.handoffs.find((item) => item.handoff_hash === handoffHash);
  assert.match(published.evidence[0].sha256, /^[a-f0-9]{64}$/); assert.equal(teamContextSummary({ target: root, id: "TEAM-STALE" }).status, "READY");
  fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const value = 2;\n");
  const stale = teamContextSummary({ target: root, id: "TEAM-STALE" }); assert.equal(stale.status, "STALE"); assert.deepEqual(stale.stale_evidence, ["implementation-engineer:src/feature.mjs"]);
});
