# Engineering Rules

required_review:

* "Prefer the smallest safe change that fully satisfies the requirement."
* "Preserve existing behavior unless the task explicitly requires behavioral changes."
* "Understand the surrounding implementation before modifying code."
* "Follow established repository architecture, coding conventions, and design patterns before introducing new abstractions."
* "Prefer consistency with the existing codebase over introducing newer patterns without clear justification."
* "Avoid unrelated refactoring during scoped bug fixes or feature implementation."
* "Separate cleanup and refactoring from functional changes whenever practical."
* "Keep functions, classes, and modules cohesive with a single clear responsibility."
* "Avoid unnecessary abstraction, indirection, inheritance, or framework usage."
* "Remove duplicated logic only when it improves maintainability without reducing readability."

compatibility:

* "Analyze backward compatibility before modifying public APIs, shared libraries, serialized data, database objects, configuration, or integrations."
* "Do not rename public contracts, package names, database objects, API fields, event schemas, message formats, or configuration keys without documented impact analysis."
* "Preserve wire compatibility, serialization formats, and consumer expectations unless an approved breaking change exists."
* "Document migration strategy for consumer-visible changes."

correctness:

* "Understand and fix the root cause instead of masking symptoms."
* "Do not add null checks without identifying why the null or invalid state occurs."
* "Do not suppress compiler warnings, lint errors, or static analysis findings without documented justification."
* "Do not introduce TODO-based functional behavior unless explicitly requested."
* "Preserve business invariants and domain rules."

generated_code:

* "Do not modify generated files directly."
* "Modify the authoritative source and regenerate generated artifacts."
* "Verify generated artifacts remain synchronized."

error_handling:

* "Never swallow exceptions."
* "Preserve original failure context when rethrowing or translating exceptions."
* "Do not expose sensitive information through exceptions, logs, or responses."
* "Use domain-specific exceptions where appropriate."
* "Provide actionable error messages for operators without leaking implementation details."

resilience:

* "Define timeout, retry, circuit breaker, cancellation, and fallback behavior for external calls where applicable."
* "Do not add retries without proving retry safety and idempotency."
* "Avoid retry storms, cascading failures, and infinite retry loops."
* "Respect cancellation, deadlines, and resource cleanup."

concurrency:

* "Review thread safety, shared mutable state, synchronization, and race conditions."
* "Review deadlock, livelock, starvation, and resource contention risks."
* "Avoid blocking asynchronous execution unnecessarily."
* "Protect against duplicate processing where concurrency exists."

performance:

* "Review algorithmic complexity before introducing expensive operations."
* "Avoid unnecessary allocations, serialization, reflection, database round trips, and network calls."
* "Prefer streaming or batching for large datasets."
* "Measure before optimizing performance-critical paths."

security:

* "Validate all untrusted input."
* "Apply least privilege."
* "Protect secrets and sensitive information."
* "Review authorization at resource boundaries."
* "Avoid introducing insecure defaults."

configuration:

* "Do not hardcode environment-specific values."
* "Prefer configuration over code changes for operational settings."
* "Validate configuration at startup where practical."

observability:

* "Maintain meaningful logs, metrics, traces, and correlation identifiers."
* "Log significant failures once at the appropriate layer."
* "Avoid duplicate logging across layers."

testing:

* "Update affected unit, integration, contract, or end-to-end tests when behavior changes."
* "Avoid changing tests solely to satisfy broken implementations."
* "Verify both success and failure scenarios."

documentation:

* "Update documentation when implementation changes affect users, operators, APIs, configuration, or deployment."
* "Document assumptions, limitations, and operational impacts."

agent_constraints:

* "Do not invent missing business rules."
* "Do not silently change behavior to make tests pass."
* "Do not replace existing architecture without explicit approval."
* "Do not introduce unnecessary dependencies."
* "Do not claim code was executed, tested, benchmarked, or deployed without verifiable evidence."
* "Clearly distinguish verified facts from assumptions."
