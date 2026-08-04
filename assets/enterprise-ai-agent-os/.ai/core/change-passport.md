# Change Passport

A change passport is a signed, redacted statement about a completed governed task. It binds the current repository commit and worktree fingerprint to the Agent Proof hash, final review, evidence integrity, Failure Lab result, kit version, and a repository-trusted Ed25519 signer.

- Issue only when the current proof is `READY`.
- Treat a valid signature from an unknown or revoked key as `VALID_UNTRUSTED`, never verified.
- Keep private keys under `.ai-agent-kit/local/`; never commit, print, copy into evidence, or send them to a model.
- A passport proves integrity and signer identity within the repository trust store. It does not prove deployment, production behavior, authorship, or correctness beyond its recorded evidence.
- Any changed signed field must make verification fail.
- A valid passport whose current commit or content fingerprint has moved is `STALE`, not verified.
