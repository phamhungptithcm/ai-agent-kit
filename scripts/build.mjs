import fs from "node:fs";
import path from "node:path";

const dist = "dist";
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync("bin", path.join(dist, "bin"), { recursive: true });
fs.cpSync("src", path.join(dist, "src"), { recursive: true });
if (fs.existsSync("docs")) fs.cpSync("docs", path.join(dist, "docs"), { recursive: true });
fs.copyFileSync("README.md", path.join(dist, "README.md"));
fs.copyFileSync("package.json", path.join(dist, "package.json"));
for (const file of ["CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md"]) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dist, file));
}
console.log("build complete");
