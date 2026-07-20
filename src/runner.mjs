import { spawnSync } from "node:child_process";

const FORBIDDEN_GIT_COMMANDS = [
  ["branch"],
  ["checkout"],
  ["switch"],
  ["worktree"],
  ["add"],
  ["commit"],
  ["push"],
  ["reset"],
  ["clean"],
  ["merge"],
  ["rebase"],
  ["tag"]
];

function startsWith(args, pattern) {
  return pattern.every((part, index) => args[index] === part);
}

export function assertAllowedCommand(command, args) {
  const lowerCommand = command.toLowerCase();
  if (lowerCommand === "git") {
    if (args[0] === "branch" && args[1] === "--show-current") {
      return;
    }
    for (const pattern of FORBIDDEN_GIT_COMMANDS) {
      if (startsWith(args, pattern)) {
        throw new Error(`Forbidden Git operation attempted by bootstrap: git ${args.join(" ")}`);
      }
    }
  }
  const joined = [command, ...args].join(" ").toLowerCase();
  if (joined.includes("gitlab") || joined.includes("jira") || joined.includes("atlassian") || joined.includes("merge_request")) {
    throw new Error(`Forbidden remote API operation attempted by bootstrap: ${command} ${args.join(" ")}`);
  }
}

export function createRunner() {
  const calls = [];
  return {
    calls,
    run(command, args = [], options = {}) {
      assertAllowedCommand(command, args);
      calls.push({ command, args: [...args], cwd: options.cwd });
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: "utf8",
        shell: false,
        timeout: options.timeout ?? 120000
      });
      return {
        code: result.status ?? (result.error ? 1 : 0),
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? (result.error ? result.error.message : "")
      };
    }
  };
}
