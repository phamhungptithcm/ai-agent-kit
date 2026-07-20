# Risk Model

## Low Risk

Examples: documentation, test-only changes, local developer tooling with no production access, copy-only changes.

Agent autonomy: may implement and prepare for review.

## Medium Risk

Examples: internal API changes, business logic, SQL query changes, new dependencies, background jobs, cache behavior, scheduled processing.

Agent autonomy: may implement, but must include tests, operational analysis, and human review.

## High Risk

Examples: authentication, authorization, payment or financial processing, PII or sensitive data, public API compatibility, schema migrations, distributed transaction behavior, IAM, Terraform, Kubernetes production configuration, encryption, key handling.

Agent autonomy: prefer plan-first behavior. Implementation requires explicit human review before merge. Never weaken controls to make tests pass.

## Critical Risk

Examples: direct production datafix, production credential or secret access, destructive production operations, regulated financial adjustment, permanent deletion of regulated data, disabling audit, authorization, encryption, or security monitoring.

Agent autonomy: may analyze and prepare a reviewed procedure only. Do not execute autonomously.
