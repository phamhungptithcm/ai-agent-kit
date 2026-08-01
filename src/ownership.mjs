import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent, normalizeRelPath } from "./paths.mjs";
import { MANAGED_BEGIN, MANAGED_END } from "./templates.mjs";
import { selectedSkillRoots } from "./adapters.mjs";

const MAX_OWNED_FILE_BYTES = 10_000_000;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function managedSection(text) {
  const begin = text.indexOf(MANAGED_BEGIN);
  const end = text.indexOf(MANAGED_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return text.slice(begin, end + MANAGED_END.length);
}

export function ownedContent(root, entry) {
  const relPath = normalizeRelPath(entry.path);
  const filePath = path.join(root, relPath);
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).size > MAX_OWNED_FILE_BYTES) return null;
  const text = fs.readFileSync(filePath, "utf8");
  return entry.mode === "managed-section" ? managedSection(text) : text;
}

export function createOwnershipPlan(files, { selectedAdapters }) {
  const entries = new Map();
  const add = (filePath, mode, generatedFrom) => entries.set(filePath, { path: filePath, mode, generatedFrom });

  for (const relPath of files.keys()) {
    const mode = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md"].includes(relPath)
      ? "managed-section"
      : "generated-file";
    add(relPath, mode, `package:assets/enterprise-ai-agent-os/${relPath}`);
  }
  for (const relPath of files.keys()) {
    const match = relPath.match(/^\.ai\/skills-src\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const generatedFrom = relPath;
    for (const skillRoot of selectedSkillRoots(selectedAdapters)) {
      add(`${skillRoot}/${match[1]}/${match[2]}`, "generated-file", generatedFrom);
    }
  }
  add(".gitignore", "managed-section", "bootstrap:gitignore-section");
  add(".ai-agent-kit/project.yaml", "generated-file", "bootstrap:project-profile");
  add(".ai-agent-kit/output/merge-request-description.md", "generated-file", "bootstrap:merge-request-template");
  add(".ai-agent-kit/output/jira-update.md", "generated-file", "bootstrap:jira-template");

  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function finalizeOwnership(root, plan, packageVersion) {
  return plan.map((entry) => {
    const content = ownedContent(root, entry);
    if (content == null) {
      throw new Error(`Cannot record ownership for missing or invalid managed content: ${entry.path}`);
    }
    return {
      ...entry,
      sourceVersion: packageVersion,
      installedSha256: sha256(content)
    };
  });
}

export function verifyOwnership(root, managedFiles = []) {
  const entries = managedFiles.map((entry) => {
    let relPath;
    try {
      relPath = normalizeRelPath(entry.path);
    } catch {
      return { ...entry, state: "INVALID_PATH" };
    }
    const filePath = path.join(root, relPath);
    if (!fs.existsSync(filePath)) return { ...entry, state: "MISSING" };
    if (hasSymlinkComponent(root, relPath)) return { ...entry, state: "SYMLINK" };
    if (fs.statSync(filePath).size > MAX_OWNED_FILE_BYTES) return { ...entry, state: "TOO_LARGE" };
    if (!entry.installedSha256) return { ...entry, state: "UNVERIFIED" };
    const content = ownedContent(root, entry);
    if (content == null) return { ...entry, state: "INVALID_MANAGED_SECTION" };
    return {
      ...entry,
      state: sha256(content) === entry.installedSha256 ? "UNCHANGED" : "MODIFIED"
    };
  });
  const counts = entries.reduce((result, entry) => {
    result[entry.state] = (result[entry.state] ?? 0) + 1;
    return result;
  }, {});
  const safe = entries.length > 0 && entries.every((entry) => entry.state === "UNCHANGED");
  return { entries, counts, safe };
}
