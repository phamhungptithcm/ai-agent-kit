import path from "node:path";
import { PULSE_METRIC_VERSION, confidenceBand, finiteMetric } from "./pulse-contract.mjs";

function adjacency(nodes, edges) {
  const graph = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) if (graph.has(edge.from) && graph.has(edge.to)) graph.get(edge.from).add(edge.to);
  return graph;
}

function reverseAdjacency(nodes, edges) {
  const graph = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) if (graph.has(edge.from) && graph.has(edge.to)) graph.get(edge.to).add(edge.from);
  return graph;
}

function stronglyConnectedComponents(graph) {
  let index = 0;
  const indexes = new Map();
  const lows = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const enter = (node, parent = null) => {
    indexes.set(node, index);
    lows.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    return { node, parent, targets: [...(graph.get(node) ?? [])].sort(), cursor: 0 };
  };
  for (const start of [...graph.keys()].sort()) {
    if (indexes.has(start)) continue;
    const frames = [enter(start)];
    while (frames.length) {
      const frame = frames.at(-1);
      if (frame.cursor < frame.targets.length) {
        const target = frame.targets[frame.cursor++];
        if (!indexes.has(target)) frames.push(enter(target, frame.node));
        else if (onStack.has(target)) lows.set(frame.node, Math.min(lows.get(frame.node), indexes.get(target)));
        continue;
      }
      frames.pop();
      if (frame.parent != null) lows.set(frame.parent, Math.min(lows.get(frame.parent), lows.get(frame.node)));
      if (lows.get(frame.node) === indexes.get(frame.node)) {
        const component = [];
        let current;
        do { current = stack.pop(); onStack.delete(current); component.push(current); } while (current !== frame.node);
        components.push(component.sort());
      }
    }
  }
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function condensationDepth(graph, components) {
  const componentByNode = new Map();
  components.forEach((component, id) => component.forEach((node) => componentByNode.set(node, id)));
  const dag = new Map(components.map((_, id) => [id, new Set()]));
  const indegree = new Map(components.map((_, id) => [id, 0]));
  for (const [from, targets] of graph) for (const to of targets) {
    const sourceId = componentByNode.get(from); const targetId = componentByNode.get(to);
    if (sourceId !== targetId && !dag.get(sourceId).has(targetId)) { dag.get(sourceId).add(targetId); indegree.set(targetId, indegree.get(targetId) + 1); }
  }
  const queue = [...indegree].filter(([, value]) => value === 0).map(([id]) => id).sort((a, b) => a - b);
  const rootCount = queue.length;
  const depth = new Map(components.map((_, id) => [id, 0]));
  while (queue.length) {
    const source = queue.shift();
    for (const target of [...dag.get(source)].sort((a, b) => a - b)) {
      depth.set(target, Math.max(depth.get(target), depth.get(source) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return { depth: Math.max(0, ...depth.values()), roots: rootCount, component_by_node: componentByNode, dag };
}

function descendants(graph, start, maximum = 10000) {
  const visited = new Set();
  const queue = [...(graph.get(start) ?? [])];
  let cursor = 0;
  while (cursor < queue.length && visited.size < maximum) {
    const current = queue[cursor++];
    if (current === start || visited.has(current)) continue;
    visited.add(current);
    queue.push(...(graph.get(current) ?? []));
  }
  return visited.size;
}

function boundedBlastSample(nodes, degrees, maximum = 200) {
  if (nodes.length <= 2000) return nodes;
  const selected = new Map();
  const ranked = [...degrees].sort((left, right) => (right.fan_in + right.fan_out) - (left.fan_in + left.fan_out) || left.node.localeCompare(right.node));
  for (const item of ranked.slice(0, Math.floor(maximum / 2))) selected.set(item.node, { id: item.node });
  const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const slots = Math.ceil(maximum / 2);
  for (let index = 0; index < slots; index += 1) {
    const position = Math.round(index * (ordered.length - 1) / Math.max(1, slots - 1));
    selected.set(ordered[position].id, { id: ordered[position].id });
  }
  for (const node of ordered) {
    if (selected.size >= maximum) break;
    selected.set(node.id, { id: node.id });
  }
  return [...selected.values()].slice(0, maximum);
}

function moduleName(file) {
  const directory = path.posix.dirname(file);
  if (directory === ".") return ".";
  const parts = directory.split("/");
  return ["src", "lib", "app", "packages", "services"].includes(parts[0]) && parts[1] ? `${parts[0]}/${parts[1]}` : parts[0];
}

function pathMatches(file, prefix) {
  const normalized = String(prefix ?? "").replaceAll("\\", "/").replace(/\*\*?$/, "").replace(/\/$/, "");
  return Boolean(normalized) && (file === normalized || file.startsWith(`${normalized}/`));
}

function boundaryFindings(edges, boundaries = []) {
  const findings = [];
  for (const boundary of boundaries) {
    if (!boundary?.name || !boundary?.from) throw new Error("pulse boundary requires name and from");
    for (const edge of edges.filter((candidate) => pathMatches(candidate.from, boundary.from))) {
      const denied = (boundary.deny ?? []).some((prefix) => pathMatches(edge.to, prefix));
      const outsideAllow = boundary.allow?.length && !boundary.allow.some((prefix) => pathMatches(edge.to, prefix)) && !pathMatches(edge.to, boundary.from);
      if (denied || outsideAllow) findings.push({ boundary: boundary.name, from: edge.from, to: edge.to, line: edge.line, reason: denied ? "explicitly_denied" : "outside_allow_list" });
    }
  }
  return findings.sort((left, right) => `${left.boundary}:${left.from}:${left.to}`.localeCompare(`${right.boundary}:${right.from}:${right.to}`));
}

export function buildPulseGraph(scan, extraction) {
  const nodes = scan.inventory.entries.map((entry) => ({ id: entry.path, path: entry.path, language: entry.language, module: moduleName(entry.path), bytes: entry.bytes, content_hash: entry.content_hash })).sort((left, right) => left.id.localeCompare(right.id));
  const edges = extraction.edges.map((edge) => ({ ...edge })).sort((left, right) => `${left.from}:${left.to}:${left.kind}`.localeCompare(`${right.from}:${right.to}:${right.kind}`));
  const graph = adjacency(nodes, edges);
  const dependents = reverseAdjacency(nodes, edges);
  const components = stronglyConnectedComponents(graph);
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from));
  const cycles = components.filter((component) => component.length > 1 || selfLoops.has(component[0]));
  const condensation = condensationDepth(graph, components);
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const degrees = nodes.map((node) => ({ node: node.id, fan_in: incoming.get(node.id) ?? 0, fan_out: graph.get(node.id)?.size ?? 0 }));
  const totalDegree = degrees.reduce((sum, item) => sum + item.fan_in + item.fan_out, 0);
  const hotspotCount = Math.max(1, Math.ceil(nodes.length * 0.1));
  const hotspots = [...degrees].sort((left, right) => (right.fan_in + right.fan_out) - (left.fan_in + left.fan_out) || left.node.localeCompare(right.node)).slice(0, hotspotCount);
  const hotspotConcentration = totalDegree ? hotspots.reduce((sum, item) => sum + item.fan_in + item.fan_out, 0) / totalDegree : 0;
  const blastCandidates = boundedBlastSample(nodes, degrees);
  const blast = blastCandidates.map((node) => ({ node: node.id, reachable_dependents: descendants(dependents, node.id) })).sort((left, right) => right.reachable_dependents - left.reachable_dependents || left.node.localeCompare(right.node));
  const modules = new Map();
  for (const node of nodes) modules.set(node.module, { nodes: (modules.get(node.module)?.nodes ?? 0) + 1, internal: modules.get(node.module)?.internal ?? 0, outgoing: modules.get(node.module)?.outgoing ?? 0 });
  for (const edge of edges) {
    const sourceModule = moduleName(edge.from); const targetModule = moduleName(edge.to); const state = modules.get(sourceModule);
    if (sourceModule === targetModule) state.internal += 1; else state.outgoing += 1;
  }
  const cohesionByModule = [...modules].map(([module, value]) => ({ module, nodes: value.nodes, cohesion: value.internal + value.outgoing ? finiteMetric(value.internal / (value.internal + value.outgoing), "module cohesion") : 1 })).sort((left, right) => left.module.localeCompare(right.module));
  const averageCohesion = cohesionByModule.length ? cohesionByModule.reduce((sum, item) => sum + item.cohesion, 0) / cohesionByModule.length : 1;
  const boundaries = boundaryFindings(edges, scan.config.boundaries ?? []);
  const resolved = extraction.counts.resolved_internal;
  const importTotal = extraction.counts.imports_total;
  const resolutionCoverage = importTotal ? resolved / importTotal : 1;
  const parseCoverage = nodes.length ? (nodes.length - extraction.counts.failures) / nodes.length : 0;
  const coverageScore = 0.45 * scan.inventory.file_coverage + 0.35 * resolutionCoverage + 0.2 * parseCoverage;
  const confidence = Math.max(0, Math.min(1, coverageScore));
  const pulseIndex = Math.max(0, 100 - cycles.length * 8 - boundaries.length * 5 - condensation.depth * 0.5 - hotspotConcentration * 10 - (1 - averageCohesion) * 20);
  const metrics = {
    node_count: nodes.length,
    edge_count: edges.length,
    cycle_count: cycles.length,
    cyclic_node_count: new Set(cycles.flat()).size,
    condensation_depth: condensation.depth,
    condensation_root_count: condensation.roots,
    average_module_cohesion: finiteMetric(averageCohesion, "average module cohesion"),
    boundary_violation_count: boundaries.length,
    hotspot_concentration: finiteMetric(hotspotConcentration, "hotspot concentration"),
    maximum_blast_radius: blast[0]?.reachable_dependents ?? 0,
    average_blast_radius: blast.length ? finiteMetric(blast.reduce((sum, item) => sum + item.reachable_dependents, 0) / blast.length, "average blast radius") : 0,
    blast_radius_sample_size: blast.length,
    blast_radius_complete: blast.length === nodes.length,
    pulse_index: finiteMetric(pulseIndex, "diagnostic pulse index")
  };
  return {
    graph: { nodes, edges, unresolved: extraction.unresolved, extraction_failures: extraction.failures },
    findings: { cycles, boundaries, hotspots, blast_radius: blast.slice(0, 20), cohesion_by_module: cohesionByModule },
    metrics,
    coverage: {
      files: scan.inventory.file_coverage,
      imports: finiteMetric(resolutionCoverage, "import resolution coverage"),
      parse: finiteMetric(parseCoverage, "parse coverage"),
      analyzed_files: nodes.length,
      discovered_files: scan.inventory.counts.discovered,
      unresolved_imports: extraction.counts.unresolved,
      unsupported_files: scan.inventory.counts.exclusion_reasons.unsupported_language ?? 0
    },
    confidence: { score: finiteMetric(confidence, "confidence"), band: confidenceBand(confidence), inputs: { file_coverage: scan.inventory.file_coverage, resolution_coverage: finiteMetric(resolutionCoverage, "resolution coverage"), parse_coverage: finiteMetric(parseCoverage, "parse coverage") } },
    metric_version: PULSE_METRIC_VERSION
  };
}
