# Plugin trust

- Inspect manifest, provenance, checksum, signature, SBOM, dependencies,
  conflicts, compatibility, and requested authority before activation.
- Preview install, update, activation, deactivation, and removal before mutation.
- Require separate approval for protected lifecycle changes and external actions.
- Compute least privilege per invocation; do not trust install-time permission
  alone.
- Treat a valid self-signature as untrusted until its key is explicitly enrolled
  for the plugin ID, publisher, and surfaces in the repository trust store.
- Require a signed, expiring, single-use capability bound to plugin, task, run,
  approval, policy, and permission ceiling. Never accept a caller-authored ceiling.
- Quarantine drifted, tampered, incompatible, or unsafe plugins.
- Keep the default control plane local-first and useful when a registry,
  exporter, or optional index is unavailable.
- Record lifecycle and invocation receipts without prompts, source, secrets,
  credentials, personal data, or raw tool output.
