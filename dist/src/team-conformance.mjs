import crypto from "node:crypto";

import { readTeamContract } from "./team-orchestrator.mjs";
import { findTeamEvent, readTeamEvents, recordTeamEvent, verifyTeamJournal } from "./team-events.mjs";

const ADAPTERS = new Set(["codex", "claude"]);
const REQUIRED_EVENTS = ["TEAM_STARTED", "ASSIGNMENT_DISPATCHED", "RESULT_INGESTED"];
const EVENT_TYPES = new Set([...REQUIRED_EVENTS, "ASSIGNMENT_HEARTBEAT", "TEAM_CANCELLED", "TEAM_RESUMED", "APPROVAL_BLOCKED", "APPROVAL_RECORDED"]);

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safe(value, label) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value ?? "")) throw new Error(`${label} must be a safe identifier`); return value; }
function validHash(value) { return /^[a-f0-9]{64}$/.test(value ?? ""); }

export function buildTeamConformanceTemplate(options = {}) {
  const adapter = String(options.adapter ?? "codex").toLowerCase(); if (!ADAPTERS.has(adapter)) throw new Error("live conformance supports codex or claude");
  return { schema_version: 1, evidence_level: "LIVE_HOST", adapter, host_version: null, task_id: options.id ?? null, run_id: null, observed_at: null, journal_head: null, control_plane_required: false, capabilities_observed: { native_spawn: null, parallel_dispatch: null, cancellation: null, resume: null, structured_result: null, authenticated_host_bridge: null, repository_registry: null, workspace_isolation: null, fencing_tokens: null }, write_assignment_ids: [], lifecycle: [], evidence_hashes: [], notes: "Populate from an actual host run. Set control_plane_required for v1.5 repository-control-plane evidence. A template is NOT_RUN evidence, not a passing result." };
}

