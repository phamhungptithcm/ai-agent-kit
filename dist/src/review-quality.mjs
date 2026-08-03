import fs from "node:fs";
import { wilson } from "./eval-harness.mjs";

function load(value) {
  if (typeof value === "string") {
    const stat = fs.lstatSync(value);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("review fixture must be a bounded regular file");
  }
  const data = typeof value === "string" ? JSON.parse(fs.readFileSync(value, "utf8")) : value;
  if (data?.schema_version !== 1 || !Array.isArray(data.reviews)) throw new Error("invalid review-quality fixture");
  return data;
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null, confidence_interval_95: wilson(numerator, denominator) };
}

function consensus(labels, key) {
  const values = labels.map((label) => label[key]).filter((value) => value != null);
  const distribution = Object.fromEntries([...new Set(values)].sort().map((value) => [String(value), values.filter((item) => item === value).length]));
  const sorted = Object.entries(distribution).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const agreed = sorted.length === 1 || (sorted[0]?.[1] ?? 0) > values.length / 2;
  return { value: agreed ? sorted[0]?.[0] ?? null : null, distribution, reviewer_count: values.length, disagreement: !agreed && values.length > 0 };
}

export function scoreReviewQuality(input) {
  const fixture = load(input.fixture ?? input);
  const findings = fixture.reviews.flatMap((review) => review.findings.map((finding) => ({ ...finding, review_id: review.id, latency_ms: review.latency_ms })));
  const judged = findings.map((finding) => ({
    finding,
    valid: consensus(finding.human_labels ?? [], "valid"),
    severity: consensus(finding.human_labels ?? [], "severity"),
    actionable: consensus(finding.human_labels ?? [], "actionable"),
    accepted: consensus(finding.human_labels ?? [], "accepted_fix")
  }));
  const validityKnown = judged.filter((item) => item.valid.value != null);
  const valid = validityKnown.filter((item) => item.valid.value === "true");
  const duplicates = findings.filter((finding) => finding.duplicate_of).length;
  const noise = validityKnown.filter((item) => item.valid.value === "false").length + duplicates;
  const severityKnown = valid.filter((item) => item.severity.value != null);
  const severityCorrect = severityKnown.filter((item) => item.severity.value === String(item.finding.severity)).length;
  const actionableKnown = valid.filter((item) => item.actionable.value != null);
  const actionable = actionableKnown.filter((item) => item.actionable.value === "true").length;
  const acceptedKnown = valid.filter((item) => item.accepted.value != null);
  const accepted = acceptedKnown.filter((item) => item.accepted.value === "true").length;
  const escaped = fixture.reviews.reduce((sum, review) => sum + Number(review.escaped_defects ?? 0), 0);
  const opportunities = fixture.reviews.reduce((sum, review) => sum + Number(review.known_defects ?? 0), 0);
  const accuracy = ratio(valid.length, validityKnown.length);
  const noiseRate = ratio(noise, findings.length + duplicates);
  const metrics = {
    finding_accuracy: accuracy,
    severity_calibration: ratio(severityCorrect, severityKnown.length),
    duplicate_or_noise_rate: noiseRate,
    actionable_rate: ratio(actionable, actionableKnown.length),
    accepted_fix_rate: ratio(accepted, acceptedKnown.length),
    escaped_defect_rate: ratio(escaped, opportunities),
    review_latency_ms: { sample_size: fixture.reviews.length, mean: fixture.reviews.length ? fixture.reviews.reduce((sum, review) => sum + Number(review.latency_ms ?? 0), 0) / fixture.reviews.length : null }
  };
  const qualityScore = accuracy.value == null ? null : accuracy.value * (1 - (noiseRate.value ?? 0)) * (metrics.severity_calibration.value ?? 1);
  return {
    schema_version: 1,
    fixture_id: fixture.id,
    sample_size: findings.length,
    quality_score: qualityScore,
    metrics,
    human_disagreement: judged.filter((item) => item.valid.disagreement || item.severity.disagreement || item.actionable.disagreement).map((item) => ({ finding_id: item.finding.id, valid: item.valid.distribution, severity: item.severity.distribution, actionable: item.actionable.distribution }))
  };
}

export function compareReviewQuality(options) {
  const baseline = scoreReviewQuality({ fixture: options.baseline });
  const candidate = scoreReviewQuality({ fixture: options.candidate });
  const threshold = Number(options.materialThreshold ?? 0.05);
  const delta = candidate.quality_score == null || baseline.quality_score == null ? null : candidate.quality_score - baseline.quality_score;
  return { schema_version: 1, status: delta != null && delta < -threshold ? "REGRESSION" : "PASSED", threshold, delta, baseline, candidate };
}
