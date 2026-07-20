---
name: jira-completion-package
description: Prepare a complete Jira-ready implementation summary based entirely on verified repository evidence. Produce review-ready completion comments, validation summaries, deployment guidance, and implementation traceability. Never update Jira without verified authorization and connector support.
---

# Jira Completion Package

## Purpose

Prepare a complete engineering completion package suitable for:

- Jira
- Azure DevOps
- GitHub Issues
- GitLab Issues

The package should accurately summarize implementation work, validation, operational readiness, and remaining risks.

Never fabricate implementation evidence or external updates.

---

# Repository Intelligence Gate (Required)

When summarizing repository work:

1. Execute the Repository Intelligence Gate.
2. Use the `repository-intelligence` skill.
3. Collect repository evidence from:

- CodeGraph
- CocoIndex
- ADRs
- RFCs
- DESIGN.md
- ARCHITECTURE.md
- Existing diagrams
- Test reports
- Quality reports
- CI results
- Deployment documentation

Use:

- CodeGraph to identify changed modules, affected components, dependency impact, APIs, persistence, and implementation scope.
- CocoIndex to locate specifications, documentation, acceptance criteria, historical context, and architectural decisions.

Every statement must be supported by repository evidence.

---

# Implementation Summary

Summarize:

- business objective
- implementation scope
- approved plan
- implemented solution
- impacted components
- architecture impact

Do not describe work that was not completed.

---

# Root Cause / Change Rationale

Include either:

- verified Root Cause Analysis (for defects)

or

- implementation rationale (for planned work)

Support conclusions with repository evidence.

---

# Merge Request / Pull Request

Report:

- verified PR/MR link
- current review state
- merge status

If none exists, explicitly state:

```
No verified PR/MR exists.
```

Never invent repository URLs.

---

# Acceptance Criteria

For each criterion:

- Status
- Supporting evidence
- Validation reference

Allowed statuses:

- PASSED
- FAILED
- PARTIALLY COMPLETE
- NOT VERIFIED

---

# Validation Summary

Include:

- executed tests
- CI evidence
- manual validation
- regression testing
- quality gates
- executed commands
- actual results

Never claim validation passed unless verified.

---

# Documentation Synchronization

Report updates to:

- README
- DESIGN.md
- ARCHITECTURE.md
- ADR
- API specifications
- diagrams
- runbooks

If no updates were required, provide a clear rationale.

---

# Demo Package

Report:

- PPTX location
- XLSX location
- validation artifacts
- screenshot plan

If artifacts were not generated:

Provide source outlines only.

---

# Screenshot Plan

Generate a Markdown table containing:

- Screenshot ID
- Screen
- Purpose
- Preconditions
- Capture Instructions

Screenshots remain manual placeholders.

Never fabricate images.

---

# Deployment Summary

Summarize:

- deployment sequence
- feature flags
- migrations
- configuration
- monitoring
- post-deployment validation

---

# Rollback Summary

Describe:

- rollback conditions
- rollback steps
- irreversible changes

If rollback limitations exist, document them.

---

# Remaining Risks

Report:

- technical risks
- operational risks
- deployment risks
- known limitations
- unresolved issues

Separate verified risks from assumptions.

---

# Follow-up Work

Identify:

- remaining tasks
- technical debt
- deferred work
- known improvements

Include owners when known from repository evidence.

---

# Traceability

Verify traceability between:

- approved implementation plan
- changed files
- documentation
- tests
- quality gates
- deployment artifacts

Missing traceability should be reported.

---

# Jira Update Rules

Never transition or update Jira unless all of the following are verified:

- issue key
- workflow state
- permissions
- approved connector
- successful API response

Otherwise generate copy-ready Markdown only.

Never claim Jira was updated without confirmation.

---

# Deliverables

Every completion package should contain:

1. Executive Summary
2. Repository Evidence
3. Implementation Summary
4. Root Cause / Change Rationale
5. Acceptance Criteria
6. Validation Summary
7. Documentation Updates
8. Demo Package
9. Deployment Summary
10. Rollback Summary
11. Remaining Risks
12. Follow-up Work
13. Traceability
14. Jira Update Status

Separate:

- Verified Facts
- Assumptions
- Unknowns

Never present assumptions as completed work.