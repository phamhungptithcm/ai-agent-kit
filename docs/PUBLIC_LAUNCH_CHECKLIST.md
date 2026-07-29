# Public Launch Checklist

Use this before promoting the package on npm, GitHub, LinkedIn, or internal engineering channels.

## Required

- Confirm the npm scope `@hunpeolabs` is owned by the publishing account or organization.
- For the first publish, configure a granular npm access token as the GitHub Actions secret `NPM_TOKEN`; never store npm tokens in repository variables.
- After the first publish, configure npm Trusted Publishing for `phamhungptithcm/ai-agent-kit` and workflow `npm-publish.yml`, then remove the long-lived `NPM_TOKEN` secret.
- Confirm the GitHub repository URL in `package.json` is correct.
- Confirm the MIT license is appropriate before public promotion.
- Run `npm run check` and `npm run release:dry-run`.
- Run `npm run smoke:packed` to execute the built tarball through `npx --yes`.
- Run `npx --yes . bootstrap --dry-run` from a clean fixture repository.
- Run `status`, `doctor`, `diff`, `update --dry-run`, and `uninstall --dry-run` against a bootstrapped fixture.
- Confirm `governed` and `full` preserve the same core quality contract.
- Review the packed file list from `npm pack --dry-run`.
- Confirm Linux validation and macOS/Windows packed-package smoke jobs are green.

## Trust Polish

- Add screenshots or a short terminal GIF showing dry-run, bootstrap summary, doctor status, and generated files.
- Pin a GitHub release with the same version as npm.
- Add three issue labels: `bug`, `enhancement`, and `good first issue`.
- Add one example repository or short demo branch that shows the generated files after bootstrap.

## Launch Copy

Suggested short description:

> A one-command operating system for AI coding agents: shared team policy, repository intelligence gates, review evidence, and local-only bootstrap safety.

Suggested audience framing:

- For managers: standardize AI-assisted engineering without losing review control.
- For developers: stop rebuilding prompt rules per repo.
- For QA: make validation evidence part of the workflow from the first prompt.
