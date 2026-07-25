import fs from "node:fs";
import path from "node:path";
import { hasSymlinkComponent, normalizeRelPath } from "./paths.mjs";

export function parseContractManifest(text) {
  const requiredPaths = new Set([".ai/manifest.yaml"]);
  for (const line of text.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+"(\.ai\/[^"]+)"\s*$/);
    if (listItem) requiredPaths.add(normalizeRelPath(listItem[1]));
    const scalarPath = line.match(/^\s*(?:proposal):\s+"(\.ai\/[^"]+)"\s*$/);
    if (scalarPath) requiredPaths.add(normalizeRelPath(scalarPath[1]));
  }
  return [...requiredPaths].sort();
}

export function verifyContract(root, ownership = null) {
  const manifestPath = path.join(root, ".ai", "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    return {
      state: "INCOMPLETE",
      requiredPaths: [".ai/manifest.yaml"],
      missingPaths: [".ai/manifest.yaml"],
      driftedPaths: []
    };
  }
  if (hasSymlinkComponent(root, ".ai/manifest.yaml")) {
    return {
      state: "DRIFTED",
      requiredPaths: [".ai/manifest.yaml"],
      missingPaths: [],
      driftedPaths: [".ai/manifest.yaml"]
    };
  }
  const requiredPaths = parseContractManifest(fs.readFileSync(manifestPath, "utf8"));
  const missingPaths = requiredPaths.filter((relPath) => !fs.existsSync(path.join(root, relPath)));
  const ownershipByPath = new Map((ownership?.entries ?? []).map((entry) => [entry.path, entry]));
  const driftedPaths = requiredPaths.filter((relPath) => {
    const entry = ownershipByPath.get(relPath);
    return entry && ["MODIFIED", "INVALID_MANAGED_SECTION", "INVALID_PATH", "TOO_LARGE", "SYMLINK"].includes(entry.state);
  });
  const state = missingPaths.length > 0 ? "INCOMPLETE" : driftedPaths.length > 0 ? "DRIFTED" : "CORE_READY";
  return { state, requiredPaths, missingPaths, driftedPaths };
}
