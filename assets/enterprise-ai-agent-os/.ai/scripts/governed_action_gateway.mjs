#!/usr/bin/env node
import process from "node:process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
}

function output(decision, reason) {
  const permissionDecision = decision === "allow" ? "allow" : decision === "ask" ? "ask" : "deny";
  process.stdout.write(`${JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason: reason
    }
  })}\n`);
}

const taskId = process.env.AI_AGENT_KIT_TASK_ID;
if (!taskId) {
  output("allow", "Universal gateway inactive: no governed task binding.");
  process.exit(0);
}

try {
  const raw = await readStdin();
  const event = raw.trim() ? JSON.parse(raw) : {};
  const input = event.tool_input ?? event.input ?? {};
  const runtime = await import("@hunpeolabs/ai-agent-kit/dist/src/governed-runtime.mjs");
  const result = runtime.authorizeAction({
    target: process.cwd(),
    id: taskId,
    adapter: process.env.AI_AGENT_KIT_ADAPTER ?? "unknown",
    tool: event.tool_name ?? event.tool ?? "unknown",
    path: input.file_path ?? input.path ?? input.notebook_path,
    command: input.command,
    domain: input.domain,
    risk: input.risk ?? "low",
    parameters: input
  });
  output(result.decision, `${result.reason_code}; receipt=${result.receipt_hash}`);
} catch (error) {
  output("deny", `Universal gateway unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`);
}
