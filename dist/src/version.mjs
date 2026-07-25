import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = path.resolve(MODULE_DIR, "..", "package.json");

export function getPackageVersion() {
  const packageData = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  if (typeof packageData.version !== "string" || packageData.version.length === 0) {
    throw new Error(`Package version is missing from ${PACKAGE_JSON}`);
  }
  return packageData.version;
}
