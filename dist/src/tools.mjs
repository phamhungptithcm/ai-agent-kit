export function commandSucceeded(result) {
  return result && result.code === 0;
}

export function checkCommand(runner, root, command, args = []) {
  const result = runner.run(command, args, { cwd: root, timeout: 120000 });
  return { ok: commandSucceeded(result), stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function checkCodeGraph(runner, root) {
  const version = checkCommand(runner, root, "codegraph", ["--version"]);
  if (!version.ok) return { status: "MISSING", detail: version.stderr || "codegraph not found" };
  const status = checkCommand(runner, root, "codegraph", ["status", "."]);
  const query = checkCommand(runner, root, "codegraph", ["query", "--path", ".", "--limit", "1", "Account"]);
  return {
    status: status.ok && query.ok ? "READY" : "BLOCKED",
    version: version.stdout || "available",
    detail: status.ok && query.ok ? "health check passed" : status.stderr || query.stderr || "health check failed"
  };
}

export function checkCocoIndex(runner, root) {
  const version = checkCommand(runner, root, "ccc", ["--version"]);
  if (!version.ok) return { status: "MISSING", detail: version.stderr || "ccc not found" };
  const status = checkCommand(runner, root, "ccc", ["status"]);
  const search = checkCommand(runner, root, "ccc", ["search", "--limit", "1", "account"]);
  return {
    status: status.ok && search.ok ? "READY" : "BLOCKED",
    version: version.stdout || "available",
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
    const result = runner.run("npm", ["install", "-g", "@colbymchenry/codegraph"], { cwd: root, timeout: 900000 });
    results.push(result.code === 0 ? "CodeGraph install attempted successfully." : `CodeGraph install failed: ${result.stderr.trim()}`);
  }
  if (toolStatus.cocoindex.status === "MISSING") {
    const result = runner.run("uv", ["tool", "install", "--upgrade", "cocoindex-code[full]"], { cwd: root, timeout: 1800000 });
    results.push(result.code === 0 ? "CocoIndex install attempted successfully." : `CocoIndex install failed: ${result.stderr.trim()}`);
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
