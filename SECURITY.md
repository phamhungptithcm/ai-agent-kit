# Security Policy

## Reporting A Vulnerability

Please report security concerns privately to the maintainers instead of opening a public issue. Include the affected version, reproduction steps, impact, and any suggested fix.

If a public contact address has not been configured yet, create one before public launch and add it here.

## Security Design

AI Agent Kit bootstrap and its default governed workflows are local-only.

Bootstrap must not:

- stage, commit, push, branch, merge, rebase, or tag changes
- create or update remote pull requests, merge requests, tickets, or deployments
- access production systems
- print, write, or collect secrets
- modify application source code during bootstrap

The single optional remote-ticket exception is `product github-sync --apply`.
It is denied unless the caller supplies the current exact issue-plan approval
hash plus a short-lived Ed25519 action from a repository-trusted `MEMBER` with
the `product.github.write` capability and an `operator` or `team-lead` role.
The action is bound to the repository identity, product ID, operation, target
GitHub repository, and plan hash; its nonce is durably consumed before any
remote call. A human repository owner must provision the public trust policy
before delegation and keep its private key outside agent-visible context.
Preview remains read-only, and all other bootstrap, Git, release,
deployment, and production mutations remain outside the CLI's authority.

Changes that weaken these constraints should be treated as security-sensitive.
