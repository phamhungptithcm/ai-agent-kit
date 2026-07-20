# AI Agent Prompt Catalog

Use these copy-ready prompts after running bootstrap. Pick the prompt by the work you are doing, paste the ticket or context, and let the agent follow the shared `.ai/` policy.

## Quick Start

Install the kit in a repository:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest bootstrap --yes
```

List prompt names any time:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest prompts
```

Print one prompt:

```bash
npx --yes @hunpeolabs/ai-agent-kit@latest prompt start-task
```

## Prompt Names

| Name | Use When |
| --- | --- |
| `start-task` | A ticket or request is new, broad, risky, or unclear. |
| `plan-change` | Existing behavior may change and implementation must stop before approval. |
| `implement-approved` | A reviewed plan is approved and the agent may edit inside that scope. |
| `fix-bug` | A defect needs root cause, first incorrect state, and regression coverage. |
| `code-quality-review` | A change, file, module, or PR needs stack-aware quality review. |
| `review-pr` | A diff, branch, PR, or MR needs senior engineering review. |
| `investigate-incident` | A production issue needs timeline, impact, evidence, mitigation, and prevention. |
| `prepare-handoff` | Work is ready for PR/MR, Jira, validation, quality gates, and memory-candidate handoff. |

## start-task

```text
Use the start-task skill for this request.

Task or ticket:
[paste request]

Return:
- business outcome
- current understanding
- repository intelligence gate status
- indexed facts and source-code verified facts
- impacted modules, contracts, data, dependencies, and operators
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- risk classification
- smallest safe change
- expected files/classes/functions
- test and quality-gate strategy
- documentation/specification/diagram impact
- deployment and rollback considerations
- whether implementation approval is required

Do not edit files yet if this touches existing application behavior, database behavior, runtime config, infrastructure, public contracts, or behavior-changing tests.
```

## plan-change

```text
Use the change-impact-plan skill for this existing-system change.

Requested change:
[paste requirement]

Produce a concrete change-impact plan and stop before editing files.

Include:
- repository intelligence gate status
- CodeGraph structural impact
- CocoIndex semantic/docs/tests evidence
- current behavior and verified execution flow
- root cause or capability gap
- in scope and out of scope
- change area boundary
- impact boundary
- files explicitly approved for change
- areas requiring developer review before touching
- reason no other area is changed
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- code-quality risks to review: API, database connection lifecycle, transactions, concurrency/deadlock/leak, heap/resource memory, performance
- platform/domain risks to review: web app, mobile app, desktop app, infrastructure, DevOps/release
- proposed solution and alternatives
- callers, consumers, contracts, data, and integrations affected
- security, privacy, transaction, concurrency, and data-integrity impact
- performance and capacity impact
- backward compatibility
- test and regression strategy
- docs/specs/diagrams updates
- deployment, migration, and rollback
- approval decision requested
```

## implement-approved

```text
Use the implement-feature skill for this approved plan.

Approved plan reference:
[paste plan ID/link/approval]

Approved scope:
[paste approved files/modules/behavior]

Acceptance criteria:
[paste criteria]

Implement only inside the approved scope. If you discover material scope, design, risk, dependency, database, infrastructure, or public-contract changes beyond the approved plan, stop and request a delta-impact plan.

Before completion, report:
- approved-plan compliance
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- files changed and why
- tests executed with actual results
- quality gates with PASSED / FAILED / NOT_APPLICABLE / NOT_RUN and evidence
- code quality review evidence from `.ai/templates/code-quality-review.md`
- compatibility impact
- security and performance considerations
- docs/specs/diagrams impact
- deployment and rollback notes
- memory candidates under memory policy, or None
- remaining risks
```

## fix-bug

```text
Use the fix-bug skill for this defect.

Bug:
[paste bug report, logs, screenshots, failing test, or reproduction]

Find:
- repository intelligence gate status
- observed current behavior
- expected behavior
- first incorrect state
- root cause
- impacted callers, data, contracts, jobs, and integrations
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- smallest safe fix
- regression test strategy
- quality gates
- security, data, performance, concurrency, memory/resource lifecycle, and observability impact
- memory candidates, or None

For existing-system changes, stop after the impact plan until approval evidence exists.
```

## code-quality-review

```text
Use the code-quality-review skill for this target.

Review target:
[paste file path, module, branch, diff, PR/MR link, or change summary]

Detect:
- language/version/framework/tooling
- application/platform/domain
- build, test, lint, format, type-check, and security commands
- selected `.ai/quality-profiles/`
- web app, mobile app, desktop app, infrastructure, DevOps, API, database, concurrency, memory/resource, and performance-sensitive areas

Review for:
- clean code and repository conventions
- language/version best practices
- platform/domain best practices
- API compatibility and error/data shape
- database connection/session/cursor lifecycle and transaction safety
- thread/goroutine/task/promise leaks and deadlock risk
- heap retention, cache growth, listener/timer/file/socket cleanup
- performance risks and missing validation evidence

Return `.ai/templates/code-quality-review.md` content with PASSED / FAILED / NOT_APPLICABLE / NOT_RUN statuses and evidence. Do not implement changes unless explicitly asked after this review.
```

## review-pr

```text
Use the code-review skill on this diff.

Review target:
[paste PR/MR link, branch, commit range, or diff summary]

Prioritize:
- correctness
- security
- data integrity
- concurrency and transaction behavior
- backward compatibility
- reliability and failure handling
- performance
- language/version best practices
- platform/domain best practices for web, mobile, desktop, infrastructure, or DevOps
- resource lifecycle, heap retention, and leak risk
- observability
- testing and quality gates
- memory governance

Lead with findings by severity. For each finding include location, problem, production impact, evidence, and recommended correction. Avoid style-only comments unless they hide real risk.
```

## investigate-incident

```text
Use the production-incident skill for this issue.

Incident context:
[paste alert, timeline, symptoms, affected users/systems, logs, or dashboards]

Return:
- repository intelligence gate status
- timeline
- observed impact
- evidence reviewed
- current mitigation
- likely first incorrect state
- candidate causes separated from verified facts
- data/security/customer impact
- immediate containment
- permanent correction options
- prevention and observability improvements
- follow-up owners

Do not access production systems, secrets, customer data, or destructive operations autonomously.
```

## prepare-handoff

```text
Use the delivery-documentation skill to prepare handoff for review.

Work completed:
[paste summary, branch/diff, ticket, or approved plan reference]

Prepare:
- PR/MR description
- Jira completion text if applicable
- approved plan compliance
- actual files changed
- acceptance criteria verification
- tests executed with actual results
- quality gates with status and evidence
- detected language/version/framework/tooling, platform/domain, and selected quality profiles
- code quality review evidence from `.ai/templates/code-quality-review.md`
- security/privacy impact
- performance/concurrency/memory impact
- compatibility and migration impact
- docs/specs/diagrams updates or no-change rationale
- deployment and rollback
- memory candidates under memory policy, or None
- remaining risks and follow-ups

Do not claim Jira, PR/MR, screenshots, PPTX, XLSX, docs, diagrams, or tests exist unless verified.
```
