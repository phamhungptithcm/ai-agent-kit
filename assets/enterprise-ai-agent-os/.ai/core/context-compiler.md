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

Approved durable memory is resolved only after repository/task/actor identity
is known. Lifecycle, conflict, ACL, visibility, and source reachability are hard
filters before keyword or optional semantic ranking. The default selection is
at most five entries and uses a separately bounded memory token budget. The
context pack records a privacy-safe memory receipt with selected IDs/hashes,
scores, exclusions, reason codes, and budget use; it does not copy host
conversation state, prompts, content, or hidden reasoning into the receipt.

Run:

```bash
ai-agent-kit context compile --id TASK-ID --budget 12000
ai-agent-kit context inspect --id TASK-ID
```
