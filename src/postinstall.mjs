import fs from "node:fs";
import path from "node:path";
import { findInstalledDependency } from "./activation.mjs";
import { main } from "./cli.mjs";

export function inspectPostinstall({
  initCwd = process.env.INIT_CWD,
  packageRoot,
  env = process.env
} = {}) {
  if (!initCwd || !packageRoot) return { action: "skip", reason: "missing-context" };

  const target = path.resolve(initCwd);
  const installedPackageRoot = path.resolve(packageRoot);
  if (target === installedPackageRoot) return { action: "skip", reason: "package-development" };
  if (env.npm_config_global === "true") return { action: "skip", reason: "global-install" };

  const dependencyField = findInstalledDependency(target);
  const expectedTopLevelRoot = path.join(target, "node_modules", "@hunpeolabs", "ai-agent-kit");
  const isTopLevelInstall = (
    env.npm_command === "install"
    && installedPackageRoot === expectedTopLevelRoot
  );
  if (!dependencyField && !isTopLevelInstall) {
    return { action: "skip", reason: "not-a-project-install" };
  }
  if (fs.existsSync(path.join(target, ".ai-agent-kit", "installation.json"))) {
    return { action: "skip", reason: "already-activated", target, dependencyField };
  }

  return {
    action: "import",
    target,
    dependencyField: dependencyField ?? "top-level npm install"
  };
}

export async function runPostinstall(options = {}) {
  const io = options.io ?? console;
  const inspection = inspectPostinstall(options);
  if (inspection.action !== "import") return inspection;

  io.log(`AI Agent Kit: importing governed kit into ${inspection.target}`);
  await main(
    [
      "bootstrap",
      "--preset", "governed",
      "--non-interactive",
      "--yes",
      "--target", inspection.target
    ],
    io,
    options.deps
  );
  io.log("AI Agent Kit: governed kit imported successfully.");
  return inspection;
}
