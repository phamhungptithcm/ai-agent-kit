import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireGitRoot, getCommit } from "./git.mjs";
import { createRunner } from "./runner.mjs";
import { hasSymlinkComponent, normalizeRelPath } from "./paths.mjs";
import { queryEligibleMemory } from "./memory-lifecycle.mjs";
import { bindTaskContextPack } from "./governed-runtime.mjs";

const MANDATORY_CORE = [
  ".ai/core/instruction-precedence.md",
  ".ai/core/mission.md",
  ".ai/core/engineering-principles.md",
  ".ai/core/required-workflow.md",
  ".ai/core/risk-model.md",
  ".ai/core/quality-gates.md",
  ".ai/core/output-contract.md",
  ".ai/core/memory-policy.md"
];
const OPTIONAL_ROOTS = [".ai/rules", ".ai/quality-profiles", ".ai/skills-src"];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error("task id must be 1-128 safe characters");
  return value;
}

function words(value) {
  return new Set(String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []);
}

function listFiles(root, relRoot) {
  const absolute = path.join(root, relRoot);
  if (!fs.existsSync(absolute) || hasSymlinkComponent(root, relRoot)) return [];
  const result = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.push(rel);
    }
  };
  walk(absolute);
  return result;
}

function readTask(root, id) {
  const file = path.join(root, ".ai-agent-kit", "runtime", "tasks", `${safeId(id)}.json`);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function repositoryIntelligence(root, runner, commit) {
  const stateFile = path.join(root, ".ai", "local", "repository-intelligence-state.json");
  if (!fs.existsSync(stateFile)) return { mode: "DEGRADED", reason: "repository intelligence state is missing" };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { mode: "DEGRADED", reason: "repository intelligence state is invalid" };
  }
  const gitStatus = runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, timeout: 30000 });
  if (state.git_commit !== commit) return { mode: "DEGRADED", reason: "indexed commit does not match repository commit" };
  if (gitStatus.code !== 0 || gitStatus.stdout.trim()) {
    return { mode: "DEGRADED", reason: "worktree differs from the indexed repository state" };
  }
  const cleanSignature = crypto.createHash("sha256").update(commit).digest("hex");
  if (state.worktree_signature !== cleanSignature) {
    return { mode: "DEGRADED", reason: "stored worktree signature is stale" };
  }
  return {
    mode: "READY",
    reason: "indexed commit and clean worktree signature match",
    indexedAtUnix: state.indexed_at_unix ?? null,
    codegraphVersion: state.codegraph?.version ?? null,
    cocoindexVersion: state.cocoindex?.version ?? null
  };
}

function scoreCandidate(relPath, content, intentWords) {
  const candidateWords = words(`${relPath}\n${content.slice(0, 4000)}`);
  let score = 0;
  for (const word of intentWords) if (candidateWords.has(word)) score += 1;
  return score;
}

