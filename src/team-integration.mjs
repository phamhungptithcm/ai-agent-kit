import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { analyzeTeamConflicts } from "./team-conflicts.mjs";
import {
  normalizeTeamSurface,
  rejectRestrictedTeamData,
  requireTeamCapability,
  safeTeamId,
  teamControlDigest,
  teamIdentityTrustLevel,
  teamTimestamp,
  verifySignedTeamAction,
  verifyTeamIdentityAuthentication
} from "./team-control-contract.mjs";
import { withTeamControlStore } from "./team-control-store.mjs";
import { resolveRequiredOwners } from "./team-review.mjs";

const PACKAGE_FIELDS = [
  "schema_version", "package_id", "task_id", "assignment_id", "commit", "parent_commit",
  "claim_id", "fencing_token", "author_id", "dependencies", "surfaces", "changed_paths",
  "diff_hash", "completion_receipt_hash", "evidence_hashes", "rollback_ref", "policy_hash",
  "pulse_evidence_hash", "author_trust", "created_at"
];
const PACKAGE_LIFECYCLE_FIELDS = new Set(["state", "enqueued_at", "reviewed_at", "admitted_at", "rejected_at"]);
const PROTECTED_KINDS = new Set(["API", "SCHEMA", "MIGRATION", "DEPENDENCY", "GENERATED"]);

function git(root, args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (options.allowStatus?.includes(result.status)) return result;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result;
}

function repositoryResolver(options) {
  return options.resolveIdentityKey ?? ((keyId) => withTeamControlStore(options, (store) => store.getTrustedKey(keyId)));
}

function authenticate(options, value, capability, now) {
  const identity = verifyTeamIdentityAuthentication(value, { now, identitySecret: options.identitySecret, resolveIdentityKey: repositoryResolver(options), seenIdentityNonces: options.seenIdentityNonces });
  requireTeamCapability(identity, capability);
  return identity;
}

function packageCore(value) { return Object.fromEntries(PACKAGE_FIELDS.map((key) => [key, structuredClone(value[key])])); }

export function integrationInputHash(packageValue) {
  const verified = verifyIntegrationPackage(packageValue, { allowLifecycle: true });
  return teamControlDigest({ package_hash: verified.package_hash, parent_commit: verified.parent_commit, commit: verified.commit, diff_hash: verified.diff_hash, evidence_hashes: verified.evidence_hashes, policy_hash: verified.policy_hash, pulse_evidence_hash: verified.pulse_evidence_hash });
}

export function inspectIntegrationGitFacts(options = {}) {
  const root = options.target ?? process.cwd();
  const commit = String(options.commit ?? "");
  const parentCommit = String(options.parentCommit ?? "");
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-f0-9]{40,64}$/.test(parentCommit)) throw new Error("integration package requires full commit and parent commit digests");
  git(root, ["cat-file", "-e", `${commit}^{commit}`]);
  git(root, ["cat-file", "-e", `${parentCommit}^{commit}`]);
  const ancestry = git(root, ["merge-base", "--is-ancestor", parentCommit, commit], { allowStatus: [0, 1] });
  if (ancestry.status !== 0) throw new Error("integration commit is not a descendant of its declared parent");
  const nameStatus = git(root, ["diff", "--name-status", "-z", "--find-renames", "--find-copies", parentCommit, commit]).stdout.split("\0");
  const changedPaths = [];
  for (let index = 0; index < nameStatus.length;) {
    const status = nameStatus[index++];
    if (!status) continue;
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(status)) throw new Error(`unsupported Git change status: ${status}`);
    const firstPath = nameStatus[index++];
    if (!firstPath) throw new Error("Git change status is missing a path");
    changedPaths.push(firstPath);
    if (/^[RC]/.test(status)) {
      const secondPath = nameStatus[index++];
      if (!secondPath) throw new Error("Git rename or copy status is missing its destination path");
      changedPaths.push(secondPath);
    }
  }
  const diff = git(root, ["diff", "--binary", "--full-index", parentCommit, commit]).stdout;
  return { commit, parent_commit: parentCommit, changed_paths: [...new Set(changedPaths)].sort(), diff_hash: crypto.createHash("sha256").update(diff).digest("hex") };
}

