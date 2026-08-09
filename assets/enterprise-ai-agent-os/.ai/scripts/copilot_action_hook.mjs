import fs from "node:fs";

function readInput() {
  const text = fs.readFileSync(0, "utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI Agent Kit Copilot hook received invalid JSON");
  }
}

function commandText(input) {
  const args = input.toolArgs ?? input.tool_input ?? {};
  if (typeof args === "string") return args;
  return String(args.command ?? args.cmd ?? "");
}

function decision(permissionDecision, permissionDecisionReason) {
  process.stdout.write(`${JSON.stringify({ permissionDecision, permissionDecisionReason })}\n`);
}

function shellCommandMutates(command) {
  if (!command.trim()) return false;
  return /(?:^|(?:&&|\|\||;|\n)\s*)(?:sudo\s+)?(?:cp|mv|mkdir|touch|truncate|tee|sed\s+-i|perl\s+-i|python\d*\s+-c|npm\s+(?:install|uninstall|publish)|npx\s+[^\s]+\s+(?:add|remove)|git\s+(?:add|commit|push|tag|checkout|switch|merge|rebase|reset|clean)|gh\s+(?:pr|release|issue)\s+(?:create|edit|close|merge)|(?:rm|rmdir)\b)/i.test(command)
    || /(?:^|[^<])>{1,2}\s*[^&]/.test(command);
}

try {
  const input = readInput();
  const tool = String(input.toolName ?? input.tool_name ?? "unknown").toLowerCase();
  const command = commandText(input);
  const protectedCommand = /(?:^|\s)(?:git\s+(?:commit|push|tag)|gh\s+(?:pr\s+(?:create|merge)|release\s+create)|npm\s+publish|(?:rm|rmdir)\s)/i.test(command);
  const fileMutation = ["edit", "create", "write", "apply_patch"].some((name) => tool.includes(name));
  const shellMutation = ["bash", "powershell", "shell", "terminal"].some((name) => tool.includes(name)) && shellCommandMutates(command);
  const mutatingTool = fileMutation || shellMutation;
  if (protectedCommand) {
    decision("ask", "Protected external or destructive action requires current explicit approval through AI Agent Kit.");
  } else if (mutatingTool && !process.env.AI_AGENT_KIT_TASK_ID) {
    decision("ask", "Start or bind an AI Agent Kit task before using a mutating tool.");
  } else {
    decision("allow", "Tool call remains subject to repository policy and the governed task scope.");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
