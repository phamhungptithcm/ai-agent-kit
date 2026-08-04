# Security and threat model

Replace qualitative requests such as "maximum security" with testable boundaries.

Identify assets, data classification, tenants, human and machine actors, entry points, trust boundaries, privileged operations, external dependencies, abuse cases, regulatory obligations, and incident consequences. Then map controls and verification evidence.

Review identity, phishing-resistant authentication where warranted, authorization at every resource boundary, least privilege, tenant isolation, encryption and key ownership, secret lifecycle, data minimization, residency, retention, deletion, audit integrity, supply chain, dependency trust, network exposure, DDoS and abuse controls, security telemetry, incident response, and recovery.

Zero trust means no implicit trust based only on network location or ownership. It is not a product label. Use threat modeling for design-time decisions and a relevant verification standard such as OWASP ASVS for implementation evidence. Do not claim compliance, certification, or breach resistance from architecture alone.
