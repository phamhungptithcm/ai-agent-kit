import fs from "node:fs";
import path from "node:path";

const dist = "dist";
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync("bin", path.join(dist, "bin"), { recursive: true });
fs.cpSync("src", path.join(dist, "src"), { recursive: true });
console.log("build complete");