function markdownFor(pack) {
  return `# Context Pack: ${pack.task.id}

Status: **${pack.status}**
Repository commit: \`${pack.repository.commit}\`
Policy revision: \`${pack.policyRevision}\`
Token estimate: ${pack.budget.usedEstimatedTokens}/${pack.budget.maxEstimatedTokens}
Content hash: \`${pack.contentHash}\`

## Task

Goal: ${pack.task.goal ?? "Not provided"}

Acceptance criteria:
${pack.task.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- None"}

## Repository Intelligence

- Mode: ${pack.repository.intelligence.mode}
- Reason: ${pack.repository.intelligence.reason}

## Included Context

${pack.items.map((item) => `### ${item.path}\n\nReason: ${item.selectionReason}\nProvenance: ${item.provenance}\n\n\`\`\`\n${item.content}\n\`\`\``).join("\n\n")}

## Exclusions

${pack.exclusions.map((item) => `- ${item.path}: ${item.reason}`).join("\n") || "- None"}
`;
}

export function compileContext(options, deps = {}) {
  const runner = deps.runner ?? createRunner();
  const root = requireGitRoot(runner, path.resolve(options.target ?? process.cwd()));
  const task = readTask(root, options.id);
  const commit = getCommit(runner, root);
  const intelligence = repositoryIntelligence(root, runner, commit);
  const maxEstimatedTokens = Number(options.budget ?? 12_000);
  if (!Number.isInteger(maxEstimatedTokens) || maxEstimatedTokens < 500) throw new Error("context budget must be an integer of at least 500 tokens");
  const intent = words([
    task.goal,
    ...(task.acceptance_criteria ?? []),
    ...(task.plan?.steps ?? []).map((step) => step.description),
    ...(task.context?.facts ?? []).map((fact) => fact.statement),
    ...(task.context?.assumptions ?? []).map((assumption) => assumption.statement)
  ].join("\n"));
  const candidates = [];
  for (const relPath of MANDATORY_CORE) {
    const file = path.join(root, relPath);
    if (fs.existsSync(file) && !hasSymlinkComponent(root, relPath)) {
      candidates.push({ path: relPath, content: fs.readFileSync(file, "utf8"), mandatory: true, score: Number.MAX_SAFE_INTEGER });
    }
  }
  for (const relPath of OPTIONAL_ROOTS.flatMap((item) => listFiles(root, item))) {
    const content = fs.readFileSync(path.join(root, relPath), "utf8");
    candidates.push({ path: relPath, content, mandatory: false, score: scoreCandidate(relPath, content, intent) });
  }
  if (task.skill_routing?.status === "ROUTED" && task.skill_routing.skill) {
    const routedPath = normalizeRelPath(path.posix.join(".ai/skills-src", task.skill_routing.skill));
    const routedFile = path.join(root, routedPath);
    if (!fs.existsSync(routedFile) || hasSymlinkComponent(root, routedPath) || !fs.lstatSync(routedFile).isFile()) {
      throw new Error(`routed skill is unavailable or unsafe: ${routedPath}`);
    }
    const existing = candidates.find((item) => item.path === routedPath);
    if (existing) {
      existing.mandatory = true;
      existing.score = Number.MAX_SAFE_INTEGER;
      existing.provenance = `skill-route://${task.skill_routing.config_hash}/${task.skill_routing.route_id}`;
    } else {
      candidates.push({
        path: routedPath,
        content: fs.readFileSync(routedFile, "utf8"),
        provenance: `skill-route://${task.skill_routing.config_hash}/${task.skill_routing.route_id}`,
        mandatory: true,
        score: Number.MAX_SAFE_INTEGER
      });
    }
  }
  for (const fact of task.context?.facts ?? []) {
    candidates.push({
      path: `task://${task.id}/fact/${digest(fact).slice(0, 12)}`,
      content: fact.statement,
      provenance: fact.source,
      mandatory: true,
      score: Number.MAX_SAFE_INTEGER
    });
  }
  for (const memory of queryEligibleMemory({ target: root, limit: 10 })) {
    candidates.push({
      path: `memory://${memory.id}`,
      content: `${memory.title}\n${memory.content}`,
      provenance: memory.source,
      mandatory: false,
      score: scoreCandidate(`${memory.title}\n${memory.category}`, memory.content, intent),
      memory
    });
  }
  candidates.sort((a, b) =>
    Number(b.mandatory) - Number(a.mandatory)
    || b.score - a.score
    || a.path.localeCompare(b.path)
  );
  const items = [];
  const exclusions = [];
  let usedEstimatedTokens = 0;
  for (const candidate of candidates) {
    const estimatedTokens = Math.max(1, Math.ceil(candidate.content.length / 4));
    if (!candidate.mandatory && candidate.score === 0) {
      exclusions.push({ path: candidate.path, reason: "no deterministic task-intent match", estimatedTokens });
      continue;
    }
    if (usedEstimatedTokens + estimatedTokens > maxEstimatedTokens) {
      exclusions.push({ path: candidate.path, reason: "token budget exceeded", estimatedTokens });
      continue;
    }
    usedEstimatedTokens += estimatedTokens;
    items.push({
      path: candidate.path,
      kind: candidate.path.startsWith("memory://") ? "approved-memory" : candidate.path.startsWith("task://") ? "task-fact" : "repository-policy",
      content: candidate.content,
      contentSha256: sha256(candidate.content),
      estimatedTokens,
      provenance: candidate.provenance ?? `repository://${commit}/${candidate.path}`,
      selectionReason: candidate.mandatory ? "mandatory governed context" : `task-intent match score ${candidate.score}`
    });
  }
  const missingMandatory = MANDATORY_CORE.filter((relPath) => !items.some((item) => item.path === relPath));
  const status = missingMandatory.length ? "BLOCKED" : intelligence.mode;
  for (const relPath of missingMandatory) exclusions.push({ path: relPath, reason: "required context missing or over budget" });
  const pack = {
    schemaVersion: 1,
    status,
    task: {
      id: task.id,
      goal: task.goal,
      acceptanceCriteria: task.acceptance_criteria ?? [],
      state: task.state,
      skillRouting: task.skill_routing,
      taskContractHash: digest({
        id: task.id, goal: task.goal, acceptanceCriteria: task.acceptance_criteria ?? [],
        context: task.context, plan: task.plan, skillRouting: task.skill_routing
      })
    },
    repository: { root, commit, intelligence },
    policyRevision: task.capability?.policy_revision ?? "unknown",
    budget: { maxEstimatedTokens, usedEstimatedTokens, estimator: "ceil(utf8-characters/4)" },
    items,
    exclusions: exclusions.sort((a, b) => a.path.localeCompare(b.path))
  };
  pack.contentHash = digest(pack);
  const outputRoot = path.join(root, ".ai-agent-kit", "context", task.id);
  fs.mkdirSync(outputRoot, { recursive: true });
  const jsonPath = path.join(outputRoot, `${pack.contentHash}.json`);
  const markdownPath = path.join(outputRoot, `${pack.contentHash}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(markdownPath, markdownFor(pack), { encoding: "utf8", mode: 0o600 });
  bindTaskContextPack({ target: root, id: task.id, contentHash: pack.contentHash, status: pack.status, repositoryCommit: commit, intelligenceMode: intelligence.mode });
  return { pack, jsonPath, markdownPath };
}

export function inspectContextPack(options) {
  const root = path.resolve(options.target ?? process.cwd());
  const id = safeId(options.id);
  const directory = path.join(root, ".ai-agent-kit", "context", id);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