export function verifyTeamConformance(attestation, options = {}) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation) || attestation.schema_version !== 1) throw new Error("team conformance attestation is invalid");
  const adapter = String(attestation.adapter ?? "").toLowerCase(); if (!ADAPTERS.has(adapter)) throw new Error("team conformance adapter is invalid");
  if (attestation.evidence_level !== "LIVE_HOST") return { schema_version: 1, status: "NOT_RUN", adapter, evidence_level: attestation.evidence_level ?? null, checks: [{ id: "live-host-evidence", status: "NOT_RUN", reason: "attestation is not marked LIVE_HOST" }] };
  if (!attestation.host_version && (!Array.isArray(attestation.lifecycle) || !attestation.lifecycle.length)) return { schema_version: 1, status: "NOT_RUN", adapter, evidence_level: "LIVE_HOST", checks: [{ id: "live-host-evidence", status: "NOT_RUN", reason: "template has no observed host lifecycle" }] };
  const checks = [];
  const check = (id, passed, reason) => checks.push({ id, status: passed ? "PASSED" : "FAILED", reason: passed ? null : reason });
  check("host-version", typeof attestation.host_version === "string" && Boolean(attestation.host_version.trim()), "host_version is required");
  check("observed-at", Number.isFinite(Date.parse(attestation.observed_at)), "observed_at is invalid");
  check("run-binding", Boolean(attestation.run_id) && Boolean(attestation.task_id), "task_id and run_id are required");
  const lifecycle = Array.isArray(attestation.lifecycle) ? attestation.lifecycle : [];
  check("lifecycle-shape", lifecycle.length > 0 && lifecycle.every((event) => EVENT_TYPES.has(event?.type) && Number.isFinite(Date.parse(event?.timestamp))), "lifecycle events are invalid");
  check("lifecycle-order", lifecycle.every((event, index) => event && Number.isFinite(Date.parse(event.timestamp)) && (index === 0 || (lifecycle[index - 1] && Date.parse(event.timestamp) >= Date.parse(lifecycle[index - 1].timestamp)))), "lifecycle timestamps are out of order");
  for (const type of REQUIRED_EVENTS) check(`event-${type.toLowerCase()}`, lifecycle.some((event) => event.type === type), `${type} was not observed`);
  const dispatches = lifecycle.filter((event) => event.type === "ASSIGNMENT_DISPATCHED");
  const startIndex = lifecycle.findIndex((event) => event.type === "TEAM_STARTED");
  check("start-before-dispatch", startIndex >= 0 && lifecycle.every((event, index) => event.type !== "ASSIGNMENT_DISPATCHED" || index > startIndex), "TEAM_STARTED must precede every dispatch");
  check("external-run-binding", dispatches.length > 0 && dispatches.every((event) => event.assignment_id && (event.external_run_id || event.spawn_id)), "dispatches require assignment and host run or spawn ids");
  const results = lifecycle.map((event, index) => ({ ...event, index })).filter((event) => event.type === "RESULT_INGESTED");
  check("dispatch-result-binding", results.length > 0 && results.every((result) => result.assignment_id && lifecycle.slice(0, result.index).some((event) => event.type === "ASSIGNMENT_DISPATCHED" && event.assignment_id === result.assignment_id)), "every result requires a prior matching dispatch");
  const writeIdsValid = Array.isArray(attestation.write_assignment_ids) && attestation.write_assignment_ids.length <= 100 && new Set(attestation.write_assignment_ids).size === attestation.write_assignment_ids.length && attestation.write_assignment_ids.every((id) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id));
  check("write-assignment-shape", writeIdsValid, "write_assignment_ids must be a bounded safe-id array");
  const writeIds = writeIdsValid ? new Set(attestation.write_assignment_ids) : new Set();
  check("approval-before-write", lifecycle.every((event, index) => event.type !== "ASSIGNMENT_DISPATCHED" || !writeIds.has(event.assignment_id) || lifecycle.slice(0, index).some((prior) => prior.type === "APPROVAL_RECORDED")), "write dispatch occurred before recorded approval");
  check("native-spawn", attestation.capabilities_observed?.native_spawn === true, "native spawn was not observed");
  check("structured-results", attestation.capabilities_observed?.structured_result === true, "structured result capability was not observed");
  check("evidence-hashes", Array.isArray(attestation.evidence_hashes) && attestation.evidence_hashes.length > 0 && attestation.evidence_hashes.every(validHash), "at least one SHA-256 evidence hash is required");
  if (attestation.control_plane_required === true) {
    check("authenticated-host-bridge", attestation.capabilities_observed?.authenticated_host_bridge === true, "authenticated host bridge was not observed");
    check("repository-registry", attestation.capabilities_observed?.repository_registry === true, "repository registry was not observed");
    check("workspace-isolation", attestation.capabilities_observed?.workspace_isolation === true, "isolated workspaces were not observed");
    check("fencing-tokens", attestation.capabilities_observed?.fencing_tokens === true, "fencing tokens were not observed");
    check("dispatch-control-binding", dispatches.every((event) => event.principal_id && event.repository_claim_id && Number.isInteger(event.fencing_token) && event.workspace_hash && event.host_attestation_hash), "control-plane dispatches require identity, claim, fence, workspace, and host attestation bindings");
  }
  if (attestation.capabilities_observed?.parallel_dispatch === true) {
    const parallel = dispatches.some((left, index) => dispatches.slice(index + 1).some((right) => left.wave_id && left.wave_id === right.wave_id));
    check("parallel-wave", parallel, "parallel dispatch was claimed but no shared wave_id was observed");
  }
  if (attestation.capabilities_observed?.cancellation === true) check("cancellation-observed", lifecycle.some((event) => event.type === "TEAM_CANCELLED"), "cancellation was claimed but not observed");
  if (attestation.capabilities_observed?.resume === true) check("resume-observed", lifecycle.some((event) => event.type === "TEAM_RESUMED"), "resume was claimed but not observed");
  if (options.target && attestation.task_id) {
    const journal = verifyTeamJournal({ target: options.target, id: safe(attestation.task_id, "task id") });
    check("journal-chain", journal.status === "VERIFIED", "local journal hash chain is invalid");
    const events = readTeamEvents({ target: options.target, id: attestation.task_id }); const boundIndex = events.findIndex((event) => event.event_hash === attestation.journal_head);
    const suffixIsVerificationOnly = boundIndex >= 0 && events.slice(boundIndex + 1).every((event) => event.type === "CONFORMANCE_RECORDED");
    check("journal-binding", validHash(attestation.journal_head) && suffixIsVerificationOnly, "attestation journal head is missing or stale after team state changed");
    try { const team = readTeamContract({ target: options.target, id: attestation.task_id }); check("run-id-match", team.run?.run_id === attestation.run_id, "attested run_id does not match the team contract"); } catch (error) { check("run-id-match", false, error.message); }
  }
  const result = { schema_version: 1, status: checks.every((item) => item.status === "PASSED") ? "PASSED" : "FAILED", adapter, evidence_level: "LIVE_HOST", attestation_hash: digest(attestation), checks };
  if (options.target && attestation.task_id) {
    try {
      const existing = findTeamEvent({ target: options.target, id: attestation.task_id, type: "CONFORMANCE_RECORDED", match: { evidence_hash: result.attestation_hash } });
      if (!existing) recordTeamEvent({ target: options.target, id: attestation.task_id, type: "CONFORMANCE_RECORDED", data: { adapter, status: result.status, conformance_level: "LIVE_HOST", run_id: attestation.run_id ?? null, journal_head: attestation.journal_head ?? null, evidence_hash: result.attestation_hash } });
      result.journal_status = existing ? "ALREADY_RECORDED" : "RECORDED";
    } catch { result.journal_status = "UNAVAILABLE"; }
  }
  return result;
}