function pathPatternRegex(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") { source += "(?:.*/)?"; index += 2; }
      else { source += ".*"; index += 1; }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

function pathCovered(pathName, surfaces) {
  return surfaces.some((surface) => ["PATH", "GENERATED", "MIGRATION"].includes(surface.kind) && pathPatternRegex(surface.name).test(pathName));
}

function verifyDeclaredGitFacts(packageValue, options = {}) {
  const facts = inspectIntegrationGitFacts({ target: options.target, commit: packageValue.commit, parentCommit: packageValue.parent_commit });
  if (teamControlDigest(facts.changed_paths) !== teamControlDigest(packageValue.changed_paths)) throw new Error("integration package changed paths do not match the actual Git diff");
  if (facts.diff_hash !== packageValue.diff_hash) throw new Error("integration package diff hash does not match the actual Git diff");
  const uncovered = facts.changed_paths.filter((item) => !pathCovered(item, packageValue.surfaces));
  if (uncovered.length) throw new Error(`integration package has changed paths outside its declared surfaces: ${uncovered.join(", ")}`);
  return facts;
}

export function createIntegrationPackage(options = {}) {
  rejectRestrictedTeamData(options, "integration package");
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const author = authenticate(options, options.author, "integration.enqueue", now);
  const facts = inspectIntegrationGitFacts({ target: options.target, commit: options.commit, parentCommit: options.parentCommit });
  const evidenceHashes = [...new Set(options.evidenceHashes ?? [])].sort();
  if (!evidenceHashes.length || evidenceHashes.some((item) => !/^[a-f0-9]{64}$/.test(item))) throw new Error("integration package requires SHA-256 evidence hashes");
  const rollbackRef = String(options.rollbackRef ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(rollbackRef)) throw new Error("integration package rollback reference is invalid");
  const value = {
    schema_version: 2,
    package_id: safeTeamId(options.packageId ?? `pkg-${crypto.randomUUID()}`, "change package id"),
    task_id: safeTeamId(options.taskId, "task id"),
    assignment_id: safeTeamId(options.assignmentId, "assignment id"),
    commit: facts.commit,
    parent_commit: facts.parent_commit,
    claim_id: safeTeamId(options.claimId, "repository claim id"),
    fencing_token: options.fencingToken,
    author_id: author.principal_id,
    dependencies: [...new Set((options.dependencies ?? []).map((item) => safeTeamId(item, "package dependency")))].sort(),
    surfaces: (options.surfaces ?? []).map(normalizeTeamSurface),
    changed_paths: facts.changed_paths,
    diff_hash: facts.diff_hash,
    completion_receipt_hash: String(options.completionReceiptHash ?? ""),
    evidence_hashes: evidenceHashes,
    rollback_ref: rollbackRef,
    policy_hash: options.policyHash ?? null,
    pulse_evidence_hash: options.pulseEvidenceHash ?? null,
    author_trust: teamIdentityTrustLevel(author),
    created_at: now
  };
  if (!Number.isInteger(value.fencing_token) || value.fencing_token < 1) throw new Error("integration package fencing token is invalid");
  if (!value.surfaces.length || value.surfaces.length > 500) throw new Error("integration package requires 1-500 change surfaces");
  if (!value.changed_paths.length) throw new Error("integration package requires a non-empty actual Git diff");
  if (!/^[a-f0-9]{64}$/.test(value.completion_receipt_hash)) throw new Error("integration package requires a frozen completion receipt hash");
  for (const [label, digest] of [["policy hash", value.policy_hash], ["Pulse evidence hash", value.pulse_evidence_hash]]) if (digest && !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`integration package ${label} must be SHA-256`);
  const uncovered = value.changed_paths.filter((item) => !pathCovered(item, value.surfaces));
  if (uncovered.length) throw new Error(`integration package has changed paths outside its declared surfaces: ${uncovered.join(", ")}`);
  return { ...value, package_hash: teamControlDigest(value) };
}

export function verifyIntegrationPackage(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("integration package is invalid");
  rejectRestrictedTeamData(value, "integration package");
  const allowed = new Set([...PACKAGE_FIELDS, "package_hash", ...(options.allowLifecycle ? PACKAGE_LIFECYCLE_FIELDS : [])]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`integration package contains unbound fields: ${unknown.join(", ")}`);
  const copy = packageCore(value);
  if (copy.schema_version !== 2) throw new Error("integration package schema version is invalid");
  if (!["REPOSITORY_TRUSTED", "LEGACY_DEGRADED_HMAC"].includes(copy.author_trust)) throw new Error("integration package author trust level is invalid");
  if (!value.package_hash || value.package_hash !== teamControlDigest(copy)) throw new Error("integration package hash mismatch");
  return value;
}

export function enqueueIntegrationPackage(options = {}) {
  const packageValue = verifyIntegrationPackage(options.package);
  verifyDeclaredGitFacts(packageValue, options);
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const author = authenticate(options, options.author ?? options.identity, "integration.enqueue", now);
  if (author.principal_id !== packageValue.author_id) throw new Error("integration package author does not match authenticated enqueue principal");
  if (options.requireReleaseGradeTrust && teamIdentityTrustLevel(author) !== "REPOSITORY_TRUSTED") throw new Error("release-grade integration enqueue requires repository-trusted Ed25519 authentication");
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      if (options.requireReleaseGradeTrust) {
        const action = verifySignedTeamAction(options.actionEnvelope, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId), repositoryId: snapshot.repository_id, taskId: packageValue.task_id, operation: "integration.enqueue", payloadHash: packageValue.package_hash });
        if (action.principal_id !== author.principal_id || action.expected_revision !== snapshot.revision) throw new Error("signed integration enqueue action principal or revision mismatch");
        store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
      }
      const existing = snapshot.packages.find((item) => item.package_id === packageValue.package_id);
      if (existing) {
        if (existing.package_hash !== packageValue.package_hash) throw new Error("change package id already exists with different content");
        return existing.package_id;
      }
      const claim = snapshot.claims.find((item) => item.claim_id === packageValue.claim_id);
      if (!claim || claim.status !== "RESULT_READY" || claim.fencing_token !== packageValue.fencing_token || claim.principal.principal_id !== author.principal_id) throw new Error("queued package requires the author's matching frozen result claim");
      if (claim.task_id !== packageValue.task_id || claim.assignment_id !== packageValue.assignment_id) throw new Error("integration package task or assignment does not match its claim");
      const receipt = snapshot.completion_receipts.find((item) => item.claim_id === claim.claim_id && item.receipt_hash === packageValue.completion_receipt_hash);
      if (!receipt) throw new Error("integration package is not bound to the claim completion receipt");
      if (receipt.diff_hash && receipt.diff_hash !== packageValue.diff_hash) throw new Error("integration package Git diff does not match the frozen completion receipt");
      const uncovered = packageValue.changed_paths.filter((item) => !pathCovered(item, claim.surfaces));
      if (uncovered.length) throw new Error(`actual Git changes exceed the repository claim: ${uncovered.join(", ")}`);
      const entry = { ...packageValue, state: "QUEUED", enqueued_at: now, reviewed_at: null, admitted_at: null, rejected_at: null };
      snapshot.packages.push(entry);
      claim.status = "PACKAGE_QUEUED";
      claim.package_id = entry.package_id;
      receipt.package_id = entry.package_id;
      snapshot.revision += 1;
      snapshot.updated_at = now;
      store.appendEvent(snapshot, "INTEGRATION_PACKAGE_QUEUED", { task_id: entry.task_id, package_id: entry.package_id, claim_id: claim.claim_id, principal_id: author.principal_id, package_hash: entry.package_hash }, now);
      return entry.package_id;
    }, { expectedRevision: options.expectedRevision, now });
    return structuredClone(mutation.snapshot.packages.find((item) => item.package_id === mutation.result));
  });
}

