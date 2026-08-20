import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { requireTeamCapability, safeTeamId, teamControlDigest, teamIdentityTrustLevel, teamTimestamp, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";
import { withTeamControlStore } from "./team-control-store.mjs";

const CODEOWNER_LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

function normalizeOwner(value, label = "required owner") {
  const owner = String(value ?? "");
  if (owner.startsWith("@")) {
    if (!/^@[A-Za-z0-9][A-Za-z0-9_.-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127})?$/.test(owner)) throw new Error(`${label} must be a safe GitHub owner`);
    return owner;
  }
  return safeTeamId(owner, label);
}

function patternRegex(pattern) {
  let source = pattern.trim().replace(/^\//, "");
  const anchored = pattern.startsWith("/");
  const directory = source.endsWith("/");
  if (directory) source += "**";
  let regex = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*" && source[index + 1] === "*") { regex += ".*"; index += 1; }
    else if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${anchored ? "^" : "(?:^|.*/)"}${regex}$`);
}

export function resolveRequiredOwners(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  let source = null;
  let content = null;
  if (options.codeownersRef) {
    if (!/^[a-f0-9]{40,64}$/.test(options.codeownersRef)) throw new Error("CODEOWNERS ref must be a full Git commit digest");
    const commit = spawnSync("git", ["cat-file", "-e", `${options.codeownersRef}^{commit}`], { cwd: root, encoding: "utf8", timeout: 30_000 });
    if (commit.status !== 0) throw new Error(commit.stderr.trim() || "CODEOWNERS Git commit is unavailable");
    for (const location of CODEOWNER_LOCATIONS) {
      const exists = spawnSync("git", ["cat-file", "-e", `${options.codeownersRef}:${location}`], { cwd: root, encoding: "utf8", timeout: 30_000 });
      if (exists.status !== 0) continue;
      const result = spawnSync("git", ["show", `${options.codeownersRef}:${location}`], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 + 1 });
      if (result.error || result.status !== 0) throw new Error(result.error?.message ?? (result.stderr.trim() || "CODEOWNERS could not be read from Git"));
      source = location; content = result.stdout; break;
    }
  } else {
    const codeowners = CODEOWNER_LOCATIONS.map((item) => path.join(root, item)).find((item) => fs.existsSync(item));
    if (codeowners) {
      const descriptor = fs.openSync(codeowners, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink > 1 || stat.size > 1024 * 1024) throw new Error("CODEOWNERS must be a bounded non-linked regular file");
        source = path.relative(root, codeowners).replaceAll("\\", "/");
        content = fs.readFileSync(descriptor, "utf8");
      } finally { fs.closeSync(descriptor); }
    }
  }
  if (content == null) return { source: null, source_digest: null, owners: [], by_path: {} };
  if (Buffer.byteLength(content) > 1024 * 1024) throw new Error("CODEOWNERS exceeds its byte budget");
  const rules = content.split("\n").map((line) => line.replace(/\s+#.*$/, "").trim()).filter(Boolean).map((line) => {
    const [pattern, ...owners] = line.split(/\s+/);
    return { pattern, regex: patternRegex(pattern), owners: owners.filter((item) => item.startsWith("@")) };
  });
  const byPath = {};
  for (const changedPath of options.changedPaths ?? []) {
    let selected = [];
    for (const rule of rules) if (rule.regex.test(changedPath)) selected = rule.owners;
    byPath[changedPath] = selected;
  }
  return { source, source_digest: crypto.createHash("sha256").update(content).digest("hex"), owners: [...new Set(Object.values(byPath).flat())].sort(), by_path: byPath };
}

function resolver(options) {
  return options.resolveIdentityKey ?? ((keyId) => withTeamControlStore(options, (store) => store.getTrustedKey(keyId)));
}

export function evaluateIndependentReview(options = {}) {
  const now = teamTimestamp(options.now ?? new Date().toISOString());
  const authentication = { now, identitySecret: options.identitySecret, resolveIdentityKey: resolver(options) };
  const author = verifyTeamIdentityAuthentication(options.author, authentication);
  const reviewer = verifyTeamIdentityAuthentication(options.reviewer, authentication);
  requireTeamCapability(reviewer, "review.submit");
  const codeowners = options.target && options.changedPaths ? resolveRequiredOwners(options) : { source: null, source_digest: null, owners: [], by_path: {} };
  const requiredOwners = [...new Set([...(options.requiredOwners ?? []), ...codeowners.owners].map((item) => normalizeOwner(item)))].sort();
  const ownerApprovals = (options.ownerApprovals ?? []).map((approval) => {
    const ownerIdentity = verifyTeamIdentityAuthentication(approval.identity, authentication);
    const owner = normalizeOwner(approval.owner, "owner approval");
    if (![ownerIdentity.principal_id, ownerIdentity.subject, `@${ownerIdentity.subject}`].includes(owner)) throw new Error("owner approval identity does not match the declared owner");
    if (!/^[a-f0-9]{64}$/.test(approval.evidence_hash ?? "")) throw new Error("owner approval requires SHA-256 evidence");
    return { owner, principal_id: ownerIdentity.principal_id, evidence_hash: approval.evidence_hash, trust: teamIdentityTrustLevel(ownerIdentity) };
  });
  const approvals = [...new Set(ownerApprovals.map((item) => item.owner))].sort();
  const blockers = [];
  if (author.principal_id === reviewer.principal_id || author.subject === reviewer.subject) blockers.push("SELF_REVIEW");
  if (!reviewer.roles.includes("reviewer")) blockers.push("REVIEWER_ROLE_MISSING");
  const missingOwners = requiredOwners.filter((owner) => !approvals.includes(owner));
  if (missingOwners.length) blockers.push("CODEOWNER_APPROVAL_MISSING");
  if (!/^[a-f0-9]{64}$/.test(options.evidenceHash ?? "")) blockers.push("REVIEW_EVIDENCE_MISSING");
  if (!/^[a-f0-9]{64}$/.test(options.inputHash ?? "")) blockers.push("EXACT_REVIEW_INPUT_MISSING");
  if (options.requireReleaseGradeTrust && teamIdentityTrustLevel(reviewer) !== "REPOSITORY_TRUSTED") blockers.push("LEGACY_REVIEW_AUTHENTICATION_NOT_RELEASE_GRADE");
  if (options.requireReleaseGradeTrust && ownerApprovals.some((item) => item.trust !== "REPOSITORY_TRUSTED")) blockers.push("LEGACY_OWNER_AUTHENTICATION_NOT_RELEASE_GRADE");
  const result = {
    schema_version: 2,
    package_id: safeTeamId(options.packageId, "change package id"),
    status: blockers.length ? "REJECTED" : "ACCEPTED",
    input_hash: options.inputHash ?? null,
    author_id: author.principal_id,
    reviewer_id: reviewer.principal_id,
    reviewer_trust: teamIdentityTrustLevel(reviewer),
    codeowners_source: codeowners.source,
    codeowners_digest: teamControlDigest(codeowners),
    required_owners: requiredOwners,
    owner_approvals: ownerApprovals,
    missing_owners: missingOwners,
    blockers,
    protected_surface_review: Boolean(options.protectedSurfaceReview),
    reviewed_at: now,
    evidence_hash: options.evidenceHash ?? null
  };
  return { ...result, review_hash: teamControlDigest(result) };
}
