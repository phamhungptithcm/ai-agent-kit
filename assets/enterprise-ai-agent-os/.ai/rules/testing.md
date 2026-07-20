# Testing Rules

required_review:

* "Treat testing as validation of behavior, not implementation."
* "Add or update tests whenever behavior changes."
* "Add a regression test for every bug fix whenever feasible."
* "Select the appropriate test level (unit, integration, contract, end-to-end, performance, security) based on the change."
* "Prioritize test coverage according to business, operational, and security risk."

coverage:
review:
- "Happy path"
- "Input validation failures"
- "Authorization and authentication failures"
- "Business rule failures"
- "Boundary conditions"
- "Edge cases"
- "Null and invalid inputs"
- "Timeout and retry scenarios"
- "Concurrency scenarios where applicable"
- "Failure and recovery paths"

test_types:
unit:
- "Pure business logic"
- "Algorithms"
- "Utility functions"
- "Domain rules"

integration:
- "Database interactions"
- "Messaging"
- "External services"
- "Persistence"
- "Framework integration"

contract:
- "Public APIs"
- "Service interfaces"
- "Message schemas"
- "Consumer/provider compatibility"

end_to_end:
- "Critical user workflows"
- "Business transactions"

performance:
- "Latency-sensitive paths"
- "Large datasets"
- "High-throughput operations"

security:
- "Authentication"
- "Authorization"
- "Input validation"
- "Injection protection"
- "Sensitive data handling"

quality:

* "Write behavior-oriented tests rather than implementation-oriented tests."
* "Avoid tests that only mirror internal implementation details."
* "Keep tests deterministic, repeatable, and isolated."
* "Do not depend on production systems, production data, wall-clock timing, external network availability, or execution order."
* "Use mocks, fakes, stubs, or test containers only where appropriate."
* "Avoid excessive mocking that reduces confidence in behavior."
* "Prefer realistic integration testing for critical business flows."

regression:

* "Ensure previously fixed defects remain covered."
* "Protect against recurrence of production incidents."
* "Expand regression coverage when root causes affect multiple scenarios."

compatibility:

* "Update contract tests when public interfaces change."
* "Verify backward compatibility where required."
* "Validate serialization, API, event, and schema compatibility."

data:

* "Use representative but synthetic test data."
* "Never include production secrets, credentials, PII, financial data, or regulated information."
* "Keep test fixtures minimal and maintainable."

performance_validation:

* "Review performance impact for production-critical changes."
* "Validate large data volumes where applicable."
* "Review memory, CPU, database, and network behavior."

evidence:

* "Report executed test suites and observed results."
* "Explicitly identify tests that were skipped, unavailable, not applicable, or not executed."
* "Do not claim tests passed unless execution was observed."
* "Clearly distinguish implemented tests from recommended future tests."

agent_constraints:

* "Do not weaken, remove, disable, or rewrite tests solely to make the implementation pass."
* "If a test changes, explain the behavioral reason."
* "Do not modify assertions to hide regressions."
* "Do not fabricate coverage numbers, CI results, benchmark results, or execution evidence."
* "Do not mark validation complete when required testing could not be performed."
* "Clearly state assumptions, limitations, and remaining validation gaps."


validation_gates:
  - "Critical business logic requires unit and integration validation."
  - "Public API changes require contract validation."
  - "Database migrations require migration and rollback validation."
  - "Security-sensitive changes require security regression validation."
  - "Performance-sensitive changes require performance verification."
  - "Production incidents should result in permanent regression coverage."

quality_gates:
  - "New functionality should not reduce existing test coverage without justification."
  - "Flaky tests should be identified and fixed rather than ignored."
  - "Failing tests should be investigated before being disabled."