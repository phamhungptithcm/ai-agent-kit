import assert from "node:assert/strict";
import fs from "node:fs";

const packageData = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lockData = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/npm-publish.yml", "utf8");

assert.equal(lockData.lockfileVersion, 3, "package-lock must use lockfileVersion 3");
assert.equal(lockData.name, packageData.name, "package and lock names must match");
assert.equal(lockData.version, packageData.version, "package and lock versions must match");
assert.equal(lockData.packages[""].version, packageData.version, "root lock package version must match");
assert.equal(packageData.publishConfig?.registry, "https://registry.npmjs.org/", "npm registry must be explicit");
assert.ok(packageData.files.includes("dist/sbom.spdx.json"), "published files must include the SPDX SBOM");
assert.match(workflow, /permissions:\s*\n\s*contents: read/, "workflow must default to read-only contents");
assert.match(workflow, /id-token: write/, "publish job must request OIDC provenance permission");
assert.match(workflow, /npm publish --access public --provenance/, "publish must include npm provenance");
assert.match(workflow, /Release tag must point to a commit on main/, "tag ancestry gate is required");
assert.match(workflow, /Tag v\$\{tag_version\} does not match package version/, "tag/package version gate is required");

console.log("supply-chain checks passed");
