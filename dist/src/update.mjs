import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ADAPTER_IDS,
  ALL_SKILL_ROOTS,
  selectedSkillRoots,
  shouldIncludeScaffoldPath
} from "./adapters.mjs";
import { loadScaffoldFiles } from "./assets.mjs";
import { requireGitRoot, getBranch, getCommit } from "./git.mjs";
import { createRunner } from "./runner.mjs";
import { createOwnershipPlan, finalizeOwnership, ownedContent } from "./ownership.mjs";
import { hasSymlinkComponent, normalizeRelPath } from "./paths.mjs";
import { gitignoreSection, managedSection } from "./templates.mjs";
import { getPackageVersion } from "./version.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value ?? "", "utf8").digest("hex");
}

function transactionId(now = new Date()) {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}-${crypto.randomBytes(3).toString("hex")}`;
}

function readJson(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
}

function readInstallation(root) {
  return readJson(path.join(root, ".ai-agent-kit", "installation.json"));
}

function installedAdapterIds(installation) {
  const selected = ADAPTER_IDS.filter((id) => installation.adapters?.[id] === true);
  if (selected.length) return selected;
  return ["claude", "codex"].filter((id) => installation.adapters?.[id] !== false);
}

function incomingFiles({ selectedAdapters }, sourceFiles) {
  const files = new Map(sourceFiles ?? loadScaffoldFiles());
  const activeSkillRoots = selectedSkillRoots(selectedAdapters);
  for (const rel of [...files.keys()]) {
    const skillRoot = ALL_SKILL_ROOTS.find((root) => rel.startsWith(`${root}/`));
    if (skillRoot) {
      if (!activeSkillRoots.includes(skillRoot)) files.delete(rel);
      continue;
    }
    if (!shouldIncludeScaffoldPath(rel, selectedAdapters)) files.delete(rel);
  }
  for (const rel of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md"]) {
    if (files.has(rel)) files.set(rel, managedSection(files.get(rel)));
  }
  files.set(".gitignore", gitignoreSection());
  return files;
}

function snapshotContent(root, entry) {
  if (!entry?.baseSnapshot) return null;
  let rel;
  try {
    rel = normalizeRelPath(entry.baseSnapshot);
  } catch {
    return null;
  }
  if (!rel.startsWith(".ai-agent-kit/baselines/") || hasSymlinkComponent(root, rel)) return null;
  const filePath = path.join(root, rel);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

export function mergeThreeWay(base, local, incoming) {
  if (local === incoming) return { content: local, changed: false };
  if (local === base) return { content: incoming, changed: true };
  if (incoming === base) return { content: local, changed: false };
  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const incomingLines = incoming.split("\n");
  const length = Math.max(baseLines.length, localLines.length, incomingLines.length);
  const result = [];
  const conflicts = [];
  for (let index = 0; index < length; index += 1) {
    const baseLine = baseLines[index];
    const localLine = localLines[index];
    const incomingLine = incomingLines[index];
    if (localLine === incomingLine) result.push(localLine);
    else if (localLine === baseLine) result.push(incomingLine);
    else if (incomingLine === baseLine) result.push(localLine);
    else conflicts.push(index + 1);
  }
  if (conflicts.length) return { conflict: true, lines: conflicts };
  return { content: result.filter((line) => line !== undefined).join("\n"), changed: true };
}

function baseForEntry(root, installedEntry, local) {
  const snapshot = snapshotContent(root, installedEntry);
  if (snapshot != null) return { content: snapshot, source: installedEntry.baseSnapshot };
  if (installedEntry?.installedSha256 && local != null && sha256(local) === installedEntry.installedSha256) {
    return { content: local, source: "legacy-installed-hash" };
  }
  return { content: null, source: installedEntry ? "legacy-base-unavailable" : "new-entry" };
}

function decisionFor({ root, entry, installedEntry, incoming }) {
  const local = ownedContent(root, entry);
  const base = baseForEntry(root, installedEntry, local);
  const evidence = {
    baseSha256: base.content == null ? installedEntry?.installedSha256 ?? null : sha256(base.content),
    localSha256: local == null ? null : sha256(local),
    incomingSha256: sha256(incoming),
    baseSource: base.source
  };
  if (!installedEntry) {
    return local == null
      ? { path: entry.path, mode: entry.mode, action: "CREATE", incoming, local, base: null, evidence }
      : { path: entry.path, mode: entry.mode, action: "NEEDS_REVIEW", reason: "unowned local path exists", incoming, local, base: null, evidence };
  }
  if (local == null) {
    return { path: entry.path, mode: entry.mode, action: "NEEDS_REVIEW", reason: "managed path is missing", incoming, local, base: base.content, evidence };
  }
  if (base.content == null) {
    return { path: entry.path, mode: entry.mode, action: "NEEDS_REVIEW", reason: "legacy base snapshot unavailable for modified content", incoming, local, base: null, evidence };
  }
  if (local === incoming) return { path: entry.path, mode: entry.mode, action: "UNCHANGED", incoming, local, base: base.content, evidence };
  if (local === base.content) return { path: entry.path, mode: entry.mode, action: "UPDATE", incoming, local, base: base.content, evidence };
  if (incoming === base.content) return { path: entry.path, mode: entry.mode, action: "PRESERVE_LOCAL", incoming, local, base: base.content, evidence };
  const merged = mergeThreeWay(base.content, local, incoming);
  if (merged.conflict) {
    return {
      path: entry.path, mode: entry.mode, action: "NEEDS_REVIEW",
      reason: `overlapping edits at line(s) ${merged.lines.join(", ")}`,
      incoming, local, base: base.content, evidence
    };
  }
  return { path: entry.path, mode: entry.mode, action: "MERGE", next: merged.content, incoming, local, base: base.content, evidence };
}

export function planUpdate(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target));
  const installation = readInstallation(root);
  if (!installation) throw new Error("AI Agent Kit is not installed in this repository.");
  const selectedAdapters = installedAdapterIds(installation);
  const files = incomingFiles({ selectedAdapters }, deps.scaffoldFiles);
  const plan = createOwnershipPlan(files, { selectedAdapters })
    .filter((entry) => files.has(entry.path))
    .map((entry) => decisionFor({
      root,
      entry,
      installedEntry: (installation.managedFiles ?? []).find((candidate) => candidate.path === entry.path),
      incoming: files.get(entry.path)
    }));
  const retired = (installation.managedFiles ?? [])
    .filter((entry) => !files.has(entry.path))
    .map((entry) => ({ path: entry.path, mode: entry.mode, action: "PRESERVE_RETIRED", reason: "no longer managed by incoming version" }));
  const decisions = [...plan, ...retired].sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    operation: "update",
    repositoryRoot: root,
    installedVersion: installation.version ?? "legacy",
    incomingVersion: deps.packageVersion ?? getPackageVersion(),
    repositoryCommit: getCommit(runner, root),
    repositoryBranch: getBranch(runner, root),
    decisions,
    summary: decisions.reduce((counts, item) => {
      counts[item.action] = (counts[item.action] ?? 0) + 1;
      return counts;
    }, {})
  };
}

function replaceOwnedSection(fullText, ownedText) {
  const begin = fullText.indexOf("<!-- BEGIN @hunpeolabs/ai-agent-kit managed -->");
  const endMarker = "<!-- END @hunpeolabs/ai-agent-kit managed -->";
  const end = fullText.indexOf(endMarker);
  if (begin < 0 || end < begin) return ownedText;
  return `${fullText.slice(0, begin)}${ownedText.trimEnd()}${fullText.slice(end + endMarker.length)}`;
}

export function applyUpdate(options, deps = {}) {
  const plan = planUpdate(options, deps);
  const root = plan.repositoryRoot;
  const txId = deps.transactionId ?? transactionId(deps.now);
  const txRoot = path.join(root, ".ai-agent-kit", "transactions", txId);
  const backupRoot = path.join(root, ".ai-agent-kit", "backups", txId);
  const conflictRoot = path.join(root, ".ai-agent-kit", "conflicts", txId);
  const written = [];
  let writeCount = 0;
  const write = (relPath, content) => {
    const rel = normalizeRelPath(relPath);
    if (hasSymlinkComponent(root, rel)) throw new Error(`Update refuses to write through a symbolic link: ${rel}`);
    const target = path.join(root, rel);
    const existed = fs.existsSync(target);
    const previous = existed ? fs.readFileSync(target) : null;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written.push({ rel, existed, previous });
    writeCount += 1;
    if (deps.failAfterWrites === writeCount) throw new Error(`Injected update failure after write ${writeCount}`);
  };
  const rollback = () => {
    for (const item of [...written].reverse()) {
      const target = path.join(root, item.rel);
      if (item.existed) fs.writeFileSync(target, item.previous);
      else if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
  };
  fs.mkdirSync(txRoot, { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  try {
    write(path.relative(root, path.join(txRoot, "journal.json")), `${JSON.stringify({ ...plan, status: "PLANNED" }, null, 2)}\n`);
    for (const decision of plan.decisions) {
      if (decision.action === "NEEDS_REVIEW") {
        const artifactDir = path.join(conflictRoot, decision.path);
        write(path.relative(root, path.join(artifactDir, "base.txt")), decision.base ?? `UNAVAILABLE\nsha256=${decision.evidence.baseSha256 ?? "unknown"}\n`);
        write(path.relative(root, path.join(artifactDir, "local.txt")), decision.local ?? "MISSING\n");
        write(path.relative(root, path.join(artifactDir, "incoming.txt")), decision.incoming);
        write(path.relative(root, path.join(artifactDir, "metadata.json")), `${JSON.stringify({ action: decision.action, reason: decision.reason, evidence: decision.evidence }, null, 2)}\n`);
        continue;
      }
      if (!["CREATE", "UPDATE", "MERGE"].includes(decision.action)) continue;
      const rel = normalizeRelPath(decision.path);
      const target = path.join(root, rel);
      if (fs.existsSync(target)) {
        const backupRel = path.relative(root, path.join(backupRoot, rel));
        write(backupRel, fs.readFileSync(target));
      }
      let next = decision.action === "MERGE" ? decision.next : decision.incoming;
      if (decision.mode === "managed-section" && fs.existsSync(target)) {
        next = replaceOwnedSection(fs.readFileSync(target, "utf8"), next);
      }
      write(rel, next);
    }
    const selectedAdapters = installedAdapterIds(readInstallation(root));
    const updateFiles = incomingFiles({ selectedAdapters }, deps.scaffoldFiles);
    const activeEntries = createOwnershipPlan(updateFiles, { selectedAdapters })
      .filter((entry) => fs.existsSync(path.join(root, entry.path)));
    const previousInstallation = readInstallation(root);
    const finalizedEntries = finalizeOwnership(root, activeEntries, plan.incomingVersion);
    const managedFiles = finalizedEntries.map((entry) => {
      const decision = plan.decisions.find((candidate) => candidate.path === entry.path);
      if (decision?.action === "NEEDS_REVIEW") {
        const previous = previousInstallation.managedFiles?.find((candidate) => candidate.path === entry.path);
        return previous ?? entry;
      }
      const content = ownedContent(root, entry);
      const baseSnapshot = `.ai-agent-kit/baselines/${plan.incomingVersion}/${entry.path}`;
      write(baseSnapshot, content);
      return { ...entry, baseSnapshot, baseSha256: sha256(content) };
    });
    const activePaths = new Set(managedFiles.map((entry) => entry.path));
    for (const retired of previousInstallation.managedFiles ?? []) {
      if (!activePaths.has(retired.path)) managedFiles.push({ ...retired, retired: true });
    }
    managedFiles.sort((left, right) => left.path.localeCompare(right.path));
    const nextInstallation = {
      ...previousInstallation,
      version: plan.incomingVersion,
      contractVersion: 3,
      repositoryCommit: plan.repositoryCommit,
      managedFiles
    };
    write(".ai-agent-kit/installation.json", `${JSON.stringify(nextInstallation, null, 2)}\n`);
    const report = { ...plan, transactionId: txId, status: plan.summary.NEEDS_REVIEW ? "NEEDS_REVIEW" : "APPLIED" };
    write(path.relative(root, path.join(txRoot, "report.json")), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    rollback();
    fs.mkdirSync(txRoot, { recursive: true });
    fs.writeFileSync(
      path.join(txRoot, "journal.json"),
      `${JSON.stringify({
        ...plan,
        transactionId: txId,
        status: "ROLLED_BACK",
        error: error instanceof Error ? error.message : String(error)
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    throw error;
  }
}

export function renderUpdatePlan(plan, mode = "DRY RUN") {
  return `AI Agent Kit Update: ${mode}

Repository: ${plan.repositoryRoot}
Installed version: ${plan.installedVersion}
Incoming version: ${plan.incomingVersion}
Decision summary: ${Object.entries(plan.summary).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}

Decisions:
${plan.decisions.map((item) => `- ${item.action}: ${item.mode ?? "retired"}: ${item.path}${item.reason ? ` — ${item.reason}` : ""}`).join("\n") || "- None"}

${mode === "DRY RUN" ? "No files were modified." : "Transaction evidence was written under .ai-agent-kit/."}
No Git operations were performed.`;
}
