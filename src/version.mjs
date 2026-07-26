import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_CANDIDATES = [
  path.resolve(MODULE_DIR, "..", "package.json"),
  path.resolve(MODULE_DIR, "..", "..", "package.json")
];

export function getPackageVersion() {
  const packageJson = PACKAGE_JSON_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!packageJson) {
    throw new Error(`Package metadata was not found near ${MODULE_DIR}`);
  }
  const packageData = JSON.parse(fs.readFileSync(packageJson, "utf8"));
  if (typeof packageData.version !== "string" || packageData.version.length === 0) {
    throw new Error(`Package version is missing from ${packageJson}`);
  }
  return packageData.version;
}
