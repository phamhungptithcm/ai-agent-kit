import { spawnSync } from "node:child_process";
import { classifyFindingChanges } from "./pulse-policy.mjs";
import { pulseDigest } from "./pulse-contract.mjs";

function runGit(root, args, deadline) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: deadline?.remaining() ?? 30000, maxBuffer: 32 * 1024 * 1024 });
}

export function changedPulseFiles(root, base, head, deadline) {
  const target = head === "working-tree" ? null : head;
  const args = target ? ["diff", "--name-status", "-M", `${base}..${target}`, "--"] : ["diff", "--name-status", "-M", base, "--"];
  const result = runGit(root, args, deadline);
  if (result.status !== 0) throw new Error(`cannot compute Architecture Pulse diff: ${result.stderr.trim()}`);
  const records = result.stdout.split("\n").filter(Boolean).map((line) => {
    const [status, first, second] = line.split("\t");
    if (status.startsWith("R")) return { status: "renamed", before: first, path: second };
    return { status: status === "A" ? "added" : status === "D" ? "deleted" : "modified", path: first };
  });
  if (!target) {
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"], deadline);
    if (untracked.status === 0) for (const file of untracked.stdout.split("\n").filter(Boolean)) if (!records.some((record) => record.path === file)) records.push({ status: "added", path: file });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function edgeChanges(base, head) {
  const previous = new Map(base.graph.edges.map((edge) => [edge.fingerprint, edge]));
  const next = new Map(head.graph.edges.map((edge) => [edge.fingerprint, edge]));
  return {
    added: [...next.values()].filter((edge) => !previous.has(edge.fingerprint)),
    removed: [...previous.values()].filter((edge) => !next.has(edge.fingerprint))
  };
}

function affected(head, direct) {
  const reverse = new Map(head.graph.nodes.map((node) => [node.id, []]));
  for (const edge of head.graph.edges) if (reverse.has(edge.to) && reverse.has(edge.from)) reverse.get(edge.to).push(edge.from);
  const paths = new Map();
  const queue = [];
  for (const file of direct) if (reverse.has(file)) { paths.set(file, [file]); queue.push(file); }
  while (queue.length) {
    const current = queue.shift();
    for (const dependent of [...(reverse.get(current) ?? [])].sort()) {
      if (paths.has(dependent)) continue;
      paths.set(dependent, [dependent, ...paths.get(current)]);
      queue.push(dependent);
    }
  }
  const nodeById = new Map(head.graph.nodes.map((node) => [node.id, node]));
  const components = new Map();
  for (const [file, witness] of paths) {
    const component = nodeById.get(file)?.component ?? ".";
    const state = components.get(component) ?? { component, files: [], witnesses: [] };
    state.files.push(file);
    state.witnesses.push({ file, path: witness });
    components.set(component, state);
  }
  return [...components.values()].map((item) => ({ ...item, files: item.files.sort(), witnesses: item.witnesses.sort((left, right) => left.file.localeCompare(right.file)) })).sort((left, right) => left.component.localeCompare(right.component));
}

export function buildPulseDiff({ base, head, changes }) {
  const catalogBaseline = { snapshot: { finding_catalog: base.finding_catalog } };
  const findingChanges = classifyFindingChanges(catalogBaseline, head);
  const edges = edgeChanges(base, head);
  const direct = changes.flatMap((change) => [change.path, change.before].filter(Boolean));
  const body = {
    schema_version: 2,
    protocol: "aak-architecture-pulse-diff-v2",
    repository: head.repository,
    base: { commit: base.repository.commit, result_digest: base.result_digest, source_digest: base.inventory.source_digest },
    head: { commit: head.repository.commit, result_digest: head.result_digest, source_digest: head.inventory.source_digest },
    changes,
    graph_changes: { added_edges: edges.added, removed_edges: edges.removed },
    finding_changes: findingChanges,
    affected_components: affected(head, direct),
    coverage: head.coverage,
    confidence: head.confidence
  };
  return { ...body, evidence_digest: pulseDigest(body) };
}