export function recordIntegrationReview(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const reviewer = authenticate(options, options.reviewer ?? options.identity, "review.submit", now);
  if (options.requireReleaseGradeTrust && teamIdentityTrustLevel(reviewer) !== "REPOSITORY_TRUSTED") throw new Error("release-grade integration review requires repository-trusted Ed25519 authentication");
  const review = structuredClone(options.review);
  if (!review?.review_hash || teamControlDigest(Object.fromEntries(Object.entries(review).filter(([key]) => key !== "review_hash"))) !== review.review_hash) throw new Error("integration review hash mismatch");
  if (review.reviewer_id !== reviewer.principal_id) throw new Error("integration review principal mismatch");
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      const packageValue = snapshot.packages.find((item) => item.package_id === review.package_id);
      if (!packageValue || !["QUEUED", "REVIEWED"].includes(packageValue.state)) throw new Error("integration review requires a queued package");
      if (options.requireReleaseGradeTrust) {
        const action = verifySignedTeamAction(options.actionEnvelope, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId), repositoryId: snapshot.repository_id, taskId: packageValue.task_id, operation: "integration.review", payloadHash: review.review_hash });
        if (action.principal_id !== reviewer.principal_id || action.expected_revision !== snapshot.revision) throw new Error("signed integration review action principal or revision mismatch");
        store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
      }
      if (review.author_id === review.reviewer_id || packageValue.author_id === review.reviewer_id) throw new Error("integration package author cannot record its own review");
      if (review.input_hash !== integrationInputHash(packageValue)) throw new Error("integration review inputs are stale or do not match the exact package");
      const reviewId = review.review_id ?? `review-${review.review_hash.slice(0, 32)}`;
      const existing = snapshot.reviews.find((item) => item.review_id === reviewId);
      if (existing) {
        if (existing.review_hash !== review.review_hash) throw new Error("review id already exists with different content");
        return reviewId;
      }
      snapshot.reviews.push({ ...review, review_id: reviewId });
      if (review.status === "ACCEPTED") {
        packageValue.state = "REVIEWED";
        packageValue.reviewed_at = now;
        const claim = snapshot.claims.find((item) => item.claim_id === packageValue.claim_id);
        claim.status = "REVIEWED";
      }
      snapshot.revision += 1;
      snapshot.updated_at = now;
      store.appendEvent(snapshot, "INTEGRATION_REVIEW_RECORDED", { task_id: packageValue.task_id, package_id: packageValue.package_id, principal_id: reviewer.principal_id, review_id: reviewId, review_status: review.status, input_hash: review.input_hash }, now);
      return reviewId;
    }, { expectedRevision: options.expectedRevision, now });
    return structuredClone(mutation.snapshot.reviews.find((item) => item.review_id === mutation.result));
  });
}

