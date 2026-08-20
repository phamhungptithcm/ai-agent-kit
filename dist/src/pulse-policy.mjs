import { assertPulseStatus, finiteMetric, pulseDigest, safePulseId } from "./pulse-contract.mjs";

const DEFAULT_RULES = [
  { id: "cycles", type: "new-cycles", threshold: 0, severity: "warning" },
  { id: "boundaries", type: "boundary-violations", threshold: 0, severity: "warning" },
  { id: "depth", type: "depth-increase", threshold: 0, severity: "warning" },
  { id: "cohesion", type: "cohesion-loss", threshold: 0, severity: "warning" },
  { id: "hotspots", type: "hotspot-growth", threshold: 0, severity: "warning" },
  { id: "blast-radius", type: "blast-radius-growth", threshold: 0, severity: "warning" },
  { id: "coverage", type: "coverage-drop", threshold: 0.05, severity: "warning" },
  { id: "confidence", type: "confidence-drop", threshold: 0.05, severity: "warning" }
];
const TYPES = new Set([
  ...DEFAULT_RULES.map((rule) => rule.type),
  "forbidden-dependency", "required-dependency", "reachable-dependency", "public-api-only", "layer-order", "no-new-findings"
]);
const SEVERITIES = new Set(["info", "warning", "block"]);
const TIER_RANK = new Map([["SOURCE_FALLBACK", 0], ["AST_VERIFIED", 1], ["RESOLVER_VERIFIED", 2], ["INDEX_VERIFIED", 3], ["EXPLICIT_MANIFEST", 4]]);

function anchor(finding) {
  const identity = finding.identity ?? {};
  if (finding.type === "boundary") return `boundary:${identity.boundary}:${identity.from}`;
  if (finding.type === "layer-order") return `layer:${identity.from_layer}:${identity.from}`;
  if (finding.type === "public-api") return `public-api:${identity.component}:${identity.from}`;
  return null;
}

export function classifyFindingChanges(baseline, current) {
  const previous = new Map((baseline.snapshot.finding_catalog ?? []).map((finding) => [finding.fingerprint, finding]));
  const next = new Map((current.finding_catalog ?? []).map((finding) => [finding.fingerprint, finding]));
  const unchanged = [...next.values()].filter((finding) => previous.has(finding.fingerprint)).map((finding) => ({ ...finding, baseline_state: "unchanged" }));
  const unmatchedPrevious = [...previous.values()].filter((finding) => !next.has(finding.fingerprint));
  const unmatchedCurrent = [...next.values()].filter((finding) => !previous.has(finding.fingerprint));
  const previousByAnchor = new Map();
  for (const finding of unmatchedPrevious) {
    const key = anchor(finding);
    if (!key) continue;
    const list = previousByAnchor.get(key) ?? [];
    list.push(finding);
    previousByAnchor.set(key, list);
  }
  const updated = [];
  const consumedPrevious = new Set();
  const consumedCurrent = new Set();
  for (const finding of unmatchedCurrent) {
    const key = anchor(finding);
    const match = key ? previousByAnchor.get(key)?.find((candidate) => !consumedPrevious.has(candidate.fingerprint)) : null;
    if (!match) continue;
    consumedPrevious.add(match.fingerprint);
    consumedCurrent.add(finding.fingerprint);
    updated.push({ ...finding, baseline_state: "updated", previous_fingerprint: match.fingerprint });
  }
  const added = unmatchedCurrent.filter((finding) => !consumedCurrent.has(finding.fingerprint)).map((finding) => ({ ...finding, baseline_state: "new" }));
  const fixed = unmatchedPrevious.filter((finding) => !consumedPrevious.has(finding.fingerprint)).map((finding) => ({ ...finding, baseline_state: "fixed" }));
  return {
    new: added.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    unchanged: unchanged.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    updated: updated.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    fixed: fixed.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
  };
}

function pathMatches(file, pattern) {
  if (!pattern) return true;
  const normalized = String(pattern).replaceAll("\\", "/").replace(/\*\*?$/, "").replace(/\/$/, "");
  return file === normalized || file.startsWith(`${normalized}/`);
}

function reachable(graph, fromPattern, toPattern) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) if (adjacency.has(edge.from) && adjacency.has(edge.to)) adjacency.get(edge.from).push(edge.to);
  const matches = [];
  for (const start of [...adjacency.keys()].filter((file) => pathMatches(file, fromPattern)).sort()) {
    const queue = [[start, [start]]];
    const visited = new Set([start]);
    while (queue.length) {
      const [current, witness] = queue.shift();
      for (const target of adjacency.get(current) ?? []) {
        if (pathMatches(target, toPattern)) { matches.push({ from: start, to: target, witness: [...witness, target] }); queue.length = 0; break; }
        if (!visited.has(target)) { visited.add(target); queue.push([target, [...witness, target]]); }
      }
    }
  }
  return matches;
}

