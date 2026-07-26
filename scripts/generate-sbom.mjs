import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function generateSbom({ root = process.cwd(), output = path.join("dist", "sbom.spdx.json") } = {}) {
  const packageData = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lockData = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const packages = Object.entries(lockData.packages ?? {}).map(([location, metadata], index) => ({
    SPDXID: `SPDXRef-Package-${index}`,
    name: metadata.name ?? (location || packageData.name),
    versionInfo: metadata.version ?? "unknown",
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false
  }));
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${packageData.name}-${packageData.version}`,
    documentNamespace: `https://github.com/phamhungptithcm/ai-agent-kit/sbom/${packageData.version}/${crypto.randomUUID()}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: @hunpeolabs/ai-agent-kit"]
    },
    packages
  };
  const target = path.join(root, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return target;
}
