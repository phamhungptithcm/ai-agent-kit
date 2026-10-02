import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyPublishedPackage } from "../src/published-package.mjs";

const bytes = Buffer.from("fixture tarball"); const options = { packageName: "@hunpeolabs/ai-agent-kit", version: "1.5.0", expectedBytes: bytes };
function provider(change = {}) {
  return async (url) => url.includes("/-/") ? { ok: true, arrayBuffer: async () => bytes } : { ok: true, text: async () => JSON.stringify({ name: options.packageName, version: options.version, dist: { integrity: `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`, tarball: "https://registry.npmjs.org/@hunpeolabs/ai-agent-kit/-/ai-agent-kit-1.5.0.tgz", ...change } }) };
}
test("post-publish sanity checks exact registry bytes and exercises a clean installed CLI", async () => {
  const calls = [];
  const result = await verifyPublishedPackage(options, { fetch: provider(), execute: (command, args) => { calls.push([command, args]); return { status: 0, stdout: args.includes("--version") ? "1.5.0\n" : "fixture execution" }; } });
  assert.equal(calls[0][0], "git"); assert.equal(calls[1][0], process.platform === "win32" ? "npm.cmd" : "npm");
  assert.equal(result.status, "PASSED"); assert.equal(result.evidence_level, "REGISTRY_READBACK_AND_CLEAN_INSTALL"); assert.ok(calls.some(([, args]) => args.includes("--dry-run"))); assert.ok(calls.some(([, args]) => args.includes("status"))); assert.ok(calls.some(([, args]) => args.includes("update")));
});
test("post-publish sanity fails closed on integrity mismatch and untrusted download location", async () => {
  await assert.rejects(verifyPublishedPackage(options, { fetch: provider({ integrity: "sha512-wrong" }) }), /integrity/);
  await assert.rejects(verifyPublishedPackage(options, { fetch: provider({ tarball: "https://untrusted.invalid/package.tgz" }) }), /not trusted/);
});
test("post-publish sanity rejects clean-install failures and misleading installed version", async () => {
  await assert.rejects(verifyPublishedPackage(options, { fetch: provider(), execute: (command) => ({ status: command === "git" ? 0 : 1 }) }), /clean-install failed/);
  await assert.rejects(verifyPublishedPackage(options, { fetch: provider(), execute: () => ({ status: 0, stdout: "wrong version" }) }), /different version/);
});
test("post-publish sanity enforces network body budgets before parsing or installing", async () => {
  await assert.rejects(verifyPublishedPackage(options, { fetch: async () => ({ ok: true, headers: { get: () => String(3 * 1024 * 1024) }, text: async () => { throw new Error("must not read oversized body"); } }) }), /exceeds its budget/);
});

test("registry processing retries transient metadata visibility within a finite budget", async () => {
  let metadataCalls = 0; let sleeps = 0;
  const good = provider();
  const fetch = async url => {
    if (!url.includes("/-/") && ++metadataCalls < 3) return {ok:false,status:404};
    return good(url);
  };
  const result = await verifyPublishedPackage(options, {fetch, sleep:async ms=>{assert.equal(ms,30000);sleeps++;},execute:(_,args)=>({status:0,stdout:args.includes("--version")?"1.5.0":"ok"})});
  assert.equal(result.status,"PASSED");assert.equal(metadataCalls,3);assert.equal(sleeps,2);
  let calls=0; sleeps=0;
  await assert.rejects(verifyPublishedPackage(options,{fetch:async()=>{calls++;return {ok:false,status:404};},sleep:async()=>{sleeps++;}}),/unavailable/);
  assert.equal(calls,21);assert.equal(sleeps,20);
  calls=0;
  await assert.rejects(verifyPublishedPackage(options,{fetch:async()=>{calls++;return {ok:false,status:401};},sleep:async()=>{throw Error("must not retry");}}),/unavailable/);
  assert.equal(calls,1);
});
