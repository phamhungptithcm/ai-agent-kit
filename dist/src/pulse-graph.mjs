import path from "node:path";
import { PULSE_GRAPH_VERSION, PULSE_METRIC_VERSION, confidenceBand, finiteMetric, pulseDigest, pulseFingerprint } from "./pulse-contract.mjs";

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
    const sourceId = componentByNode.get(from);
    const targetId = componentByNode.get(to);
    if (sourceId !== targetId && !dag.get(sourceId).has(targetId)) {
      dag.get(sourceId).add(targetId);
      indegree.set(targetId, indegree.get(targetId) + 1);
    }
  }
  const queue = [...indegree].filter(([, value]) => value === 0).map(([id]) => id).sort((a, b) => a - b);
  const rootCount = queue.length;
  const depth = new Map(components.map((_, id) => [id, 0]));
  let cursor = 0;
  while (cursor < queue.length) {
    const source = queue[cursor++];
    for (const target of [...dag.get(source)].sort((a, b) => a - b)) {
      depth.set(target, Math.max(depth.get(target), depth.get(source) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  let maximumDepth = 0;
  for (const value of depth.values()) maximumDepth = Math.max(maximumDepth, value);
  return { depth: maximumDepth, roots: rootCount };
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

function pathMatches(file, prefix) {
  const normalized = String(prefix ?? "").replaceAll("\\", "/").replace(/\*\*?$/, "").replace(/\/$/, "");
  return Boolean(normalized) && (file === normalized || file.startsWith(`${normalized}/`));
}

function inferredManifestComponents(scan) {
  const directories = scan.inventory.entries
    .filter((entry) => entry.role === "manifest" && ["javascript-manifest", "python-manifest", "go-manifest", "rust-manifest", "maven-manifest", "gradle-manifest", "msbuild-manifest"].includes(entry.language))
    .map((entry) => path.posix.dirname(entry.path) === "." ? "" : path.posix.dirname(entry.path))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  return [...new Set(directories)];
}

function componentName(file, scan) {
  for (const component of scan.config.components ?? []) if (component.paths.some((prefix) => pathMatches(file, prefix))) return component.id;
  const inferred = inferredManifestComponents(scan).find((directory) => !directory || file.startsWith(`${directory}/`) || file === directory);
  if (inferred != null) return inferred || ".";
  const directory = path.posix.dirname(file);
  if (directory === ".") return ".";
  const parts = directory.split("/");
  return ["src", "lib", "app", "apps", "packages", "services"].includes(parts[0]) && parts[1] ? `${parts[0]}/${parts[1]}` : parts[0];
}

function moduleName(file) {
  const directory = path.posix.dirname(file);
  if (directory === ".") return ".";
  const parts = directory.split("/");
  return parts.length > 1 ? parts.slice(0, 2).join("/") : parts[0];
}

function edgeLookup(edges) {
  const lookup = new Map();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const list = lookup.get(key) ?? [];
    list.push(edge);
    lookup.set(key, list.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)));
  }
  return lookup;
}

function cycleWitness(component, graph, edgeByPair) {
  const allowed = new Set(component);
  const start = component[0];
  if (component.length === 1) {
    const edge = edgeByPair.get(`${start}\0${start}`)?.[0];
    return edge ? [{ from: start, to: start, line: edge.line, fingerprint: edge.fingerprint }] : [];
  }
  const queue = [[start, [start]]];
  const visited = new Set([start]);
  while (queue.length) {
    const [current, pathNodes] = queue.shift();
    for (const target of [...(graph.get(current) ?? [])].filter((item) => allowed.has(item)).sort()) {
      if (target === start && pathNodes.length > 1) {
        const nodes = [...pathNodes, start];
        return nodes.slice(0, -1).map((from, index) => {
          const to = nodes[index + 1];
          const edge = edgeByPair.get(`${from}\0${to}`)?.[0];
          return { from, to, line: edge?.line ?? null, fingerprint: edge?.fingerprint ?? null };
        });
      }
      if (!visited.has(target)) {
        visited.add(target);
        queue.push([target, [...pathNodes, target]]);
      }
    }
  }
  return [];
}

function cycleFindings(cycles, graph, edges) {
  const edgeByPair = edgeLookup(edges);
  const internalBySource = new Map();
  for (const edge of edges) {
    const values = internalBySource.get(edge.from) ?? [];
    values.push(edge);
    internalBySource.set(edge.from, values);
  }
  return cycles.map((nodes) => {
    const identity = { nodes: [...nodes].sort() };
    const member = new Set(nodes);
    return {
      type: "cycle",
      fingerprint: pulseFingerprint("cycle", identity),
      identity,
      title: `Dependency cycle across ${nodes.length} file(s)`,
      nodes: identity.nodes,
      witness: cycleWitness(nodes, graph, edgeByPair),
      evidence_tier: nodes.reduce((tier, node) => {
        const candidates = (internalBySource.get(node) ?? []).filter((edge) => member.has(edge.to));
        return candidates.some((edge) => edge.evidence_tier === "SOURCE_FALLBACK") ? "SOURCE_FALLBACK" : tier;
      }, "RESOLVER_VERIFIED")
    };
  }).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function boundaryFindings(edges, boundaries = []) {
  const findings = [];
  for (const boundary of boundaries) {
    for (const edge of edges.filter((candidate) => pathMatches(candidate.from, boundary.from))) {
      const denied = (boundary.deny ?? []).some((prefix) => pathMatches(edge.to, prefix));
      const outsideAllow = boundary.allow?.length && !boundary.allow.some((prefix) => pathMatches(edge.to, prefix)) && !pathMatches(edge.to, boundary.from);
      if (!denied && !outsideAllow) continue;
      const reason = denied ? "explicitly_denied" : "outside_allow_list";
      const identity = { boundary: boundary.name, from: edge.from, to: edge.to, reason };
      findings.push({
        type: "boundary",
        fingerprint: pulseFingerprint("boundary", identity),
        identity,
        title: `Boundary ${boundary.name} is violated`,
        ...identity,
        line: edge.line,
        edge_fingerprint: edge.fingerprint,
        owner: boundary.owner ?? null,
        evidence_tier: edge.evidence_tier
      });
    }
  }
  return findings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function layerFindings(edges, layers = []) {
  const layerFor = (file) => layers.find((layer) => layer.paths.some((prefix) => pathMatches(file, prefix))) ?? null;
  const findings = [];
  for (const edge of edges) {
    const fromLayer = layerFor(edge.from);
    const toLayer = layerFor(edge.to);
    if (!fromLayer || !toLayer || fromLayer.id === toLayer.id || fromLayer.order >= toLayer.order) continue;
    const identity = { from_layer: fromLayer.id, to_layer: toLayer.id, from: edge.from, to: edge.to };
    findings.push({
      type: "layer-order",
      fingerprint: pulseFingerprint("layer-order", identity),
      identity,
      title: `Layer ${fromLayer.id} must not depend on ${toLayer.id}`,
      line: edge.line,
      edge_fingerprint: edge.fingerprint,
      evidence_tier: edge.evidence_tier
    });
  }
  return findings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function publicApiFindings(nodes, edges, scan) {
  const components = scan.config.components ?? [];
  const componentFor = (file) => components.find((component) => component.paths.some((prefix) => pathMatches(file, prefix))) ?? null;
  const findings = [];
  for (const edge of edges) {
    const source = componentFor(edge.from);
    const target = componentFor(edge.to);
    const sourceName = source?.id ?? componentName(edge.from, scan);
    const targetName = target?.id ?? componentName(edge.to, scan);
    const publicPaths = target?.public_api?.length ? target.public_api : scan.config.public_apis ?? [];
    if (sourceName === targetName || !publicPaths.length || publicPaths.some((prefix) => pathMatches(edge.to, prefix))) continue;
    const identity = { component: targetName, from: edge.from, to: edge.to };
    findings.push({
      type: "public-api",
      fingerprint: pulseFingerprint("public-api", identity),
      identity,
      title: `Dependency bypasses the public API of ${targetName}`,
      line: edge.line,
      edge_fingerprint: edge.fingerprint,
      evidence_tier: edge.evidence_tier
    });
  }
  return findings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

export function buildPulseGraph(scan, extraction) {
  const nodes = scan.inventory.entries.filter((entry) => entry.role === "source" || entry.role == null).map((entry) => ({
    id: entry.path,
    path: entry.path,
    language: entry.language,
    module: moduleName(entry.path),
    component: componentName(entry.path, scan),
    bytes: entry.bytes,
    content_hash: entry.content_hash
  })).sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = extraction.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)).map((edge) => ({
    ...edge,
    edge_type: edge.edge_type ?? (edge.kind === "dynamic-import" ? "dynamic-import" : "source-import"),
    evidence_tier: edge.evidence_tier ?? "SOURCE_FALLBACK",
    fingerprint: edge.fingerprint ?? pulseFingerprint("edge", { from: edge.from, to: edge.to, edge_type: edge.edge_type ?? "source-import", kind: edge.kind, specifier: edge.specifier }),
    from_component: componentName(edge.from, scan),
    to_component: componentName(edge.to, scan)
  })).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const graph = adjacency(nodes, edges);
  const dependents = reverseAdjacency(nodes, edges);
  const components = stronglyConnectedComponents(graph);
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from));
  const cyclicComponents = components.filter((component) => component.length > 1 || selfLoops.has(component[0]));
  const cycles = cycleFindings(cyclicComponents, graph, edges);
  const condensation = condensationDepth(graph, components);
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const degrees = nodes.map((node) => ({ node: node.id, fan_in: incoming.get(node.id) ?? 0, fan_out: graph.get(node.id)?.size ?? 0 }));
  const totalDegree = degrees.reduce((sum, item) => sum + item.fan_in + item.fan_out, 0);
  const hotspotCount = Math.max(1, Math.ceil(nodes.length * 0.1));
  const hotspots = [...degrees].sort((left, right) => (right.fan_in + right.fan_out) - (left.fan_in + left.fan_out) || left.node.localeCompare(right.node)).slice(0, hotspotCount);
  const hotspotConcentration = totalDegree ? hotspots.reduce((sum, item) => sum + item.fan_in + item.fan_out, 0) / totalDegree : 0;
  const blastCandidates = boundedBlastSample(nodes, degrees);
  const blast = blastCandidates.map((node) => ({ node: node.id, component: componentName(node.id, scan), reachable_dependents: descendants(dependents, node.id) })).sort((left, right) => right.reachable_dependents - left.reachable_dependents || left.node.localeCompare(right.node));
  const moduleState = new Map();
  for (const node of nodes) moduleState.set(node.module, { nodes: (moduleState.get(node.module)?.nodes ?? 0) + 1, internal: moduleState.get(node.module)?.internal ?? 0, outgoing: moduleState.get(node.module)?.outgoing ?? 0 });
  for (const edge of edges) {
    const sourceModule = moduleName(edge.from);
    const targetModule = moduleName(edge.to);
    const state = moduleState.get(sourceModule);
    if (sourceModule === targetModule) state.internal += 1;
    else state.outgoing += 1;
  }
  const cohesionByModule = [...moduleState].map(([module, value]) => ({
    module,
    nodes: value.nodes,
    edges: value.internal + value.outgoing,
    cohesion: value.internal + value.outgoing ? finiteMetric(value.internal / (value.internal + value.outgoing), "module cohesion") : 1
  })).sort((left, right) => left.module.localeCompare(right.module));
  const cohesionWeight = cohesionByModule.reduce((sum, item) => sum + Math.max(1, item.edges), 0);
  const averageCohesion = cohesionWeight ? cohesionByModule.reduce((sum, item) => sum + item.cohesion * Math.max(1, item.edges), 0) / cohesionWeight : 1;
  const boundaries = boundaryFindings(edges, scan.config.boundaries ?? []);
  const layers = layerFindings(edges, scan.config.layers ?? []);
  const publicApis = publicApiFindings(nodes, edges, scan);
  const findingCatalog = [...cycles, ...boundaries, ...layers, ...publicApis].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const internalCandidates = extraction.counts.resolved_internal + (extraction.counts.unresolved_internal ?? extraction.counts.unresolved ?? 0) + (extraction.counts.ambiguous ?? 0);
  const resolutionCoverage = internalCandidates ? extraction.counts.resolved_internal / internalCandidates : 1;
  const parseCoverage = nodes.length ? (nodes.length - extraction.counts.failures) / nodes.length : 1;
  const supportedScope = scan.inventory.file_coverage;
  const coverageScore = 0.4 * supportedScope + 0.35 * resolutionCoverage + 0.25 * parseCoverage;
  const minimumEvidenceTier = extraction.evidence?.minimum_tier ?? "SOURCE_FALLBACK";
  const tierPenalty = minimumEvidenceTier === "SOURCE_FALLBACK" && edges.length ? 0.12 : 0;
  const confidence = Math.max(0, Math.min(1, coverageScore - tierPenalty));
  const pulseIndex = Math.max(0, 100 - cycles.length * 8 - boundaries.length * 5 - layers.length * 4 - publicApis.length * 3 - condensation.depth * 0.5 - hotspotConcentration * 10 - (1 - averageCohesion) * 20);
  const metrics = {
    node_count: nodes.length,
    edge_count: edges.length,
    cycle_count: cycles.length,
    cyclic_node_count: new Set(cycles.flatMap((finding) => finding.nodes)).size,
    condensation_depth: condensation.depth,
    condensation_root_count: condensation.roots,
    average_module_cohesion: finiteMetric(averageCohesion, "average module cohesion"),
    boundary_violation_count: boundaries.length + layers.length + publicApis.length,
    hotspot_concentration: finiteMetric(hotspotConcentration, "hotspot concentration"),
    maximum_blast_radius: blast[0]?.reachable_dependents ?? 0,
    average_blast_radius: blast.length ? finiteMetric(blast.reduce((sum, item) => sum + item.reachable_dependents, 0) / blast.length, "average blast radius") : 0,
    blast_radius_sample_size: blast.length,
    blast_radius_complete: blast.length === nodes.length,
    pulse_index: finiteMetric(pulseIndex, "diagnostic pulse index")
  };
  const graphEvidence = { nodes, edges, unresolved: extraction.unresolved, extraction_failures: extraction.failures };
  return {
    graph: { storage: "inline", ...graphEvidence, graph_digest: pulseDigest(graphEvidence), artifacts: [] },
    findings: { cycles, boundaries, layers, public_apis: publicApis, hotspots, blast_radius: blast.slice(0, 20), cohesion_by_module: cohesionByModule },
    finding_catalog: findingCatalog,
    metrics,
    coverage: {
      files: supportedScope,
      supported_scope: supportedScope,
      imports: finiteMetric(resolutionCoverage, "import resolution coverage"),
      parse: finiteMetric(parseCoverage, "parse coverage"),
      analyzed_files: nodes.length,
      discovered_files: scan.inventory.counts.discovered,
      supported_in_scope: scan.inventory.counts.supported_in_scope ?? nodes.length,
      unsupported_in_scope: scan.inventory.counts.unsupported_in_scope ?? 0,
      excluded_by_policy: scan.inventory.counts.excluded_by_policy ?? 0,
      external_declared: extraction.counts.external_declared ?? 0,
      unresolved_internal: extraction.counts.unresolved_internal ?? extraction.counts.unresolved ?? 0,
      ambiguous: extraction.counts.ambiguous ?? 0,
      parse_failed: extraction.counts.failures
    },
    confidence: {
      score: finiteMetric(confidence, "confidence"),
      band: confidenceBand(confidence),
      minimum_evidence_tier: minimumEvidenceTier,
      inputs: {
        supported_scope: supportedScope,
        internal_resolution: finiteMetric(resolutionCoverage, "resolution coverage"),
        parse_coverage: finiteMetric(parseCoverage, "parse coverage"),
        source_fallback_penalty: tierPenalty
      },
      resolver_provenance: extraction.evidence?.resolvers ?? [],
      unavailable_resolvers: extraction.evidence?.unavailable_resolvers ?? []
    },
    graph_version: PULSE_GRAPH_VERSION,
    metric_version: PULSE_METRIC_VERSION
  };
}
