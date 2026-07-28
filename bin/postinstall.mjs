#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPostinstall } from "../src/postinstall.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

runPostinstall({ packageRoot }).catch((error) => {
  console.error(`AI Agent Kit postinstall failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
