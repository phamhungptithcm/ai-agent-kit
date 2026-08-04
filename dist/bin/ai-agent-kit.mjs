#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main().then((code) => {
  if (Number.isInteger(code) && code !== 0) process.exitCode = code;
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