function normalizedRules(rules) {
  const source = rules?.length ? rules : DEFAULT_RULES;
  return source.map((rule) => {
    const id = safePulseId(rule.id, "pulse rule id");
    if (!TYPES.has(rule.type)) throw new Error(`unsupported pulse rule type: ${rule.type}`);
    const threshold = Number(rule.threshold ?? 0);
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`pulse rule ${id} threshold must be non-negative`);
    const severity = rule.severity ?? "warning";
    if (!SEVERITIES.has(severity)) throw new Error(`pulse rule ${id} severity is invalid`);
    return { ...rule, id, threshold, severity };
  });
}

function verifyWaivers(waivers = [], now = new Date()) {
  const valid = new Map();
  const invalid = [];
  for (const waiver of waivers) {
    const { integrity, ...body } = waiver;
    if (integrity?.algorithm !== "SHA-256" || pulseDigest(body) !== integrity?.digest) {
      invalid.push({ fingerprint: waiver.fingerprint, reason_code: "WAIVER_INVALID", reason: "waiver integrity verification failed" });
      continue;
    }
    if (Date.parse(waiver.expires_at) <= now.getTime()) {
      invalid.push({ fingerprint: waiver.fingerprint, reason_code: "WAIVER_EXPIRED", reason: "waiver has expired" });
      continue;
    }
    if (Date.parse(waiver.created_at) > now.getTime() || Date.parse(waiver.created_at) >= Date.parse(waiver.expires_at)) {
      invalid.push({ fingerprint: waiver.fingerprint, reason_code: "WAIVER_INVALID", reason: "waiver time bounds are invalid" });
      continue;
    }
    valid.set(waiver.fingerprint, { owner: waiver.owner, reason: waiver.reason, issue: waiver.issue ?? null, approved_by: waiver.approved_by, expires_at: waiver.expires_at });
  }
  return { valid, invalid };
}

function aggregateDelta(type, baseline, current) {
  if (type === "depth-increase") return current.metrics.condensation_depth - baseline.snapshot.metrics.condensation_depth;
  if (type === "cohesion-loss") return baseline.snapshot.metrics.average_module_cohesion - current.metrics.average_module_cohesion;
  if (type === "hotspot-growth") return current.metrics.hotspot_concentration - baseline.snapshot.metrics.hotspot_concentration;
  if (type === "blast-radius-growth") return current.metrics.maximum_blast_radius - baseline.snapshot.metrics.maximum_blast_radius;
  if (type === "coverage-drop") return baseline.snapshot.coverage.supported_scope - current.coverage.supported_scope;
  return baseline.snapshot.confidence.score - current.confidence.score;
}

function instancesForRule(rule, changes, current) {
  if (rule.type === "new-cycles") return changes.new.filter((finding) => finding.type === "cycle");
  if (rule.type === "boundary-violations") return changes.new.filter((finding) => ["boundary", "layer-order", "public-api"].includes(finding.type));
  if (rule.type === "no-new-findings") return changes.new;
  if (rule.type === "public-api-only") return current.finding_catalog.filter((finding) => finding.type === "public-api");
  if (rule.type === "layer-order") return current.finding_catalog.filter((finding) => finding.type === "layer-order");
  if (rule.type === "forbidden-dependency") {
    return current.graph.edges.filter((edge) => pathMatches(edge.from, rule.from) && pathMatches(edge.to, rule.to)).map((edge) => ({
      type: "forbidden-dependency",
      fingerprint: edge.fingerprint,
      evidence_tier: edge.evidence_tier,
      title: `Forbidden dependency ${edge.from} -> ${edge.to}`,
      identity: { from: edge.from, to: edge.to },
      witness: [edge.from, edge.to]
    }));
  }
  if (rule.type === "required-dependency") {
    const sources = current.graph.nodes.filter((node) => pathMatches(node.id, rule.from));
    const satisfied = current.graph.edges.some((edge) => pathMatches(edge.from, rule.from) && pathMatches(edge.to, rule.to));
    return sources.length && !satisfied ? [{
      type: "required-dependency",
      fingerprint: `required-dependency:${pulseDigest({ rule: rule.id, from: rule.from, to: rule.to })}`,
      evidence_tier: current.confidence.minimum_evidence_tier,
      title: `Required dependency ${rule.from} -> ${rule.to} is missing`,
      identity: { from: rule.from, to: rule.to }
    }] : [];
  }
  if (rule.type === "reachable-dependency") {
    return reachable(current.graph, rule.from, rule.to).map((match) => ({
      type: "reachable-dependency",
      fingerprint: `reachable-dependency:${pulseDigest({ rule: rule.id, from: match.from, to: match.to })}`,
      evidence_tier: current.confidence.minimum_evidence_tier,
      title: `${match.to} is reachable from ${match.from}`,
      identity: { from: match.from, to: match.to },
      witness: match.witness
    }));
  }
  return [];
}

