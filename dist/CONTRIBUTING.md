# Contributing

Thanks for helping improve AI Agent Kit.

## Local Setup

```bash
npm ci
npm run check
```

## Development Rules

- Keep bootstrap local only. Do not add behavior that stages, commits, pushes, opens merge requests, updates tickets, deploys, or changes application source code.
- Prefer deterministic file generation and explicit managed sections.
- Add tests when changing bootstrap behavior, safety rules, file merging, tool checks, or generated output.
- Keep public docs generic. Do not add customer names, project names, secrets, internal URLs, or environment-specific paths.

## Pull Request Checklist

- `npm run check` passes.
- `npm run release:dry-run` has been reviewed when package contents change.
- Docs are updated for user-visible behavior.
- Safety model remains local-only and review-first.
