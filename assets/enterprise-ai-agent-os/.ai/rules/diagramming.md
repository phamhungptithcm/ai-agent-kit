# Diagramming Rules

required_review:
  - "Treat diagrams as authoritative technical documentation when they describe architecture, behavior, data flow, deployment, integrations, or operational processes."
  - "Use text-based diagram sources (Mermaid, PlantUML, Structurizr DSL, Graphviz, etc.) whenever practical."
  - "Store editable diagram source alongside repository documentation; avoid screenshot-only diagrams."
  - "Keep diagrams synchronized with implementation, specifications, APIs, database schema, and operational behavior."
  - "Update affected diagrams in the same change set as implementation changes or explicitly document why no diagram update is required."
  - "Choose the appropriate diagram type based on the problem being explained."
  - "Keep diagrams focused; avoid unnecessary implementation details or visual clutter."
  - "Maintain consistent naming, terminology, icons, colors, and notation across repository diagrams."
  - "Reference diagrams from the relevant README, design document, ADR, API specification, runbook, or operational documentation."
  - "Validate that diagrams accurately reflect the implemented behavior before claiming they are updated."
  - "Do not create diagrams that speculate about production topology, infrastructure, ownership, integrations, or operational behavior."
  - "Clearly distinguish planned, proposed, current, and deprecated architecture."
  - "Mark assumptions, placeholders, and unknown components explicitly."
  - "Version diagram source together with the code and documentation it describes."

diagram_selection:
  sequence:
    - "Request/response flow"
    - "Retries"
    - "Async messaging"
    - "Workflow orchestration"
    - "Failure handling"

  component:
    - "Service boundaries"
    - "Module dependencies"
    - "External integrations"

  deployment:
    - "Infrastructure topology"
    - "Runtime placement"
    - "Containers"
    - "Clusters"
    - "Cloud resources"

  data_flow:
    - "Sensitive data movement"
    - "Financial transactions"
    - "Message routing"
    - "Data ownership"

  state:
    - "Entity lifecycle"
    - "Workflow status transitions"
    - "Long-running processes"

  class:
    - "Domain models"
    - "Inheritance"
    - "Extension points"
    - "Key object relationships"

  er:
    - "Database schema"
    - "Relationships"
    - "Cardinality"

  c4:
    - "System Context"
    - "Container"
    - "Component"
    - "Code-level architecture"

  activity:
    - "Business process"
    - "Decision flow"

  timing:
    - "Latency analysis"
    - "Concurrent operations"

quality:
  - "Show only information relevant to the intended audience."
  - "Avoid crossing lines and unnecessary visual complexity."
  - "Clearly label protocols, message types, APIs, queues, databases, and external systems."
  - "Use directional arrows consistently."
  - "Identify trust boundaries and security-sensitive data flows."
  - "Indicate synchronous vs asynchronous communication."
  - "Show retry, timeout, circuit breaker, and failure paths when architecturally significant."

agent_constraints:
  - "Never invent services, databases, queues, APIs, or infrastructure not supported by repository evidence."
  - "Do not infer production topology from development configuration alone."
  - "Do not claim a diagram has been updated unless the corresponding source file was modified."
  - "Prefer updating existing diagrams over creating duplicate documentation."
  - "If implementation and diagram conflict, identify the inconsistency instead of silently changing one."

architecture_traceability:
  - "Significant architecture changes should update both diagrams and the associated ADR/design document."
  - "Every architecture diagram should identify its source document and last verified implementation revision when available."