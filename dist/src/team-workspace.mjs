import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { requireTeamCapability, safeTeamId, teamControlDigest, verifyTeamIdentityAuthentication } from "./team-control-contract.mjs";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 120_000 });
  return { code: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function requireGit(root, args) {
  const result = git(root, args); if (result.code !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`); return result.stdout;
}

function assertNoSymlinkComponents(value, label) {
  const absolute = path.resolve(value); const parsed = path.parse(absolute); let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} cannot contain symbolic links`);
  }
}

export function verifyTeamWorkspacePlan(plan) {
  if (!plan || plan.schema_version !== 1 || typeof plan !== "object" || Array.isArray(plan)) throw new Error("workspace plan is invalid");
  const claimed = plan.plan_hash; const copy = structuredClone(plan); delete copy.plan_hash;
  if (!/^[a-f0-9]{64}$/.test(claimed ?? "") || teamControlDigest(copy) !== claimed) throw new Error("workspace plan hash mismatch");
  safeTeamId(plan.task_id, "task id"); safeTeamId(plan.assignment_id, "assignment id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(plan.branch ?? "") || plan.branch.includes("..")) throw new Error("workspace plan branch is invalid");
  if (!/^[a-f0-9]{40,64}$/.test(plan.parent_commit ?? "")) throw new Error("workspace plan parent commit is invalid");
  const repositoryRoot = fs.realpathSync(path.resolve(plan.repository_root)); const inspected = inspectTeamWorkspace({ target: repositoryRoot });
  if (fs.realpathSync(path.resolve(plan.common_git_dir)) !== inspected.common_git_dir) throw new Error("workspace plan Git common directory mismatch");
  const approvedRoot = path.resolve(plan.approved_root); const worktreePath = path.resolve(plan.worktree_path); const relative = path.relative(approvedRoot, worktreePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || worktreePath === approvedRoot) throw new Error("workspace plan path escapes its approved root");
  assertNoSymlinkComponents(approvedRoot, "approved worktree root"); assertNoSymlinkComponents(path.dirname(worktreePath), "worktree parent path");
  const expectedCommand = [["git", "worktree", "add", "-b", plan.branch, worktreePath, plan.parent_commit]];
  if (JSON.stringify(plan.commands) !== JSON.stringify(expectedCommand) || plan.destructive !== false) throw new Error("workspace plan command contract is invalid");
  requireGit(repositoryRoot, ["cat-file", "-e", `${plan.parent_commit}^{commit}`]);
  return { ...plan, repository_root: repositoryRoot, common_git_dir: inspected.common_git_dir, approved_root: approvedRoot, worktree_path: worktreePath };
}

export function inspectTeamWorkspace(options = {}) {
  const root = path.resolve(options.target ?? process.cwd());
  const toplevelPath = path.resolve(requireGit(root, ["rev-parse", "--show-toplevel"]));
  const commonGitPath = path.resolve(root, requireGit(root, ["rev-parse", "--git-common-dir"]));
  const toplevel = fs.realpathSync(toplevelPath); const commonGitDir = fs.realpathSync(commonGitPath);
  const branch = requireGit(root, ["branch", "--show-current"]) || null;
  const commit = requireGit(root, ["rev-parse", "HEAD"]);
  const status = requireGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const worktrees = requireGit(root, ["worktree", "list", "--porcelain"]);
  return { schema_version: 1, root: toplevel, common_git_dir: commonGitDir, branch, commit, clean: !status, status_digest: teamControlDigest(status.split(/\r?\n/).filter(Boolean).sort()), worktree_digest: teamControlDigest(worktrees), inspected_at: options.now ?? new Date().toISOString() };
}

export function evaluateParentSnapshot(options = {}) {
  const workspace = inspectTeamWorkspace(options);
  const expected = String(options.parentCommit ?? "");
  if (!/^[a-f0-9]{40,64}$/.test(expected)) throw new Error("parent commit must be a full Git commit digest");
  const result = git(workspace.root, ["merge-base", "--is-ancestor", expected, workspace.commit]);
  const exact = workspace.commit === expected;
  const status = exact && (options.allowDirty === true || workspace.clean) ? "ADMITTED" : "BLOCKED";
  const blockers = [];
  if (!exact) blockers.push(result.code === 0 ? "PARENT_DRIFTED_DESCENDANT" : "PARENT_DIVERGED");
  if (!workspace.clean && options.allowDirty !== true) blockers.push("WORKSPACE_DIRTY");
  if (options.expectedBranch && workspace.branch !== options.expectedBranch) blockers.push("BRANCH_MISMATCH");
  return { schema_version: 1, status, expected_parent: expected, actual_commit: workspace.commit, branch: workspace.branch, clean: workspace.clean, blockers, snapshot_hash: teamControlDigest({ expected, actual: workspace.commit, branch: workspace.branch, status_digest: workspace.status_digest }) };
}

export function planTeamWorkspace(options = {}) {
  const root = path.resolve(options.target ?? process.cwd()); const workspace = inspectTeamWorkspace({ target: root, now: options.now });
  const taskId = safeTeamId(options.taskId, "task id"); const assignmentId = safeTeamId(options.assignmentId, "assignment id");
  const branch = String(options.branch ?? `hunpeolabs/team-${taskId}-${assignmentId}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(branch) || branch.includes("..")) throw new Error("workspace branch is invalid");
  const approvedRoot = path.resolve(options.worktreeRoot ?? path.join(path.dirname(workspace.root), `${path.basename(workspace.root)}-worktrees`));
  const worktreePath = path.resolve(options.worktreePath ?? path.join(approvedRoot, taskId, assignmentId));
  const relative = path.relative(approvedRoot, worktreePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || worktreePath === approvedRoot) throw new Error("worktree path must remain below the approved worktree root");
  const parentCommit = options.parentCommit ?? workspace.commit;
  if (!/^[a-f0-9]{40,64}$/.test(parentCommit)) throw new Error("workspace parent commit must be a full Git digest");
  const plan = { schema_version: 1, task_id: taskId, assignment_id: assignmentId, repository_root: workspace.root, common_git_dir: workspace.common_git_dir, approved_root: approvedRoot, worktree_path: worktreePath, branch, parent_commit: parentCommit, commands: [["git", "worktree", "add", "-b", branch, worktreePath, parentCommit]], destructive: false };
  return { ...plan, plan_hash: teamControlDigest(plan) };
}

export function provisionTeamWorkspace(options = {}) {
  const plan = verifyTeamWorkspacePlan(options.plan ?? planTeamWorkspace(options));
  if (options.apply !== true) return { schema_version: 1, status: "PLANNED", applied: false, plan };
  const identity = verifyTeamIdentityAuthentication(options.identity, { now: options.now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey }); requireTeamCapability(identity, "workspace.provision");
  if (options.confirmPlanHash !== plan.plan_hash) throw new Error("workspace provisioning requires the exact confirmed plan hash");
  const markerDirectory = path.join(plan.common_git_dir, "ai-agent-kit", "team-control", "workspaces");
  fs.mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
  const marker = path.join(markerDirectory, `${plan.plan_hash}.json`);
  if (fs.existsSync(plan.worktree_path)) throw new Error("worktree path already exists");
  fs.mkdirSync(path.dirname(plan.worktree_path), { recursive: true });
  const ownership = { plan_hash: plan.plan_hash, task_id: plan.task_id, assignment_id: plan.assignment_id, created_by: identity.principal_id, state: "PROVISIONING" };
  fs.writeFileSync(marker, `${JSON.stringify(ownership, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const result = git(plan.repository_root, ["worktree", "add", "-b", plan.branch, plan.worktree_path, plan.parent_commit]);
  if (result.code !== 0) { fs.unlinkSync(marker); throw new Error(result.stderr || "Git worktree provisioning failed"); }
  ownership.state = "PROVISIONED"; const temporary = `${marker}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(ownership, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, marker);
  return { schema_version: 1, status: "PROVISIONED", applied: true, worktree_path: plan.worktree_path, branch: plan.branch, parent_commit: plan.parent_commit, plan_hash: plan.plan_hash };
}

export function cleanupTeamWorkspace(options = {}) {
  const plan = verifyTeamWorkspacePlan(options.plan);
  if (!plan?.worktree_path || !plan?.repository_root || !plan?.plan_hash) throw new Error("cleanup requires a workspace plan");
  if (options.apply !== true) return { schema_version: 1, status: "PLANNED", applied: false, action: "git worktree remove", worktree_path: plan.worktree_path };
  const identity = verifyTeamIdentityAuthentication(options.identity, { now: options.now, identitySecret: options.identitySecret, resolveIdentityKey: options.resolveIdentityKey }); requireTeamCapability(identity, "workspace.cleanup");
  if (options.confirmPlanHash !== plan.plan_hash) throw new Error("workspace cleanup requires the exact confirmed plan hash");
  const marker = path.join(plan.common_git_dir, "ai-agent-kit", "team-control", "workspaces", `${plan.plan_hash}.json`);
  if (!fs.existsSync(marker) || fs.lstatSync(marker).isSymbolicLink()) throw new Error("refusing to remove an unowned worktree");
  const ownership = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (ownership.plan_hash !== plan.plan_hash || ownership.task_id !== plan.task_id || ownership.assignment_id !== plan.assignment_id) throw new Error("worktree ownership marker does not match the plan");
  const listed = requireGit(plan.repository_root, ["worktree", "list", "--porcelain"]); const realWorktree = fs.realpathSync(plan.worktree_path);
  if (!listed.split(/\r?\n/).some((line) => line === `worktree ${realWorktree}`)) throw new Error("owned path is not a registered Git worktree");
  const result = git(plan.repository_root, ["worktree", "remove", plan.worktree_path]);
  if (result.code !== 0) throw new Error(result.stderr || "Git worktree cleanup failed");
  fs.unlinkSync(marker);
  return { schema_version: 1, status: "REMOVED", applied: true, worktree_path: plan.worktree_path };
}
