# API Design Rules

required_review:
  - "Use explicit request and response DTOs; never expose persistence/domain entities directly."
  - "Validate all external input at API boundaries (required fields, format, length, range, enums, business constraints)."
  - "Return standardized error responses with stable error codes; never expose stack traces, SQL, infrastructure details, or internal exceptions."
  - "Keep APIs backward compatible whenever possible; analyze all existing consumers before modifying public or shared contracts."
  - "Treat changes to URLs, HTTP methods, payloads, headers, query parameters, status codes, pagination, sorting, filtering, serialization, and validation rules as potential breaking changes."
  - "Require explicit versioning or migration strategy for breaking changes."
  - "Preserve API idempotency where required (PUT, DELETE, retryable POST operations, payment/order processing)."
  - "Review authentication, authorization, and permission boundaries for every new or modified endpoint."
  - "Evaluate rate limiting, abuse protection, replay protection, and denial-of-service implications."
  - "Protect sensitive information in requests, responses, logs, metrics, traces, and error messages."
  - "Review caching behavior (Cache-Control, ETag, conditional requests) and cache invalidation impacts."
  - "Review timeout, retry, circuit breaker, and partial failure behavior for downstream service calls."
  - "Review pagination, filtering, sorting, and search APIs for scalability; avoid returning unbounded collections."
  - "Review API performance, payload size, serialization cost, N+1 calls, and unnecessary network round trips."
  - "Ensure deterministic response contracts, field naming consistency, null handling, default values, and date/time formats."
  - "Review concurrency implications, optimistic locking, duplicate requests, and race conditions."
  - "Review transactional consistency when multiple services or databases are involved."
  - "Generate OpenAPI/Swagger documentation that matches the implementation."
  - "Document consumer-visible behavior changes, deprecations, migration steps, and rollout strategy."
  - "Include representative success, validation failure, authorization failure, conflict, and server error examples."

api_contract:
  compatibility:
    - "Never remove or rename public fields without versioning."
    - "Never change field semantics while keeping the same name."
    - "New response fields must be optional unless versioned."
    - "Avoid changing numeric precision, enum values, or serialization formats."
    - "Preserve field ordering only if required by existing consumers."

http_semantics:
  - "Use HTTP methods according to RFC semantics."
  - "Return appropriate status codes (200, 201, 202, 204, 400, 401, 403, 404, 409, 412, 422, 429, 500...)."
  - "Use Location header for resource creation."
  - "Support correlation/request IDs."

security:
  - "Validate authorization at the resource level, not only endpoint level."
  - "Never trust client-provided identifiers or ownership."
  - "Review injection, mass assignment, SSRF, XXE, deserialization, and path traversal risks."
  - "Mask PII and secrets in logs."

observability:
  - "Emit structured logs with correlation IDs."
  - "Expose metrics for latency, throughput, failures, retries, and throttling."
  - "Add distributed tracing for cross-service requests."

testing:
  - "Update API contract tests."
  - "Update consumer-driven contract tests when applicable."
  - "Verify backward compatibility with existing clients."
  - "Include negative, authorization, validation, concurrency, and idempotency tests."