import { requireTeamCapability, safeTeamId, teamControlDigest, teamTimestamp, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";

export function evaluateIndependentReview(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const authentication = { now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey };
  const author = verifyTeamIdentityAuthentication(options.author, authentication); const reviewer = verifyTeamIdentityAuthentication(options.reviewer, authentication);
  requireTeamCapability(reviewer, "review.submit");
  const requiredOwners = [...new Set((options.requiredOwners ?? []).map((item) => safeTeamId(item, "required owner")))].sort();
  const approvals = [...new Set((options.approvals ?? []).map((item) => safeTeamId(item, "review approval")))].sort();
  const blockers = [];
  if (author.principal_id === reviewer.principal_id || author.subject === reviewer.subject) blockers.push("SELF_REVIEW");
  if (!reviewer.roles.includes("reviewer")) blockers.push("REVIEWER_ROLE_MISSING");
  const missingOwners = requiredOwners.filter((owner) => !approvals.includes(owner));
  if (missingOwners.length) blockers.push("CODEOWNER_APPROVAL_MISSING");
  if (!/^[a-f0-9]{64}$/.test(options.evidenceHash ?? "")) blockers.push("REVIEW_EVIDENCE_MISSING");
  const result = { schema_version: 1, package_id: safeTeamId(options.packageId, "change package id"), status: blockers.length ? "REJECTED" : "ACCEPTED", author_id: author.principal_id, reviewer_id: reviewer.principal_id, required_owners: requiredOwners, approvals, missing_owners: missingOwners, blockers, reviewed_at: now, evidence_hash: options.evidenceHash ?? null };
  return { ...result, review_hash: teamControlDigest(result) };
}
