import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const sha = (value, algorithm) => crypto.createHash(algorithm).update(value).digest(algorithm === "sha512" ? "base64" : "hex");
async function boundedBody(response, budget, label) {
  const length = Number(response.headers?.get("content-length"));
  if (Number.isFinite(length) && length > budget) throw new Error(`${label} exceeds its budget.`);
  if (response.body?.getReader) {
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > budget) { await reader.cancel(); throw new Error(`${label} exceeds its budget.`); } chunks.push(Buffer.from(chunk.value)); }
      return Buffer.concat(chunks, size);
    } finally { reader.releaseLock(); }
  }
  const bytes = response.arrayBuffer ? Buffer.from(await response.arrayBuffer()) : Buffer.from(await response.text());
  if (bytes.length > budget) throw new Error(`${label} exceeds its budget.`);
  return bytes;
}
export async function verifyPublishedPackage(options, deps = {}) {
  const { packageName, version, expectedBytes } = options;
  if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName ?? "") || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? "")) throw new Error("Sanity must target an exact package name and version.");
  if (!Buffer.isBuffer(expectedBytes) || expectedBytes.length < 1 || expectedBytes.length > 64 * 1024 * 1024) throw new Error("Frozen candidate bytes are required.");
  const request = deps.fetch ?? fetch;
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Published package metadata is unavailable; release remains unverified.");
  const text = (await boundedBody(response, 2 * 1024 * 1024, "Registry metadata")).toString("utf8");
  const metadata = JSON.parse(text);
  const expectedIntegrity = `sha512-${sha(expectedBytes, "sha512")}`;
  if (metadata.name !== packageName || metadata.version !== version || metadata.dist?.integrity !== expectedIntegrity) throw new Error("Published version or integrity differs from the frozen candidate.");
  const tarballUrl = new URL(metadata.dist.tarball);
  if (tarballUrl.protocol !== "https:" || tarballUrl.hostname !== "registry.npmjs.org" || tarballUrl.port || tarballUrl.username || tarballUrl.password) throw new Error("Registry tarball location is not trusted.");
  const tarball = await request(tarballUrl.href, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!tarball.ok) throw new Error("Published tarball readback failed.");
  const bytes = await boundedBody(tarball, 64 * 1024 * 1024, "Registry artifact");
  if (bytes.length > 64 * 1024 * 1024 || sha(bytes, "sha256") !== sha(expectedBytes, "sha256")) throw new Error("Published artifact bytes differ from the frozen candidate.");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aak-published-sanity-"));
  const execute = deps.execute ?? ((command, args, cwd) => spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: false }));
  const checks = [];
  const run = (check, command, args, cwd) => {
    const result = execute(command, args, cwd);
    if (result.status !== 0 || result.error) throw new Error(`Published artifact check ${check} failed; stop promotion and inspect CI evidence.`);
    checks.push({ id: check, status: "PASSED", output_sha256: sha(String(result.stdout ?? ""), "sha256") });
    return String(result.stdout ?? "");
  };
  try {
    const archive = path.join(temporary, "published.tgz"); fs.writeFileSync(archive, bytes, { mode: 0o600 });
    const install = path.join(temporary, "install"); const fixture = path.join(temporary, "fixture"); fs.mkdirSync(install); fs.mkdirSync(fixture);
    fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ private: true, name: "published-package-sanity" }));
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    run("clean-install", npm, ["install", "--no-audit", "--no-fund", archive], install);
    const cli = path.join(install, "node_modules", ...packageName.split("/"), "dist/bin/ai-agent-kit.mjs");
    const observed = run("version-readback", process.execPath, [cli, "--version"], fixture).trim();
    if (observed !== version) throw new Error("Installed package reports a different version.");
    run("fixture-init", "git", ["init", "--quiet"], fixture);
    run("dry-run", process.execPath, [cli, "bootstrap", "--dry-run", "--target", fixture, "--agents", "codex", "--no-install-tools", "--no-refresh-indexes"], fixture);
    if (fs.existsSync(path.join(fixture, ".ai-agent-kit/installation.json"))) throw new Error("Published dry-run applied installation state.");
    run("bootstrap", process.execPath, [cli, "bootstrap", "--target", fixture, "--agents", "codex", "--no-install-tools", "--no-refresh-indexes"], fixture);
    if (!deps.execute && !fs.existsSync(path.join(fixture, ".ai/core/product-delivery.md"))) throw new Error("Published package omitted the product delivery contract.");
    run("status", process.execPath, [cli, "status", "--target", fixture], fixture);
    run("update-preview", process.execPath, [cli, "update", "--dry-run", "--target", fixture], fixture);
    return { schema_version: 1, status: "PASSED", evidence_level: "REGISTRY_READBACK_AND_CLEAN_INSTALL", package_name: packageName, version, integrity: expectedIntegrity, artifact_sha256: sha(bytes, "sha256"), observed_at: new Date().toISOString(), checks, limits: ["Native AI-host execution, public-key provenance verification and an operational observation window require separate evidence."] };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
