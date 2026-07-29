# Task-Aware Context Compiler

Use the smallest reproducible context pack that still contains every mandatory
governance rule needed for the task.

## Contract

- Include mandatory core policy before task-selected material.
- Select optional rules, quality profiles, skills, task facts, and approved
  memory by deterministic intent matching.
- Record source provenance, selection reason, content hash, repository commit,
  policy revision, token estimate, and exclusions.
- Emit both JSON and Markdown forms.
- Mark a pack `BLOCKED` when mandatory context cannot fit or is missing.
- Mark a pack `DEGRADED`, never `READY`, when repository intelligence is absent
  or stale. A degraded pack may support inspection but cannot satisfy a READY
  implementation gate.
- Never include proposed or unapproved memory.

Run:

```bash
ai-agent-kit context compile --id TASK-ID --budget 12000
ai-agent-kit context inspect --id TASK-ID
```
