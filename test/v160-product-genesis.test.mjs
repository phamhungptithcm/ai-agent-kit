import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const aiRoot = path.join(repoRoot, "assets/enterprise-ai-agent-os/.ai");
function validate(root = aiRoot) {
  return spawnSync("python3", [path.join(root, "scripts/validate_capability_coverage.py"), "--root", root], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("Product Genesis capability catalog covers every canonical skill and route", () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    { status: report.status, skills: report.skill_count, routes: report.route_count, artifacts: report.artifact_count },
    { status: "VALID", skills: 49, routes: 23, artifacts: 27 }
  );
});

test("capability validation fails closed for an orphan canonical skill", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "aak-capability-orphan-"));
  const copiedRoot = path.join(fixture, ".ai");
  fs.cpSync(aiRoot, copiedRoot, { recursive: true });
  fs.mkdirSync(path.join(copiedRoot, "skills-src/orphan-skill"), { recursive: true });
  fs.writeFileSync(path.join(copiedRoot, "skills-src/orphan-skill/SKILL.md"), "---\nname: orphan-skill\ndescription: Must be rejected because it has no coverage metadata.\n---\n");
  const result = validate(copiedRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skill catalog must cover canonical skills exactly/);
});

test("external skill intake rejects adaptation with unknown license", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "aak-capability-license-"));
  const copiedRoot = path.join(fixture, ".ai");
  fs.cpSync(aiRoot, copiedRoot, { recursive: true });
  const lockPath = path.join(copiedRoot, "config/external-skill-sources.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.sources.find((source) => source.status === "ADAPT").license = "NOASSERTION";
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const result = validate(copiedRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disallowed or unknown adaptation license/);
});

test("Product Genesis schemas and routing fixtures are valid JSON", () => {
  const names = [
    "product-idea.schema.json", "product-research.schema.json", "business-requirements.schema.json",
    "product-specification.schema.json", "product-baseline-approval.schema.json",
    "requirement-traceability.schema.json", "product-delivery-backlog.schema.json", "product-change.schema.json"
  ];
  for (const name of names) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(aiRoot, "templates", name), "utf8")));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(aiRoot, "evals/e2e/skill-routing-cases.json"), "utf8")));
});
