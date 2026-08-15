import path from "node:path";

import { createMemoryEntry, resolveRepositoryIdentity } from "./memory-contract.mjs";
import { withMemoryStore } from "./memory-store.mjs";
import { inspectTeamContext, listTeamMemoryCandidates } from "./team-context.mjs";
import { readTeamContract } from "./team-orchestrator.mjs";

export function promoteTeamMemoryCandidate(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  if (!options.id || !options.candidateHash || !options.handoffHash || !options.approver) throw new Error("memory promotion requires task id, candidate hash, handoff hash, and approver");
  const context = inspectTeamContext({ target: root, id: options.id });
  const candidate = listTeamMemoryCandidates({ target: root, id: options.id }).find((item) => item.candidate_hash === options.candidateHash);
  if (!candidate) throw new Error("memory candidate does not exist in current team context");
  if (candidate.status !== "VERIFIED" || candidate.latest_review?.handoff_hash !== options.handoffHash) throw new Error("memory candidate requires a current evidence-bound VERIFIED review");
  if (candidate.proposed_by_agent === options.approver) throw new Error("subagent memory candidates cannot be self-approved");
  const handoff = context.handoffs.find((item) => item.handoff_hash === options.handoffHash);
  if (!handoff || handoff.status !== "COMPLETED") throw new Error("memory promotion requires a completed handoff");
  const assignment = context.assignments.find((item) => item.id === handoff.assignment_id);
  if (!assignment || assignment.latest_handoff_hash !== handoff.handoff_hash || assignment.acknowledged_handoff_hash !== handoff.handoff_hash || assignment.acknowledged_status !== "COMPLETED") throw new Error("memory promotion requires the accepted current assignment handoff");
  const team = readTeamContract({ target: root, id: options.id });
  const teamAssignment = team.assignments.find((item) => item.id === handoff.assignment_id);
  if (!teamAssignment || teamAssignment.status !== "COMPLETED") throw new Error("failed, cancelled, timed-out, or orphaned assignments cannot publish memory");
  if (["CANCELLED", "BLOCKED"].includes(team.state) || ["CANCELLED", "CANCELLATION_PENDING", "BLOCKED"].includes(team.run?.state)) throw new Error("failed or cancelled team runs cannot publish memory");
  const reviewDate = options.reviewDate ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const now = options.now ?? new Date().toISOString();
  const repositoryIdentity = resolveRepositoryIdentity({ target: root, sourceCommit: context.brief.repository_commit });
  if (candidate.scope.organization_id !== repositoryIdentity.organization_id || candidate.scope.repository_id !== repositoryIdentity.repository_id) throw new Error("memory candidate repository identity no longer matches the current repository");
  const entry = createMemoryEntry({
    target: root,
    repositoryIdentity,
    id: `mem-${candidate.candidate_hash.slice(0, 24)}`,
    title: candidate.title,
    content: candidate.content,
    category: candidate.category,
    scope: candidate.scope,
    confidence: candidate.confidence,
    trustTier: "reviewed",
    status: "APPROVED",
    taskId: options.id,
    runId: team.run?.run_id,
    agentId: candidate.proposed_by_agent,
    createdBy: candidate.proposed_by_agent,
    approver: options.approver,
    reviewDate,
    approvedAt: now,
    lastReviewedAt: now,
    sourceType: "subagent-handoff",
    references: [...candidate.references, ...handoff.evidence.map((item) => `${item.path}:${item.line_start}`)],
    sourceCommit: context.brief.repository_commit,
    sourceHash: handoff.handoff_hash,
    evidenceHashes: candidate.evidence_hashes,
    handoffHash: handoff.handoff_hash,
    candidateHash: candidate.candidate_hash
  });
  return withMemoryStore({ ...options, target: root }, (store) => {
    const stored = store.promote(entry, {
      actor: options.approver,
      idempotencyKey: candidate.candidate_hash,
      reasonCode: "VERIFIED_HANDOFF_CANDIDATE"
    });
    return {
      schema_version: 1,
      status: stored.duplicate ? "ALREADY_PROMOTED" : "PROMOTED",
      memory: stored.entry,
      promotion_receipt: {
        receipt_hash: stored.receipt.receipt_hash,
        memory_id: stored.entry.id,
        content_hash: stored.entry.content_hash,
        candidate_hash: candidate.candidate_hash,
        handoff_hash: handoff.handoff_hash,
        approver_hash: stored.receipt.actor_hash,
        evidence_hashes: candidate.evidence_hashes
      }
    };
  });
}
