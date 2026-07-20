# Security Policy

## Reporting A Vulnerability

Please report security concerns privately to the maintainers instead of opening a public issue. Include the affected version, reproduction steps, impact, and any suggested fix.

If a public contact address has not been configured yet, create one before public launch and add it here.

## Security Design

AI Agent Kit is designed to bootstrap local repository configuration only.

The CLI must not:

- stage, commit, push, branch, merge, rebase, or tag changes
- create or update remote pull requests, merge requests, tickets, or deployments
- access production systems
- print, write, or collect secrets
- modify application source code during bootstrap

Changes that weaken these constraints should be treated as security-sensitive.
