---
name: governed-action-gateway
description: Authorize and verify governed agent actions through one capability-bound decision and receipt gateway.
---

# Governed Action Gateway

Read `.ai/core/universal-action-gateway.md` and
`.ai/workflows/authorize-governed-action.md`.

Use the gateway for every tool action when `AI_AGENT_KIT_TASK_ID` enables
governed mode. Never execute `ask` or `deny`. Never reuse a decision after the
envelope, capability, approval, commit, policy revision, adapter, or expiry
changes.

Record execution and verification receipts without raw secrets or resource
contents.
