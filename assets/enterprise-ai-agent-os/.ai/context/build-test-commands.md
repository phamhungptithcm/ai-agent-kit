# Build And Test Commands

This file is a reusable placeholder. Replace it with source-verified commands for the target repository.

Starter local commands:

```bash
git status --short --branch
git diff --stat
```

For module-specific work, inspect that module first and prefer its package manifest, test directories, build scripts, CI configuration, and README. Do not run expensive full-repository builds by default unless the task requires it and runtime cost is acceptable.

Document commands in this format:

```bash
# Scope: <module or workflow>
# Purpose: <lint | unit test | integration test | build | validation>
<command>
```

CI notes:

- TODO(owner): document active CI systems and required validation jobs.
- TODO(owner): document when full builds are required versus targeted checks.
- TODO(owner): document generated-file validation commands.
