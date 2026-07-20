---
name: repository-intelligence
description: Establish verified repository understanding before any engineering activity. Coordinate CodeGraph, CocoIndex, source code, and repository metadata to provide evidence-driven context for planning, implementation, review, debugging, documentation, and multi-agent execution.
---

# Repository Intelligence

## Purpose

Repository Intelligence is the mandatory entry point for all repository-based engineering work.

Its objectives are to:

- establish repository context
- minimize hallucination
- reduce unnecessary file reading
- coordinate multiple agents
- provide evidence for engineering decisions

Every repository task begins here.

---

# Repository Intelligence Gate (Required)

Execute:

```bash
python .ai/scripts/check-repository-intelligence.py
```

Interpret the result.

## READY

Continue.

---

## STALE

Repository indexes require refresh.

Execute:

```bash
python .ai/scripts/refresh-repository-index.py
```

or report that refresh is required.

---

## BLOCKED

Stop repository work.

Only troubleshoot:

- CodeGraph
- CocoIndex

or report the exact recovery commands from the gate output.

Never continue repository analysis while blocked.

---

# Repository Lifecycle

Every repository task follows this lifecycle.

```
Repository Intelligence
        ↓
Repository Discovery
        ↓
Evidence Collection
        ↓
Focused Source Verification
        ↓
Engineering Task
        ↓
Validation
        ↓
Repository Synchronization
```

All engineering skills inherit this lifecycle.

---

# Repository Discovery

Automatically determine:

- repository type
- language(s)
- framework(s)
- runtime(s)
- architecture
- deployment model
- build tooling
- package manager
- testing framework
- quality profiles

Identify:

- application
- platform
- business domain

---

# Evidence Sources

Repository evidence has the following precedence.

## Level 1

Source Code

Highest authority.

---

## Level 2

CodeGraph

Structural relationships.

Examples:

- symbols
- callers
- callees
- dependency graph
- APIs
- services
- repositories
- jobs
- schedulers
- event flows

---

## Level 3

CocoIndex

Semantic understanding.

Examples:

- documentation
- specifications
- ADRs
- runbooks
- release notes
- terminology
- implementation history

---

## Level 4

Repository Metadata

Examples:

- CI
- build files
- manifests
- deployment configuration

---

## Level 5

Human assumptions

Lowest authority.

Always identify assumptions explicitly.

---

# Retrieval Strategy

Retrieve only what is required.

## Step 1

Query CodeGraph.

Identify:

- architecture
- modules
- callers
- consumers
- APIs
- persistence
- dependency graph
- impacted symbols
- blast radius

---

## Step 2

Query CocoIndex.

Retrieve:

- requirements
- specifications
- ADRs
- runbooks
- design docs
- tests
- historical implementations

---

## Step 3

Open only repository paths supported by index evidence.

---

## Step 4

Verify critical implementation against source code.

---

## Step 5

Expand source reading only when:

- indexes are stale
- evidence conflicts
- line-level verification is required
- implementation differs from documentation

Avoid repository-wide scanning.

---

# Evidence Classification

Separate all information into:

## Repository Evidence

Supported by CodeGraph or CocoIndex.

---

## Source-Code Evidence

Verified directly from implementation.

---

## Runtime Evidence

Observed through execution.

---

## Assumptions

Clearly marked assumptions.

---

## Unknowns

Missing information.

Never infer unknowns.

---

# Confidence

Classify confidence:

- High
- Medium
- Low

Low confidence requires additional verification.

---

# Multi-Agent Coordination

Before delegating:

Generate

```
.ai/templates/repository-intelligence-brief.md
```

The brief should contain:

- repository summary
- architecture
- impacted modules
- entry points
- APIs
- services
- persistence
- call paths
- affected symbols
- tests
- documentation
- diagrams
- assumptions
- unknowns

Subagents inherit the shared brief.

They should query CodeGraph and CocoIndex only for role-specific gaps.

Avoid duplicate repository exploration.

---

# Existing-System Workflow

Mandatory workflow:

```
Repository Intelligence
↓
Repository Discovery
↓
Evidence Collection
↓
Impact Assessment
↓
Design
↓
Implementation Plan
↓
Human Approval
↓
Implementation
↓
Validation
↓
Repository Synchronization
↓
Independent Review
↓
Delivery
```

Protected files must never be modified before approval.

---

# Repository Synchronization

Refresh indexes **only if** changes affect:

- symbols
- APIs
- architecture
- documentation
- diagrams
- repository relationships

Otherwise report:

```
Index refresh not required.
```

---

# Stopping Conditions

Immediately stop repository work when:

- Repository Gate reports BLOCKED
- required indexes are unavailable
- repository evidence conflicts
- approval is missing
- implementation exceeds approved scope

Report the exact blocking reason.

---

# Deliverables

Every Repository Intelligence session should produce:

1. Repository Discovery
2. Repository Health
3. Repository Evidence
4. Impacted Modules
5. Entry Points
6. Dependency Graph Summary
7. Documentation Summary
8. Test Summary
9. Assumptions
10. Unknowns
11. Confidence Assessment
12. Repository Brief (if multi-agent)

Never present assumptions as repository facts.