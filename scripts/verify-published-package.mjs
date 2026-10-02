import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { verifyPublishedPackage } from "../src/published-package.mjs";

const directory = path.resolve(".ai-agent-kit/release-candidate");
const candidate = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
if (candidate.archive !== "package.tgz") throw new Error("Unexpected frozen candidate path.");
const bytes = fs.readFileSync(path.join(directory, candidate.archive));
if (crypto.createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) throw new Error("Frozen candidate was modified before readback.");
try {
  const report = await verifyPublishedPackage({ packageName: candidate.package_name, version: candidate.version, expectedBytes: bytes });
  fs.writeFileSync(path.join(directory, "post-publish-sanity.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(directory, "post-publish-sanity.json"), `${JSON.stringify({ status: "RELEASED_UNVERIFIED", version: candidate.version, reason: error.message }, null, 2)}\n`);
  throw error;
}