function admissionDecision(options, snapshot, candidate, owner, now) {
  const blockers = [];
  try { verifyDeclaredGitFacts(candidate, options); } catch (error) { blockers.push(`GIT_EVIDENCE_INVALID:${error.message}`); }
  const currentParent = git(options.target ?? process.cwd(), ["rev-parse", "HEAD"]).stdout.trim();
  if (currentParent !== candidate.parent_commit) blockers.push("PARENT_DRIFT");
  const admittedIds = new Set(snapshot.packages.filter((item) => item.state === "ADMITTED").map((item) => item.package_id));
  for (const dependency of candidate.dependencies) if (!admittedIds.has(dependency)) blockers.push(`DEPENDENCY_NOT_ADMITTED:${dependency}`);
  const claim = snapshot.claims.find((item) => item.claim_id === candidate.claim_id);
  if (!claim || !["PACKAGE_QUEUED", "REVIEWED"].includes(claim.status) || claim.fencing_token !== candidate.fencing_token || claim.principal.principal_id !== candidate.author_id) blockers.push("STALE_OR_INVALID_FENCE");
  const review = snapshot.reviews.findLast((item) => item.package_id === candidate.package_id && item.status === "ACCEPTED" && item.input_hash === integrationInputHash(candidate));
  if (!review) blockers.push("EXACT_INPUT_INDEPENDENT_REVIEW_REQUIRED");
  if (review) {
    const currentCodeowners = resolveRequiredOwners({ target: options.target, changedPaths: candidate.changed_paths, codeownersRef: candidate.parent_commit });
    if (review.codeowners_digest !== teamControlDigest(currentCodeowners) || teamControlDigest(review.required_owners) !== teamControlDigest(currentCodeowners.owners)) blockers.push("CODEOWNER_POLICY_DRIFT");
  }
  if (owner.principal_id === candidate.author_id) blockers.push("INTEGRATION_OWNER_NOT_INDEPENDENT");
  if (options.requireReleaseGradeTrust && teamIdentityTrustLevel(owner) !== "REPOSITORY_TRUSTED") blockers.push("LEGACY_AUTHENTICATION_NOT_RELEASE_GRADE");
  if (candidate.surfaces.some((surface) => PROTECTED_KINDS.has(surface.kind)) && !candidate.pulse_evidence_hash && !review?.protected_surface_review) blockers.push("PROTECTED_SURFACE_EVIDENCE_REQUIRED");
  const conflict = analyzeTeamConflicts({ packages: [...snapshot.packages.filter((item) => item.state === "ADMITTED"), candidate] });
  const resolutions = (options.conflictResolutions ?? []).map((item) => {
    const conflictId = safeTeamId(item.conflict_id, "conflict resolution id");
    if (item.decision !== "ACCEPT_ORDERED" || !/^[a-f0-9]{64}$/.test(item.evidence_hash ?? "")) throw new Error("conflict resolution requires ACCEPT_ORDERED and a SHA-256 evidence hash");
    return { conflict_id: conflictId, decision: item.decision, evidence_hash: item.evidence_hash };
  });
  const resolvedIds = new Set(resolutions.map((item) => item.conflict_id));
  const unresolved = conflict.conflicts.filter((item) => !resolvedIds.has(item.conflict_id));
  if (unresolved.length || conflict.unknowns.length) blockers.push("CHANGE_CONFLICT");
  const decision = {
    schema_version: 2,
    decision_id: options.decisionId ?? `decision-${crypto.randomUUID()}`,
    package_id: candidate.package_id,
    status: blockers.length ? "BLOCKED" : "ADMITTED",
    blockers,
    package_input_hash: integrationInputHash(candidate),
    review_hash: review?.review_hash ?? null,
    conflict_analysis_hash: conflict.analysis_hash,
    resolved_conflicts: resolutions,
    unresolved_conflicts: unresolved.map((item) => item.conflict_id),
    repository_revision: snapshot.revision,
    parent_commit: currentParent,
    owner_trust: teamIdentityTrustLevel(owner),
    decided_by: owner.principal_id,
    decided_at: now
  };
  return { ...decision, decision_hash: teamControlDigest(decision) };
}

