import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main, parseSkillRoutingArgs } from "../src/cli.mjs";
import {
  evaluateSkillRouting,
  loadSkillRoutingConfig,
  routeSkill,
  validateSkillRoutingConfig,
  verifySkillRouting
} from "../src/skill-routing.mjs";

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-skill-routing-"));
  const skillsRoot = path.join(root, "skills");
  for (const name of ["fix-bug", "review-pr"]) {
    const directory = path.join(skillsRoot, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\n`);
  }
  const config = {
    schema_version: 1,
    id: "engineering-router-v1",
    fallback_route: "review-pr",
    thresholds: { minimum_score: 2, minimum_margin: 1 },
    priority: ["fix-bug", "review-pr"],
    routes: {
      "fix-bug": {
        label: "Fix a defect",
        skill: "fix-bug/SKILL.md",
        rules: [
          { any: ["bug", "defect", "sửa lỗi"], weight: 2 },
          { all: ["fix", "test"], weight: 2 }
        ]
      },
      "review-pr": {
        label: "Review a change",
        skill: "review-pr/SKILL.md",
        rules: [{ any: ["review", "pull request", "PR"], exclude: ["fix"], weight: 2 }]
      }
    }
  };
  const fixture = {
    schema_version: 1,
    id: "engineering-routing-regression-v1",
    thresholds: { minimum_accuracy: 1, minimum_coverage: 1, maximum_false_positive_rate: 0 },
    cases: [
      { id: "bug-en", hint: "Fix this checkout bug and add a regression test", expect: "fix-bug" },
      { id: "bug-vi", hint: "Sửa lỗi thanh toán", expect: "fix-bug" },
      { id: "review", hint: "Review pull request 42", expect: "review-pr" },
      { id: "unknown", hint: "Explain the deployment architecture", expect: null }
    ]
  };
  const configFile = path.join(root, "routing.json");
  const fixtureFile = path.join(root, "routing-cases.json");
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));
  return { root, skillsRoot, config, fixture, configFile, fixtureFile };
}

test("skill router selects a weighted route and exposes match evidence", () => {
  const { config } = createFixture();
  const result = routeSkill({ config, hint: "Please fix the checkout bug and add a test" });
  assert.equal(result.status, "ROUTED");
  assert.equal(result.primary, "fix-bug");
  assert.equal(result.primary_skill, "fix-bug/SKILL.md");
  assert.match(result.config_hash, /^[a-f0-9]{64}$/);
  assert.equal(result.score, 4);
  assert.deepEqual(result.candidates[0].evidence.map((item) => item.rule_index), [0, 1]);
  assert.deepEqual(result.candidates[0].evidence[0].matched_any, ["bug"]);
});

test("skill router abstains on ambiguity and weak or absent signals", () => {
  const { config } = createFixture();
  const ambiguous = routeSkill({ config, hint: "Bug review requested" });
  assert.equal(ambiguous.status, "ABSTAIN");
  assert.equal(ambiguous.reason, "AMBIGUOUS");
  assert.equal(ambiguous.primary, null);
  assert.equal(ambiguous.suggested_route, "fix-bug");
  const absent = routeSkill({ config, hint: "Use a debugger to inspect latency" });
  assert.equal(absent.status, "ABSTAIN");
  assert.equal(absent.reason, "NO_MATCH");
  assert.equal(absent.suggested_route, "review-pr");
});

test("routing coherence verifies exact priority coverage and real skill files", () => {
  const { config, skillsRoot } = createFixture();
  const report = validateSkillRoutingConfig(config, { skillsRoot });
  assert.equal(report.status, "VALID");
  assert.equal(report.route_count, 2);
  assert.equal(report.checked_skill_files, true);
  assert.throws(
    () => validateSkillRoutingConfig({ ...config, priority: ["fix-bug"] }, { skillsRoot }),
    /must cover routes exactly/
  );
  assert.throws(
    () => validateSkillRoutingConfig({ ...config, routes: { ...config.routes, "fix-bug": { ...config.routes["fix-bug"], skill: "../escape/SKILL.md" } } }),
    /must stay inside/
  );
});

test("routing coherence rejects symlinked skill targets", () => {
  const { root, config, skillsRoot } = createFixture();
  const external = path.join(root, "external");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "SKILL.md"), "external\n");
  const link = path.join(skillsRoot, "linked");
  fs.symlinkSync(external, link, "dir");
  const linked = {
    ...config,
    routes: { ...config.routes, "review-pr": { ...config.routes["review-pr"], skill: "linked/SKILL.md" } }
  };
  assert.match(verifySkillRouting({ config: linked, skillsRoot }).errors[0], /symbolic links/);
});

test("routing benchmark measures accuracy, coverage, false positives, and per-route recall", () => {
  const { config, fixture, skillsRoot } = createFixture();
  const passing = evaluateSkillRouting({ config, fixture, skillsRoot });
  assert.equal(passing.status, "PASSED");
  assert.match(passing.fixture_hash, /^[a-f0-9]{64}$/);
  assert.match(passing.config_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(passing.summary, { total: 4, passed: 4, failed: 0, accuracy: 1, coverage: 1, false_positive_rate: 0 });
  assert.equal(passing.per_route["fix-bug"].recall, 1);
  const failingFixture = structuredClone(fixture);
  failingFixture.cases[0].expect = "review-pr";
  const failing = evaluateSkillRouting({ config, fixture: failingFixture, skillsRoot });
  assert.equal(failing.status, "FAILED");
  assert.equal(failing.failures[0].id, "bug-en");
});

test("skill routing CLI routes, verifies, evaluates, and fails closed", async () => {
  const { configFile, fixtureFile, skillsRoot } = createFixture();
  assert.throws(() => parseSkillRoutingArgs(["route", "--config", configFile]), /requires --hint/);
  assert.throws(() => parseSkillRoutingArgs(["eval", "--config", configFile, "--fixture", fixtureFile]), /requires --skills-root/);
  const routeLogs = [];
  assert.equal(await main(["skills", "route", "--config", configFile, "--hint", "Fix payment bug"], { log: (value) => routeLogs.push(value) }), 0);
  assert.equal(JSON.parse(routeLogs[0]).primary, "fix-bug");
  const evalLogs = [];
  assert.equal(await main(["skills", "eval", "--config", configFile, "--skills-root", skillsRoot, "--fixture", fixtureFile], { log: (value) => evalLogs.push(value) }), 0);
  assert.equal(JSON.parse(evalLogs[0]).status, "PASSED");
  const abstainLogs = [];
  assert.equal(await main(["skills", "route", "--config", configFile, "--hint", "Plan capacity"], { log: (value) => abstainLogs.push(value) }), 1);
  assert.equal(JSON.parse(abstainLogs[0]).status, "ABSTAIN");
  assert.equal(loadSkillRoutingConfig(configFile).id, "engineering-router-v1");
});
