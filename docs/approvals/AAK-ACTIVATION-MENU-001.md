# Implementation Approval Record

Plan ID/version: AAK-ACTIVATION-MENU-001

Repository intelligence gate status: READY

Indexed analysis reviewed: Current CLI, bootstrap, package lifecycle, build, and packed-smoke paths were inspected before implementation.

Approval status: APPROVED

Approver: repository owner (`phamhungptithcm`)

Approval timestamp or task reference: activation and npm-install behavior approved in the active Codex task on 2026-07-28

Approved scope:

- Add an interactive CLI activation menu for preview, governed import, full import, and exit.
- Keep non-interactive `npx` and `npm exec` execution read-only until an explicit bootstrap command is selected.
- Detect persistent npm dependencies and show explicit cleanup guidance after CLI activation.
- Make a top-level `npm install @hunpeolabs/ai-agent-kit` import the governed kit through `postinstall`.
- Skip automatic import for global installs, transient `npx`/`npm exec` package execution, package development, and repositories already activated.
- Synchronize source, built distribution, documentation, tests, package metadata, and packed-package smoke coverage.
- Release the approved behavior as patch version `0.4.2`.

Approved paths:

- `bin/**`
- `dist/**`
- `docs/approvals/AAK-ACTIVATION-MENU-001.md`
- `scripts/smoke-packed.mjs`
- `src/**`
- `test/**`
- `CHANGELOG.md`
- `README.md`
- `package.json`
- `package-lock.json`

Required constraints:

- `npx` and `npm exec` must not add a persistent project dependency.
- `npm install` may retain the npm dependency as explicitly accepted by the repository owner.
- Bootstrap must preserve application source, existing local changes, and the current ownership contract.
- Postinstall must not install global tools, refresh indexes, stage, commit, push, deploy, or perform remote writes.
- Repeated installation must not re-import an already activated kit.
- One release and one tag: `v0.4.2`.

Delta approval required when:

- A path outside this record is required.
- Automatic import is expanded to transient, global, or transitive-only installation.
- A dependency, hosted service, credential, or production mutation is added.
- Bootstrap ownership or protected-change gates are weakened.