export function evaluateIntegrationAdmission(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const owner = authenticate(options, options.integrationOwner, "integration.admit", now);
  if (!owner.roles.includes("integration-owner")) throw new Error("integration admission requires the integration-owner role");
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    const candidateId = options.package?.package_id ?? options.packageId;
    const candidate = snapshot.packages.find((item) => item.package_id === candidateId);
    if (!candidate) throw new Error("integration package is not queued in the repository authority");
    return admissionDecision(options, snapshot, candidate, owner, now);
  });
}

export function recordIntegrationDecision(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const owner = authenticate(options, options.integrationOwner ?? options.identity, "integration.admit", now);
  if (!owner.roles.includes("integration-owner")) throw new Error("integration admission requires the integration-owner role");
  const preview = options.decision;
  if (!preview?.decision_hash || teamControlDigest(Object.fromEntries(Object.entries(preview).filter(([key]) => key !== "decision_hash"))) !== preview.decision_hash) throw new Error("integration decision hash mismatch");
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      const candidate = snapshot.packages.find((item) => item.package_id === preview.package_id);
      if (!candidate) throw new Error("integration package is not queued");
      if (candidate.state === "ADMITTED") return candidate.package_id;
      if (options.requireReleaseGradeTrust) {
        const action = verifySignedTeamAction(options.actionEnvelope, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId), repositoryId: snapshot.repository_id, taskId: candidate.task_id, operation: "integration.admit", payloadHash: preview.decision_hash });
        if (action.principal_id !== owner.principal_id || action.expected_revision !== snapshot.revision) throw new Error("signed integration admission action principal or revision mismatch");
        store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
      }
      const current = admissionDecision({ ...options, decisionId: preview.decision_id, conflictResolutions: preview.resolved_conflicts }, snapshot, candidate, owner, now);
      if (current.package_input_hash !== preview.package_input_hash || current.review_hash !== preview.review_hash || current.conflict_analysis_hash !== preview.conflict_analysis_hash) throw new Error("integration decision inputs changed after preview; obtain a new preview");
      if (current.status !== "ADMITTED") throw new Error(`integration admission is blocked: ${current.blockers.join(",")}`);
      candidate.state = "ADMITTED";
      candidate.admitted_at = now;
      const claim = snapshot.claims.find((item) => item.claim_id === candidate.claim_id);
      claim.status = "ADMITTED";
      claim.released_at = now;
      snapshot.decisions.push(current);
      snapshot.revision += 1;
      snapshot.updated_at = now;
      store.appendEvent(snapshot, "INTEGRATION_ADMITTED", { task_id: candidate.task_id, package_id: candidate.package_id, claim_id: candidate.claim_id, principal_id: owner.principal_id, decision_hash: current.decision_hash }, now);
      return candidate.package_id;
    }, { expectedRevision: options.expectedRevision, now });
    return structuredClone(mutation.snapshot.packages.find((item) => item.package_id === mutation.result));
  });
}

