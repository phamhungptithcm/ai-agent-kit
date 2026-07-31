#!/usr/bin/env node
import process from "node:process";

const taskId = process.env.AI_AGENT_KIT_TASK_ID;
if (!taskId) process.exit(0);

try {
  const runtime = await import("@hunpeolabs/ai-agent-kit/dist/src/task-report.mjs");
  const report = runtime.buildFinalTaskReport({
    target: process.cwd(),
    id: taskId,
    productionTarget: process.env.AI_AGENT_KIT_PRODUCTION_TARGET ?? "true"
  });
  process.stdout.write(`${runtime.renderFinalTaskReport(report, { compact: true })}\n`);
} catch {
  // Usage and completion reporting are deliberately fail-open. The agent's
  // response must not be blocked by a missing package, task, or local ledger.
  process.exit(0);
}
