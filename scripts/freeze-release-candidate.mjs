import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd(); const directory = path.join(root, ".ai-agent-kit/release-candidate");
fs.mkdirSync(directory, { recursive: true });
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--json", "--pack-destination", directory], { cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: false });
if (result.status !== 0) throw new Error("Candidate packaging failed.");
const record = JSON.parse(result.stdout.slice(Math.max(0, result.stdout.lastIndexOf("\n[") + 1)))[0];
const archive = path.join(directory, record.filename); const target = path.join(directory, "package.tgz");
if (archive !== target) fs.renameSync(archive, target);
const data = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify({ schema_version: 1, package_name: data.name, version: data.version, archive: "package.tgz", sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") }, null, 2)}\n`);
console.log("Frozen release candidate: .ai-agent-kit/release-candidate/package.tgz");