export function rejectIntegrationPackage(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const owner = authenticate(options, options.integrationOwner ?? options.identity, "integration.reject", now);
  if (!owner.roles.includes("integration-owner")) throw new Error("integration rejection requires the integration-owner role");
  const reasonCode = safeTeamId(options.reasonCode, "integration rejection reason code");
  if (!/^[a-f0-9]{64}$/.test(options.evidenceHash ?? "")) throw new Error("integration rejection requires a SHA-256 evidence hash");
  return withTeamControlStore(options, (store) => {
    const mutation = store.mutate((snapshot) => {
      const candidate = snapshot.packages.find((item) => item.package_id === options.packageId);
      if (!candidate || candidate.state === "ADMITTED") throw new Error("queued non-admitted package is required for rejection");
      if (options.requireReleaseGradeTrust) {
        const rejectionPayloadHash = teamControlDigest({ package_id: candidate.package_id, reason_code: reasonCode, evidence_hash: options.evidenceHash });
        const action = verifySignedTeamAction(options.actionEnvelope, { now, resolveIdentityKey: (keyId) => store.getTrustedKey(keyId), repositoryId: snapshot.repository_id, taskId: candidate.task_id, operation: "integration.reject", payloadHash: rejectionPayloadHash });
        if (action.principal_id !== owner.principal_id || action.expected_revision !== snapshot.revision) throw new Error("signed integration rejection action principal or revision mismatch");
        store.consumeNonce({ keyId: action.key_id, nonce: action.nonce, operation: action.operation, taskId: action.task_id, expiresAt: action.expires_at, now });
      }
      candidate.state = "REJECTED";
      candidate.rejected_at = now;
      const claim = snapshot.claims.find((item) => item.claim_id === candidate.claim_id);
      claim.status = "REJECTED";
      claim.released_at = now;
      const base = { schema_version: 2, decision_id: `decision-${crypto.randomUUID()}`, package_id: candidate.package_id, status: "REJECTED", reason_code: reasonCode, evidence_hash: options.evidenceHash, decided_by: owner.principal_id, decided_at: now };
      const decision = { ...base, decision_hash: teamControlDigest(base) };
      snapshot.decisions.push(decision);
      snapshot.revision += 1;
      snapshot.updated_at = now;
      store.appendEvent(snapshot, "INTEGRATION_REJECTED", { task_id: candidate.task_id, package_id: candidate.package_id, claim_id: candidate.claim_id, principal_id: owner.principal_id, decision_hash: decision.decision_hash, reason_code: reasonCode }, now);
      return candidate.package_id;
    }, { expectedRevision: options.expectedRevision, now });
    return structuredClone(mutation.snapshot.packages.find((item) => item.package_id === mutation.result));
  });
}

export function inspectIntegrationQueue(options = {}) {
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    return { schema_version: 2, revision: snapshot.revision, packages: snapshot.packages, reviews: snapshot.reviews, decisions: snapshot.decisions, updated_at: snapshot.updated_at, storage: { authority: "GIT_COMMON_DIR", backend: "SQLITE_TRANSACTIONAL", database_file: store.location.database_file } };
  });
}

export function recoverIntegrationState(options = {}) {
  return withTeamControlStore(options, (store) => {
    const snapshot = store.inspect();
    const problems = [];
    for (const claim of snapshot.claims.filter((item) => ["RESULT_READY", "PACKAGE_QUEUED", "REVIEWED"].includes(item.status))) {
      const packageValue = claim.package_id ? snapshot.packages.find((item) => item.package_id === claim.package_id) : null;
      if (claim.status !== "RESULT_READY" && !packageValue) problems.push({ code: "CLAIM_PACKAGE_MISSING", claim_id: claim.claim_id });
      if (packageValue && packageValue.claim_id !== claim.claim_id) problems.push({ code: "PACKAGE_CLAIM_MISMATCH", claim_id: claim.claim_id, package_id: packageValue.package_id });
    }
    for (const packageValue of snapshot.packages.filter((item) => ["QUEUED", "REVIEWED"].includes(item.state))) {
      const claim = snapshot.claims.find((item) => item.claim_id === packageValue.claim_id);
      if (!claim || !["PACKAGE_QUEUED", "REVIEWED"].includes(claim.status)) problems.push({ code: "PACKAGE_FENCE_STATE_MISMATCH", package_id: packageValue.package_id, claim_id: packageValue.claim_id });
    }
    return { schema_version: 1, status: problems.length ? "NEEDS_OPERATOR" : "READY", repository_revision: snapshot.revision, problems, recovery_is_read_only: true };
  });
}
