import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function readBoundedJson(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) {
    throw new Error(`${label} must be a bounded regular JSON file`);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function assertStringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) throw new Error(`${field} must be a non-empty string array`);
  for (const [index, item] of value.entries()) assertString(item, `${field}[${index}]`);
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesLiteral(text, literal) {
  const haystack = normalize(text);
  const needle = normalize(literal);
  if (!needle) return false;
  if (CJK_PATTERN.test(needle)) return haystack.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(needle)}(?=$|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

function validateThreshold(value, field, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  if (value == null) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}`);
  }
}

function assertSafeSkillPath(skill, field) {
  assertString(skill, field);
  if (path.isAbsolute(skill) || skill.replaceAll("\\", "/").split("/").includes("..")) {
    throw new Error(`${field} must stay inside the configured skills root`);
  }
  if (!skill.replaceAll("\\", "/").endsWith("/SKILL.md") && skill !== "SKILL.md") {
    throw new Error(`${field} must point to a SKILL.md file`);
  }
}

function validateRule(rule, field) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error(`${field} must be an object`);
  const hasAny = rule.any != null;
  const hasAll = rule.all != null;
  if (!hasAny && !hasAll) throw new Error(`${field} requires any or all literals`);
  if (hasAny) assertStringArray(rule.any, `${field}.any`);
  if (hasAll) assertStringArray(rule.all, `${field}.all`);
  if (rule.exclude != null) assertStringArray(rule.exclude, `${field}.exclude`);
  validateThreshold(rule.weight, `${field}.weight`, { minimum: 1, maximum: 100 });
}

function assertSkillFile(skillsRoot, skill, field) {
  const root = path.resolve(skillsRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("skills root must be a real directory");
  let current = root;
  for (const segment of skill.replaceAll("\\", "/").split("/")) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${field} must not traverse symbolic links`);
  }
  if (!fs.lstatSync(current).isFile()) throw new Error(`${field} does not reference a regular file`);
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(current));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${field} escapes the skills root`);
}

export function loadSkillRoutingConfig(file) {
  return readBoundedJson(file, "skill routing config");
}

export function loadSkillRoutingFixture(file) {
  return readBoundedJson(file, "skill routing fixture");
}

export function validateSkillRoutingConfig(config, options = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("skill routing config must be an object");
  if (config.schema_version !== 1) throw new Error("skill routing config requires schema_version 1");
  assertString(config.id, "config.id");
  if (!config.routes || typeof config.routes !== "object" || Array.isArray(config.routes)) throw new Error("config.routes must be an object");
  const routeIds = Object.keys(config.routes);
  if (!routeIds.length) throw new Error("config.routes requires at least one route");
  assertStringArray(config.priority, "config.priority");
  if (new Set(config.priority).size !== config.priority.length) throw new Error("config.priority must not contain duplicates");
  const missing = routeIds.filter((id) => !config.priority.includes(id));
  const unknown = config.priority.filter((id) => !routeIds.includes(id));
  if (missing.length || unknown.length) throw new Error(`config.priority must cover routes exactly; missing=${missing.join(",") || "none"} unknown=${unknown.join(",") || "none"}`);
  if (config.fallback_route != null && !routeIds.includes(config.fallback_route)) throw new Error("config.fallback_route must reference a known route");
  validateThreshold(config.thresholds?.minimum_score, "config.thresholds.minimum_score", { minimum: 1, maximum: 10000 });
  validateThreshold(config.thresholds?.minimum_margin, "config.thresholds.minimum_margin", { minimum: 0, maximum: 10000 });
  const skillPaths = new Set();
  for (const routeId of routeIds) {
    assertString(routeId, "route id");
    const route = config.routes[routeId];
    if (!route || typeof route !== "object" || Array.isArray(route)) throw new Error(`config.routes.${routeId} must be an object`);
    assertString(route.label, `config.routes.${routeId}.label`);
    assertSafeSkillPath(route.skill, `config.routes.${routeId}.skill`);
    if (skillPaths.has(route.skill)) throw new Error(`multiple routes reference the same skill: ${route.skill}`);
    skillPaths.add(route.skill);
    if (!Array.isArray(route.rules) || !route.rules.length) throw new Error(`config.routes.${routeId}.rules requires at least one rule`);
    route.rules.forEach((rule, index) => validateRule(rule, `config.routes.${routeId}.rules[${index}]`));
    if (options.skillsRoot) assertSkillFile(options.skillsRoot, route.skill, `config.routes.${routeId}.skill`);
  }
  return {
    schema_version: 1,
    config_id: config.id,
    config_hash: hash(config),
    status: "VALID",
    route_count: routeIds.length,
    checked_skill_files: Boolean(options.skillsRoot)
  };
}

function matchRule(hint, rule, index) {
  const matchedAny = (rule.any ?? []).filter((literal) => includesLiteral(hint, literal));
  const matchedAll = (rule.all ?? []).filter((literal) => includesLiteral(hint, literal));
  const matchedExclude = (rule.exclude ?? []).filter((literal) => includesLiteral(hint, literal));
  const anyPasses = rule.any == null || matchedAny.length > 0;
  const allPasses = rule.all == null || matchedAll.length === rule.all.length;
  if (!anyPasses || !allPasses || matchedExclude.length) return null;
  return {
    rule_index: index,
    weight: Number(rule.weight ?? 1),
    matched_any: matchedAny,
    matched_all: matchedAll
  };
}

export function routeSkill({ config, hint }) {
  validateSkillRoutingConfig(config);
  assertString(hint, "hint");
  const priorityIndex = new Map(config.priority.map((routeId, index) => [routeId, index]));
  const candidates = [];
  for (const routeId of config.priority) {
    const route = config.routes[routeId];
    const evidence = route.rules.map((rule, index) => matchRule(hint, rule, index)).filter(Boolean);
    const score = evidence.reduce((total, item) => total + item.weight, 0);
    if (score > 0) candidates.push({ route_id: routeId, label: route.label, skill: route.skill, score, evidence });
  }
  candidates.sort((left, right) => right.score - left.score || priorityIndex.get(left.route_id) - priorityIndex.get(right.route_id));
  const first = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const minimumScore = Number(config.thresholds?.minimum_score ?? 1);
  const minimumMargin = Number(config.thresholds?.minimum_margin ?? 1);
  const margin = first ? first.score - (second?.score ?? 0) : 0;
  let reason = null;
  if (!first) reason = "NO_MATCH";
  else if (first.score < minimumScore) reason = "LOW_SCORE";
  else if (second && margin < minimumMargin) reason = "AMBIGUOUS";
  const routed = reason == null;
  const suggestedRoute = first?.route_id ?? config.fallback_route ?? null;
  return {
    schema_version: 1,
    config_id: config.id,
    config_hash: hash(config),
    status: routed ? "ROUTED" : "ABSTAIN",
    reason,
    primary: routed ? first.route_id : null,
    primary_skill: routed ? first.skill : null,
    suggested_route: routed ? null : suggestedRoute,
    confidence: !routed ? "low" : margin >= 3 && first.score >= minimumScore + 2 ? "high" : "medium",
    score: first?.score ?? 0,
    margin,
    candidates
  };
}

function validateFixture(fixture, routeIds) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("skill routing fixture must be an object");
  if (fixture.schema_version !== 1) throw new Error("skill routing fixture requires schema_version 1");
  assertString(fixture.id, "fixture.id");
  if (!Array.isArray(fixture.cases) || !fixture.cases.length) throw new Error("fixture.cases requires at least one case");
  validateThreshold(fixture.thresholds?.minimum_accuracy, "fixture.thresholds.minimum_accuracy", { minimum: 0, maximum: 1 });
  validateThreshold(fixture.thresholds?.minimum_coverage, "fixture.thresholds.minimum_coverage", { minimum: 0, maximum: 1 });
  validateThreshold(fixture.thresholds?.maximum_false_positive_rate, "fixture.thresholds.maximum_false_positive_rate", { minimum: 0, maximum: 1 });
  const caseIds = new Set();
  for (const [index, item] of fixture.cases.entries()) {
    const field = `fixture.cases[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${field} must be an object`);
    assertString(item.id, `${field}.id`);
    if (caseIds.has(item.id)) throw new Error(`fixture case id must be unique: ${item.id}`);
    caseIds.add(item.id);
    assertString(item.hint, `${field}.hint`);
    if (item.expect !== null && !routeIds.includes(item.expect)) throw new Error(`${field}.expect must be null or a known route`);
  }
}

export function evaluateSkillRouting({ config, fixture, skillsRoot }) {
  validateSkillRoutingConfig(config, { skillsRoot });
  const routeIds = Object.keys(config.routes);
  validateFixture(fixture, routeIds);
  const cases = fixture.cases.map((item) => {
    const result = routeSkill({ config, hint: item.hint });
    const actual = result.status === "ROUTED" ? result.primary : null;
    return {
      id: item.id,
      expected: item.expect,
      actual,
      status: actual === item.expect ? "PASSED" : "FAILED",
      routing_status: result.status,
      reason: result.reason,
      score: result.score,
      margin: result.margin
    };
  });
  const positives = cases.filter((item) => item.expected !== null);
  const negatives = cases.filter((item) => item.expected === null);
  const passed = cases.filter((item) => item.status === "PASSED").length;
  const covered = positives.filter((item) => item.actual !== null).length;
  const falsePositives = negatives.filter((item) => item.actual !== null).length;
  const accuracy = passed / cases.length;
  const coverage = positives.length ? covered / positives.length : 1;
  const falsePositiveRate = negatives.length ? falsePositives / negatives.length : 0;
  const thresholds = {
    minimum_accuracy: Number(fixture.thresholds?.minimum_accuracy ?? 1),
    minimum_coverage: Number(fixture.thresholds?.minimum_coverage ?? 1),
    maximum_false_positive_rate: Number(fixture.thresholds?.maximum_false_positive_rate ?? 0)
  };
  const perRoute = Object.fromEntries(routeIds.map((routeId) => {
    const expected = cases.filter((item) => item.expected === routeId);
    const correct = expected.filter((item) => item.actual === routeId).length;
    return [routeId, { expected: expected.length, correct, recall: expected.length ? correct / expected.length : null }];
  }));
  const status = accuracy >= thresholds.minimum_accuracy && coverage >= thresholds.minimum_coverage && falsePositiveRate <= thresholds.maximum_false_positive_rate ? "PASSED" : "FAILED";
  return {
    schema_version: 1,
    fixture_id: fixture.id,
    fixture_hash: hash(fixture),
    config_id: config.id,
    config_hash: hash(config),
    status,
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      accuracy,
      coverage,
      false_positive_rate: falsePositiveRate
    },
    thresholds,
    per_route: perRoute,
    failures: cases.filter((item) => item.status === "FAILED")
  };
}

export function verifySkillRouting({ config, fixture = null, skillsRoot }) {
  try {
    const coherence = validateSkillRoutingConfig(config, { skillsRoot });
    const evaluation = fixture ? evaluateSkillRouting({ config, fixture, skillsRoot }) : null;
    return {
      schema_version: 1,
      status: evaluation?.status === "FAILED" ? "FAILED" : "PASSED",
      coherence,
      evaluation
    };
  } catch (error) {
    return {
      schema_version: 1,
      status: "FAILED",
      coherence: null,
      evaluation: null,
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
