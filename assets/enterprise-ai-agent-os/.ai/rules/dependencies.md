# Dependency Rules

required_review:
  - "Do not introduce new dependencies without documented business or technical justification."
  - "Prefer existing repository dependencies, shared libraries, platform capabilities, or standard libraries before adding new packages."
  - "Review project consistency; avoid introducing multiple libraries that solve the same problem."
  - "Review package maturity, maintenance activity, release cadence, community adoption, and long-term support."
  - "Review license compatibility with organizational and commercial requirements."
  - "Review known security vulnerabilities (CVEs), supply-chain risk, package reputation, and publisher trust."
  - "Review transitive dependency graph and dependency size before introducing new packages."
  - "Minimize dependency footprint; avoid unnecessary transitive dependencies."
  - "Pin or constrain dependency versions according to repository dependency management strategy."
  - "Avoid floating versions or uncontrolled automatic upgrades."
  - "Verify compatibility with the project's language runtime, framework version, and build tooling."
  - "Avoid dependencies requiring production credentials, privileged filesystem access, elevated permissions, or unreviewed external services."
  - "Avoid runtime network downloads, install scripts, self-updating packages, or remote code execution during build or startup unless explicitly approved."
  - "Review startup time, memory usage, binary size, build time, and runtime performance impact."
  - "Review operational impact including deployment size, container image growth, and cold-start performance."
  - "Review configuration, secrets, environment variables, certificates, and infrastructure requirements introduced by the dependency."
  - "Document dependency purpose, alternatives considered, expected benefits, risks, and rollback strategy."
  - "Remove unused or obsolete dependencies when practical."
  - "Ensure dependency lock files remain consistent with declared dependencies."
  - "Update SBOM, dependency inventory, or software composition records where required."

supply_chain:
  - "Prefer official package registries and verified publishers."
  - "Avoid abandoned or unmaintained projects."
  - "Review package signing, provenance, and integrity verification when supported."
  - "Review dependency provenance before introducing forks or unofficial mirrors."
  - "Avoid packages with excessive or unnecessary permissions."
  - "Review post-install, pre-install, and build scripts for unexpected behavior."

versioning:
  - "Prefer organization-approved versions."
  - "Follow repository dependency management conventions (BOM, Gradle Version Catalog, npm lockfile, etc.)."
  - "Avoid multiple major versions of the same library."
  - "Review compatibility with existing dependency graph."

agent_constraints:
  - "Do not install packages automatically unless explicitly requested."
  - "Do not modify dependency versions solely to resolve unrelated build failures."
  - "Do not replace core framework libraries without explicit approval."
  - "Do not remove dependencies without verifying active usage."
  - "If dependency changes affect production behavior, explicitly identify all impacted components."