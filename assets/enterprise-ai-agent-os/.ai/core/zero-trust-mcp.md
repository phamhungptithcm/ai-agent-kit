# Zero-Trust MCP Broker

MCP configuration is untrusted until an exact identity for the server is present in the
deny-by-default trust registry.

The broker verifies:

- server ID, executable or package, version, exact arguments, executable digest,
  transport, and auto-start intent;
- trust review expiry and configuration hash;
- allowed tools, filesystem roots, network destinations, timeout, and rate limit;
- prompt injection, SSRF, token passthrough, unsafe shell startup, and permission
  expansion signals.

Credentials are obtained only from an injected credential provider after both
broker trust and universal action authorization succeed. Credentials never enter
action envelopes, receipts, telemetry, exported evidence, or returned results.

Untrusted, changed, expired, or unsafe servers cannot auto-start. New
permissions return `ask` or `deny`; they are never silently granted.
