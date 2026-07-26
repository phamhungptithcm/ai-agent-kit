export const TOOL_SPECS = {
  codegraph: {
    name: "CodeGraph",
    package: "@colbymchenry/codegraph@1.5.0",
    command: "codegraph",
    installCommand: ["npm", "install", "-g", "@colbymchenry/codegraph@1.5.0"]
  },
  cocoindex: {
    name: "CocoIndex",
    package: "cocoindex-code[full]==0.2.39",
    command: "ccc",
    installCommand: ["uv", "tool", "install", "cocoindex-code[full]==0.2.39"]
  }
};

export function commandSucceeded(result) {
  return result && result.code === 0;
}

export function checkCommand(runner, root, command, args = []) {
  const result = runner.run(command, args, { cwd: root, timeout: 120000 });
  return { ok: commandSucceeded(result), stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function checkCodeGraphAvailability(runner, root) {
  const version = checkCommand(runner, root, "codegraph", ["--version"]);
  return version.ok
    ? { status: "AVAILABLE", version: version.stdout || "available", detail: "executable available" }
    : { status: "MISSING", detail: version.stderr || "codegraph not found" };
}

export function checkCocoIndexAvailability(runner, root) {
  const availability = checkCommand(runner, root, "ccc", ["--help"]);
  return availability.ok
    ? { status: "AVAILABLE", version: "available", detail: "executable available" }
    : { status: "MISSING", detail: availability.stderr || "ccc not found" };
}

export function checkCodeGraph(runner, root) {
  const availability = checkCodeGraphAvailability(runner, root);
  if (availability.status === "MISSING") return availability;
  const status = checkCommand(runner, root, "codegraph", ["status", "."]);
  const query = checkCommand(runner, root, "codegraph", ["query", "--path", ".", "--limit", "1", "Account"]);
  return {
    status: status.ok && query.ok ? "READY" : "BLOCKED",
    version: availability.version,
    detail: status.ok && query.ok ? "health check passed" : status.stderr || query.stderr || "health check failed"
  };
}

export function checkCocoIndex(runner, root) {
  const availability = checkCocoIndexAvailability(runner, root);
  if (availability.status === "MISSING") return availability;
  const status = checkCommand(runner, root, "ccc", ["status"]);
  const search = checkCommand(runner, root, "ccc", ["search", "--limit", "1", "account"]);
  return {
    status: status.ok && search.ok ? "READY" : "BLOCKED",
    version: "available",
    detail: status.ok && search.ok ? "health check passed" : status.stderr || search.stderr || "health check failed"
  };
}

export function installMissingTools(runner, root, toolStatus, enabled) {
  const results = [];
  if (!enabled) {
    results.push("Tool installation disabled by option.");
    return results;
  }
  if (toolStatus.codegraph.status === "MISSING") {
    const [command, ...args] = TOOL_SPECS.codegraph.installCommand;
    const result = runner.run(command, args, { cwd: root, timeout: 900000 });
    results.push(result.code === 0 ? `CodeGraph ${TOOL_SPECS.codegraph.package} installed.` : `CodeGraph install failed: ${result.stderr.trim()}`);
  }
  if (toolStatus.cocoindex.status === "MISSING") {
    const [command, ...args] = TOOL_SPECS.cocoindex.installCommand;
    const result = runner.run(command, args, { cwd: root, timeout: 1800000 });
    results.push(result.code === 0 ? `CocoIndex ${TOOL_SPECS.cocoindex.package} installed.` : `CocoIndex install failed: ${result.stderr.trim()}`);
  }
  return results;
}

export function refreshIndexes(runner, root, toolStatus, enabled = false) {
  const results = [];
  if (!enabled) {
    results.push("Repository index refresh skipped by default. Run bootstrap --refresh-indexes or .ai/scripts/index-repository.py when deep repository intelligence is needed.");
    return results;
  }
  if (toolStatus.codegraph.status === "READY") {
    const result = runner.run("codegraph", ["sync", ".", "--quiet"], { cwd: root, timeout: 900000 });
    results.push(result.code === 0 ? "CodeGraph index refreshed." : `CodeGraph index refresh failed: ${result.stderr.trim()}`);
  } else {
    results.push("CodeGraph index refresh skipped.");
  }
  if (toolStatus.cocoindex.status === "READY") {
    const result = runner.run("ccc", ["index"], { cwd: root, timeout: 1800000 });
    results.push(result.code === 0 ? "CocoIndex index refreshed." : `CocoIndex index refresh failed: ${result.stderr.trim()}`);
  } else {
    results.push("CocoIndex index refresh skipped.");
  }
  return results;
}
