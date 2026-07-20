# Documentation Rules

required_review:

* "Update documentation whenever behavior, configuration, commands, workflows, deployment procedures, operational procedures, public contracts, architecture, or risk assumptions change."
* "Treat documentation changes as part of the implementation, not as optional follow-up work."
* "Inspect relevant README files, design documents, ADRs, runbooks, API specifications, diagrams, examples, and operator guides for every material change."
* "Update affected documentation in the same change set as the implementation, or provide a specific and evidence-based no-change rationale."
* "Keep documentation consistent with the actual implementation, configuration, supported versions, and validated operational behavior."
* "Do not document behavior as supported unless it is implemented or explicitly identified as proposed."
* "Clearly distinguish current, proposed, deprecated, experimental, and unsupported behavior."
* "Do not invent business rules, system ownership, environment details, deployment topology, production procedures, support contacts, SLAs, or operational guarantees."
* "When project context is unresolved, record it explicitly using TODO(owner): description."
* "Use a real team, role, or accountable owner in TODO(owner) when known; do not invent an owner."
* "Include enough context in TODO entries to explain the unresolved decision, impact, and expected resolution."
* "Do not silently resolve ambiguous business or operational requirements through documentation."
* "Prefer canonical documentation over duplicated content."
* "Keep root-level instruction files compact and route agents and contributors to shared policies under .ai/ or the repository-defined policy location."
* "Prefer links to canonical .ai/ files over copying complete policy sections into multiple files."
* "When duplication is necessary for usability, keep the canonical source clearly identified and minimize copied content."
* "Avoid documentation that depends on local knowledge, undocumented manual steps, or implicit environment assumptions."
* "Use executable or verifiable examples where practical."
* "Verify commands, paths, configuration names, environment variables, URLs, ports, and code examples before documenting them as working."
* "Do not claim commands, migrations, deployments, tests, or procedures were executed without verifiable evidence."
* "Document prerequisites, required permissions, expected outputs, failure conditions, and recovery steps for operational procedures."
* "Document security, privacy, compliance, financial, and data-handling implications where relevant."
* "Remove or update stale instructions when the underlying behavior is replaced or deprecated."
* "Preserve historical decisions in ADRs or version history instead of leaving conflicting active instructions."
* "Link documentation to relevant code, specifications, APIs, diagrams, work items, and runbooks where useful."
* "Use consistent terminology, naming, capitalization, and domain language across documentation."
* "Avoid embedding secrets, credentials, internal tokens, private keys, sensitive production data, or unmasked PII in documentation or examples."
* "Use sanitized and clearly synthetic examples for sensitive, financial, regulated, or production-like data."
* "Attribute adapted third-party content and preserve required copyright, license, and notice information."
* "Verify that third-party content licenses permit modification, redistribution, and repository inclusion."
* "Do not vendor external reference repositories, copied documentation sets, or large third-party examples into the repository."
* "Link to approved external references or summarize only the necessary guidance with attribution."
* "Review external links for authority, stability, security, and long-term usefulness."
* "Document known limitations, unresolved risks, assumptions, and manual steps explicitly."
* "Ensure documentation remains readable for its intended audience and does not expose unnecessary implementation detail."

structure:
canonical_locations:
root_files:
purpose:
- "Repository entry point"
- "Essential contributor commands"
- "Links to canonical policies"
constraints:
- "Keep concise"
- "Avoid duplicating detailed shared policy"

```
ai_policy:
  preferred_path: ".ai/"
  purpose:
    - "Shared AI-agent instructions"
    - "Quality profiles"
    - "Security and delivery rules"
    - "Reusable workflows"
    - "Project context"

design_docs:
  purpose:
    - "System design"
    - "Behavioral decisions"
    - "Trade-offs"
    - "Interfaces"
    - "Migration strategy"

adr:
  purpose:
    - "Significant architecture decisions"
    - "Alternatives considered"
    - "Decision rationale"
    - "Consequences"

runbooks:
  purpose:
    - "Operational procedures"
    - "Troubleshooting"
    - "Recovery"
    - "Escalation"
    - "Validation"
```

todo_format:
syntax: "TODO(owner): description"
requirements:
- "State the unresolved issue clearly."
- "Identify the affected component or workflow."
- "Explain the impact when material."
- "Identify the expected decision or evidence needed."
- "Do not invent an owner."
example: "TODO(platform-team): Confirm whether the production deployment requires a manual database approval gate."

evidence_rules:

* "Repository content, validated command output, approved specifications, and authenticated system results are acceptable evidence."
* "Source code alone is not evidence that an operational procedure succeeded."
* "Test source code alone is not evidence that tests passed."
* "Configuration alone is not evidence of production topology."
* "Label inference, assumptions, and proposed behavior explicitly."
* "Do not replace known facts with generic placeholders."

external_content:

* "Prefer linking to official or organization-approved sources."
* "Record the source and license for adapted content."
* "Avoid copying entire external guides when a concise attributed summary is sufficient."
* "Do not add git submodules, archives, mirrors, or copied reference repositories solely for documentation."
* "Do not rely on external content that may disappear without recording the essential local decision or procedure."

agent_constraints:

* "Do not create documentation for systems, endpoints, environments, or workflows unsupported by repository evidence."
* "Do not infer production procedures from local development scripts."
* "Do not overwrite project-specific instructions with generic best practices."
* "Do not remove existing documentation without checking whether it is referenced elsewhere."
* "Do not mark documentation complete while known contradictions remain."
* "When implementation and documentation conflict, report the inconsistency and determine the authoritative source from evidence."
* "Prefer modifying the existing canonical document over creating a competing document."
* "Do not perform broad documentation rewrites unrelated to the requested change."
* "Preserve meaningful project history, decisions, and operational warnings."
