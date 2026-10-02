import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main, parseProductArgs } from "../src/cli.mjs";

test("product CLI parses governed repeated approval flags", () => {
  const parsed = parseProductArgs(["approve", "--id", "pilot", "--type", "BUSINESS_REQUIREMENTS", "--scope", "BR-001", "--scope", "BR-002", "--constraint", "pilot-only", "--accepted-risk", "small sample"]);
  assert.deepEqual(parsed.options.scope, ["BR-001", "BR-002"]);
  assert.deepEqual(parsed.options.constraints, ["pilot-only"]);
  assert.deepEqual(parsed.options.acceptedRisks, ["small sample"]);
  const reconciliation = parseProductArgs(["github-sync", "--id", "pilot", "--apply", "--approval-hash", "a".repeat(64), "--identity-file", "operator.json", "--action-file", "github-sync-action.json", "--confirm-absent", "STORY-001", "--confirm-absent", "STORY-002"]);
  assert.deepEqual(reconciliation.options.confirmAbsent, ["STORY-001", "STORY-002"]);
  assert.equal(reconciliation.options.identityFile, "operator.json");
  assert.equal(reconciliation.options.actionFile, "github-sync-action.json");
  const release = parseProductArgs(["release-candidate", "--id", "pilot", "--release-class", "PRODUCTION", "--limitation", "market review pending"]);
  assert.equal(release.options.releaseClass, "PRODUCTION");
  assert.deepEqual(release.options.limitations, ["market review pending"]);
  const evidence = parseProductArgs(["evidence-verify", "--id", "pilot", "--evidence-id", "EVID-CI", "--minimum-trust", "PROVIDER_VERIFIED"]);
  assert.equal(evidence.options.evidenceId, "EVID-CI");
  assert.throws(() => parseProductArgs(["start", "--unknown", "value"]), /Unknown product start option/);
});

test("product CLI starts, inspects, resumes, and validates without chat state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aak-product-cli-"));
  const logs = [], io = { log: (value) => logs.push(value) };
  assert.equal(await main(["product", "start", "--target", root, "--id", "cli-pilot", "--name", "CLI Pilot", "--idea", "A small appointment workflow", "--profile", "lean", "--actor", "Owner", "--timestamp", "2026-08-20T12:00:00Z"], io), 0);
  assert.equal(JSON.parse(logs.at(-1)).status, "CREATED");
  assert.equal(await main(["product", "status", "--target", root, "--id", "cli-pilot"], io), 0);
  assert.equal(JSON.parse(logs.at(-1)).stage, "IDEA");
  assert.equal(await main(["product", "resume", "--target", root, "--id", "cli-pilot"], io), 0);
  assert.equal(JSON.parse(logs.at(-1)).prompt_context.next_skill, "discuss-product-idea");
  assert.equal(await main(["product", "dossier-status", "--target", root, "--id", "cli-pilot", "--timestamp", "2026-08-20T12:01:00Z"], io), 1);
  assert.equal(JSON.parse(logs.at(-1)).status, "NOT_READY");
  assert.equal(await main(["product", "dossier-export", "--target", root, "--id", "cli-pilot", "--output", "dossier.md", "--timestamp", "2026-08-20T12:02:00Z"], io), 0);
  assert.equal(JSON.parse(logs.at(-1)).status, "EXPORTED");

  fs.mkdirSync(path.join(root, "inputs"));
  fs.writeFileSync(path.join(root, "inputs/invalid-brd.json"), JSON.stringify({ schema_version: 1 }));
  assert.equal(await main(["product", "artifact-validate", "--target", root, "--type", "brd", "--file", "inputs/invalid-brd.json"], io), 1);
  assert.equal(JSON.parse(logs.at(-1)).status, "INVALID");
});
