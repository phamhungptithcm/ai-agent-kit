import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(repoRoot, "assets", "enterprise-ai-agent-os");
const validator = path.join(assetRoot, ".ai", "scripts", "validate_seo_geo_contract.py");
const validFixture = path.join(assetRoot, ".ai", "templates", "seo-geo-contract.example.json");
const invalidFixture = path.join(assetRoot, ".ai", "evals", "e2e", "seo-geo-contract-invalid.json");

function runValidator(contract, cwd = assetRoot) {
  return spawnSync("python3", ["-B", validator, contract], { cwd, encoding: "utf8" });
}

function mutateFixture(name, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ai-agent-kit-seo-geo-${name}-`));
  const contract = JSON.parse(fs.readFileSync(validFixture, "utf8"));
  mutate(contract);
  const contractPath = path.join(root, "contract.json");
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return { root, contractPath };
}

test("SEO/GEO contract accepts the canonical positive fixture", () => {
  const result = runValidator(validFixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SEO\/GEO contract validation passed/);
});

test("SEO/GEO contract rejects the bundled negative fixture", () => {
  const result = runValidator(invalidFixture);
  assert.notEqual(result.status, 0);
  const evidence = result.stderr;
  assert.match(evidence, /redirect routes must be non-indexable/);
  assert.match(evidence, /references unknown id/);
  assert.match(evidence, /claim 'claim:stale' is not publishable/);
  assert.match(evidence, /must be omitted unless status is MEASURED/);
});

test("SEO/GEO contract rejects canonical cycles", () => {
  const fixture = mutateFixture("canonical-cycle", (contract) => {
    contract.routes[0].canonical = contract.routes[1].url;
    contract.routes[1].canonical = contract.routes[0].url;
    contract.routes[0].sitemap = false;
    contract.routes[1].sitemap = false;
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cycle detected/);
});

test("SEO/GEO contract rejects non-reciprocal hreflang alternates", () => {
  const fixture = mutateFixture("hreflang", (contract) => {
    contract.routes[1].alternates = [];
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing reciprocal alternate/);
});

test("SEO/GEO contract rejects stale publishable evidence", () => {
  const fixture = mutateFixture("stale", (contract) => {
    contract.sources[0].review_due_at = "2026-08-12";
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is stale as of 2026-08-13/);
});

test("SEO/GEO contract rejects conflicting purpose-specific crawler decisions", () => {
  const fixture = mutateFixture("crawler-conflict", (contract) => {
    contract.crawler_policies.push({
      ...contract.crawler_policies[0],
      id: "crawler:openai-search-conflict",
      decision: "BLOCK"
    });
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicts with another decision/);
});

test("SEO/GEO contract requires evidence fields for measured outcomes", () => {
  const fixture = mutateFixture("measurement", (contract) => {
    delete contract.measurements[0].sample_size;
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sample_size: is required when status is MEASURED/);
});

test("SEO/GEO contract enforces the bundled JSON Schema before semantic checks", () => {
  const fixture = mutateFixture("schema", (contract) => {
    delete contract.site.locales;
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\$\.site\.locales: is required/);
});

test("SEO/GEO contract rejects claims scoped to unknown routes", () => {
  const fixture = mutateFixture("claim-scope", (contract) => {
    contract.claims[0].scopes.push("route:missing");
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /claims\[0\]\.scopes: references unknown id 'route:missing'/);
});

test("SEO/GEO contract requires hreflang locale to match its target route", () => {
  const fixture = mutateFixture("hreflang-locale", (contract) => {
    contract.routes[0].alternates[0].locale = "en";
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must equal the target route locale/);
});

test("SEO/GEO contract rejects reversed measurement windows", () => {
  const fixture = mutateFixture("measurement-window", (contract) => {
    contract.measurements[0].observed_from = "2026-08-14";
    contract.measurements[0].observed_to = "2026-08-13";
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /observed_to: must not precede observed_from/);
});

test("SEO/GEO contract rejects symlink inputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-seo-geo-symlink-"));
  const realContract = path.join(root, "contract.json");
  const linkedContract = path.join(root, "linked-contract.json");
  fs.copyFileSync(validFixture, realContract);
  fs.symlinkSync(realContract, linkedContract);
  const result = runValidator(linkedContract, root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a symlink/);
});

test("SEO/GEO contract handles long acyclic canonical graphs without recursion", () => {
  const fixture = mutateFixture("canonical-chain", (contract) => {
    contract.routes = Array.from({ length: 1100 }, (_, index) => {
      const url = `https://example.com/page-${index}`;
      const canonical = index === 1099 ? url : `https://example.com/page-${index + 1}`;
      return {
        id: `route:page-${index}`,
        url,
        status: "PUBLIC",
        locale: "en",
        canonical,
        indexable: true,
        robots: "INDEX_FOLLOW",
        sitemap: false,
        redirect_target: null,
        primary_entity_ids: [],
        alternates: [],
        structured_data: [],
        verified_at: "2026-08-13",
        review_due_at: "2027-02-13"
      };
    });
    contract.entities = [];
    contract.claims = [];
  });
  const result = runValidator(fixture.contractPath, fixture.root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
