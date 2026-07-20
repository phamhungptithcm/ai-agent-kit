---
name: test-strategy
description: Design a risk-based test strategy for a change, bug fix, PR, release, or incident follow-up using existing repository test conventions.
---

# Test Strategy

Use this skill before implementation, during QA review, or when preparing handoff.

## Required Work

1. Use repository intelligence to identify affected modules, callers, contracts, data, integrations, and regression-sensitive flows.
2. Inspect existing tests and test commands from `.ai/context/build-test-commands.md` plus repo config.
3. Classify risk by correctness, security, data integrity, compatibility, performance, concurrency, migration, observability, and release impact.
4. Define the smallest useful test set: unit, integration, contract, e2e, migration, performance, security, and manual checks as applicable.
5. Identify test data, mocks/stubs, fixtures, environments, and flaky-test risks.

## Output

Report test scope, commands, expected evidence, tests to add/update, manual validation, gaps, `NOT_RUN` rationale, and release-blocking risks.
