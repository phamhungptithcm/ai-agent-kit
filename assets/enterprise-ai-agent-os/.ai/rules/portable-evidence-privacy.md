# Portable Evidence Privacy

- Export the minimum evidence required for independent verification.
- Redact secrets, credentials, tokens, personal data, customer data, private paths, and unnecessary prompt content before export.
- Re-chain redacted bundles and verify their hashes after transformation.
- Keep local source evidence separate from portable `.aakrun` evidence.
- Do not claim redacted evidence proves facts removed by redaction.
- Reject bundles with path traversal, symlink targets, oversized files, invalid schemas, or broken hash chains.
