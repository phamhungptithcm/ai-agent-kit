# Product Genesis Control Plane

Product Genesis moves a product from a rough idea to evidence-backed delivery through versioned, human-approved baselines.

## State machine

`IDEA -> DISCOVERY -> RESEARCHED -> BRD_DRAFT -> BRD_APPROVED -> SPEC_DRAFT -> SPEC_APPROVED -> DELIVERY_PLANNED -> IMPLEMENTING -> VERIFIED -> RELEASE_DECISION -> OPERATING`

Allowed exception states are `NEEDS_DECISION`, `CHANGES_REQUESTED`, `PAUSED`, `REJECTED`, and `RETIRED`.

Every transition records the source version, successor version, actor, timestamp, evidence, unresolved decisions, and required next gate. Artifact history is append-only. Corrections create successors; they do not overwrite approved evidence.

## Hard gates

- Research cannot be called validation without direct evidence.
- BRD approval requires a named business authority.
- Specification work requires an approved BRD.
- Delivery planning requires approved BRD and specification baselines.
- Implementation requires the approved delivery scope and implementation approval evidence.
- Material changes require impact analysis and reapproval.
- Release requires acceptance, security, operational, rollback, and environment-specific evidence.

Agents may facilitate, draft, challenge, trace, and recommend. Agents may never impersonate an approver, silently advance a gate, or treat a GitHub issue status as approval.
