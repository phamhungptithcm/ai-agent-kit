# Code Quality Intelligence

Code Quality Intelligence makes AI-assisted changes language-aware and platform-aware. It does not guarantee perfect code. It requires the agent to detect the project language, version, framework, build tool, runtime, application/platform type, delivery surface, and risk areas, then apply the matching `.ai/quality-profiles/` checks before handoff.

## Required Behavior

1. Detect languages, versions, frameworks, build tools, package managers, runtimes, application/platform type, delivery surface, test tools, linters, formatters, database access, API contracts, concurrency primitives, and memory-sensitive paths from source files.
2. Select the smallest matching quality profile set:
   - `universal.yaml` for every project.
   - language profiles such as `go.yaml`, `java.yaml`, `python.yaml`, `typescript-javascript.yaml`, and `frontend-html-css.yaml`.
   - platform/domain profiles such as `web-app.yaml`, `mobile-app.yaml`, `desktop-app.yaml`, `infrastructure.yaml`, and `devops.yaml`.
   - cross-cutting profiles such as `api.yaml`, `database.yaml`, `concurrency.yaml`, and `memory.yaml` when applicable.
3. Prefer existing repository commands and config over generic suggestions.
4. Run or report the relevant checks with `PASSED`, `FAILED`, `NOT_APPLICABLE`, or `NOT_RUN` status and evidence.
5. Review risks that tools often miss: connection leaks, transaction boundaries, thread/goroutine/task leaks, deadlocks, event-loop blocking, heap retention, cache growth, listener/timer cleanup, API compatibility, and migration safety.
6. If a profile cannot be applied because the project lacks tooling, report the gap and propose the smallest team-approved setup.

## Source Priority

Use current repository evidence in this order:

1. Build and runtime config (`go.mod`, `pom.xml`, `build.gradle`, `pyproject.toml`, `package.json`, `tsconfig.json`, mobile manifests, desktop packaging config, Dockerfile, IaC files, CI files).
2. Existing lint, format, test, security, and benchmark config.
3. Current source patterns and framework usage.
4. Existing docs, ADRs, runbooks, and quality guidance.
5. Generic quality profile fallback.

## Completion Requirement

Every implementation, bug fix, PR/MR review, and handoff must include:

- detected language/version/framework/tooling
- detected application/platform/domain profile
- selected quality profiles
- commands executed and results
- checks not run and reason
- code quality risks reviewed
- remaining quality gaps or recommended follow-up