function sufficientTier(instances, required) {
  const threshold = TIER_RANK.get(required) ?? TIER_RANK.get("RESOLVER_VERIFIED");
  return instances.every((finding) => (TIER_RANK.get(finding.evidence_tier) ?? 0) >= threshold);
}

export function evaluatePulsePolicy({ baseline, current, verification, rules, waivers = [], blockingMinimumTier = "SOURCE_FALLBACK", now }) {
  if (verification.status !== "VERIFIED") {
    return { schema_version: 2, protocol: "aak-architecture-pulse-comparison-v2", status: assertPulseStatus(verification.status), reason_code: verification.reason_code, reason: verification.reason, blocking: false, findings: [], finding_changes: { new: [], unchanged: [], updated: [], fixed: [] }, waivers: { applied: [], invalid: [] } };
  }
  const changes = classifyFindingChanges(baseline, current);
  const waiverState = verifyWaivers(waivers, now ? new Date(now) : new Date());
  const applied = [];
  const ruleResults = normalizedRules(rules).map((rule) => {
    const matched = instancesForRule(rule, changes, current);
    const active = matched.filter((finding) => {
      const waiver = waiverState.valid.get(finding.fingerprint);
      if (!waiver) return true;
      applied.push({ fingerprint: finding.fingerprint, ...waiver });
      return false;
    });
    const identityRule = new Set(["new-cycles", "boundary-violations", "no-new-findings", "forbidden-dependency", "required-dependency", "reachable-dependency", "public-api-only", "layer-order"]).has(rule.type);
    const delta = finiteMetric(identityRule ? active.length : aggregateDelta(rule.type, baseline, current), `${rule.id} delta`);
    const violated = delta > rule.threshold;
    const requiredTier = rule.evidence_tier ?? blockingMinimumTier;
    const evidenceSufficient = !violated || sufficientTier(active, requiredTier);
    return {
      ...rule,
      delta,
      violated,
      blocking: violated && rule.severity === "block" && evidenceSufficient,
      evidence_sufficient: evidenceSufficient,
      required_evidence_tier: requiredTier,
      matched_fingerprints: active.map((finding) => finding.fingerprint).sort(),
      witnesses: active.flatMap((finding) => finding.witness ? [{ fingerprint: finding.fingerprint, path: finding.witness }] : [])
    };
  });
  const violated = ruleResults.filter((finding) => finding.violated);
  const insufficientBlocking = violated.some((finding) => finding.severity === "block" && !finding.evidence_sufficient);
  const improvements = ruleResults.filter((finding) => finding.delta < -finding.threshold);
  const waiverFailure = waiverState.invalid.length > 0;
  const status = waiverFailure ? "REGRESSED" : insufficientBlocking ? "DEGRADED" : violated.length ? "REGRESSED" : improvements.length || changes.fixed.length ? "IMPROVED" : "STABLE";
  const reasonCode = waiverFailure ? waiverState.invalid[0].reason_code : insufficientBlocking ? "LOW_CONFIDENCE" : violated.length ? "RULE_REGRESSION" : improvements.length || changes.fixed.length ? "NO_RULE_REGRESSION" : "NO_COMPARABLE_CHANGE";
  const reason = waiverFailure
    ? `${waiverState.invalid.length} waiver(s) failed closed`
    : insufficientBlocking
      ? "a blocking rule matched evidence below its approved precision tier"
      : violated.length
        ? `${violated.length} configured structural rule(s) regressed`
        : improvements.length || changes.fixed.length
          ? `${changes.fixed.length} finding(s) fixed with no configured regression`
          : "no configured structural rule changed materially";
  return {
    schema_version: 2,
    protocol: "aak-architecture-pulse-comparison-v2",
    status: assertPulseStatus(status),
    reason_code: reasonCode,
    reason,
    blocking: waiverFailure || ruleResults.some((finding) => finding.blocking),
    baseline_digest: verification.baseline_digest,
    current_result_digest: current.result_digest,
    policy_drift: Boolean(verification.policy_drift),
    findings: ruleResults,
    finding_changes: changes,
    waivers: { applied: [...new Map(applied.map((item) => [item.fingerprint, item])).values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)), invalid: waiverState.invalid }
  };
}

export function pulseExitCode(result) {
  if (["STALE", "UNTRUSTED", "DEGRADED"].includes(result.status)) return 3;
  if (result.blocking) return 2;
  return 0;
}
