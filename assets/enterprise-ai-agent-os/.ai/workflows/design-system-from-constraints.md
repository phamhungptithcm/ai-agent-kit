# Design a System from Constraints

1. Activate `design-scalable-systems` automatically for architecture, scale, latency, reliability, security, data, or cost intent.
2. Inspect repository evidence and compile the current architecture before proposing a target.
3. Normalize the request into `.ai/templates/system-design-request.yaml`.
4. Ask at most three architecture-changing questions; otherwise create explicit scenarios.
5. Run the deterministic capacity model and keep missing evidence unavailable.
6. Lookup only current official pricing needed by known provider, region, and candidate components. Continue in degraded mode when lookup is unavailable.
7. Compare smallest viable, recommended target, and justified extreme-scale options.
8. Select one recommendation and document trade-offs, diagram, capacity, cost, failure behavior, security boundaries, evolution triggers, and validation.
9. Run the system-design profile review. Fix contradictions, fabricated precision, premature complexity, missing failure paths, and unsupported claims.
10. Stop at `READY_FOR_REVIEW`; obtain separate approval before implementation, provisioning, paid tests, deployment, or external actions.
