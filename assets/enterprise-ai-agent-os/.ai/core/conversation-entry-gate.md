# Conversation Entry Gate

Run this gate before Repository Intelligence or any task-specific workflow. Its
purpose is to distinguish a greenfield product conversation from work on an
existing system without requiring the user to name a skill or version.

1. Inspect Product Workspace state with `ai-agent-kit product discover`.
2. Classify the current request with `ai-agent-kit intent detect`. Prefer the
   in-process or stdin interface so the request is not duplicated in shell
   history. Do not persist the raw request in routing evidence.
3. Follow the returned action:
   - `START_PRODUCT_GENESIS`: invoke `run-product-genesis`, then create the
     immutable Idea v1 workspace. Do not start implementation.
   - `RESUME_PRODUCT_GENESIS`: run `product resume --id <product-id>`, then
     `product next --id <product-id>` and invoke the returned stage skill.
   - `SELECT_PRODUCT` or `SELECT_OR_START_PRODUCT`: ask one short selection or
     confirmation question. Do not guess or create a workspace yet.
   - `START_EXISTING_SYSTEM_WORKFLOW`: run Repository Intelligence and continue
     with the existing-system workflow.
   - `ABSTAIN`: use normal skill routing. Ask one short clarification only when
     the task cannot safely proceed.
   - `REPAIR_PRODUCT_WORKSPACE`: stop Product Genesis progression and report
     the exact workspace-integrity problem.
4. Show the selected mode, reason codes, next action, and whether any artifact
   was created. Never claim deterministic enforcement on a host that provides
   only advisory instructions and no supported prompt or session hook.

Auto-entry selects a workflow only. It never supplies human approval, authorizes
implementation, creates GitHub issues, commits, pushes, deploys, publishes, or
releases. All Product Genesis exact-hash approval and evidence gates remain in
force.
