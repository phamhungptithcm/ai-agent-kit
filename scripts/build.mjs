import fs from "node:fs";
import path from "node:path";
import { generateSbom } from "./generate-sbom.mjs";

const dist = "dist";
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync("bin", path.join(dist, "bin"), { recursive: true });
fs.cpSync("src", path.join(dist, "src"), { recursive: true });
generateSbom();
console.log("build complete");
