# Quality Gates

Every implementation completion must report each gate with `PASSED`, `FAILED`, `NOT_APPLICABLE`, or `NOT_RUN`, plus evidence command/result or a concrete rationale.

| Gate | Status | Evidence command/result |
| --- | --- | --- |
| Compilation passed | TODO | TODO |
| Unit tests passed | TODO | TODO |
| Integration tests passed where applicable | TODO | TODO |
| Static analysis passed | TODO | TODO |
| Architecture checks passed | TODO | TODO |
| Language/version quality profile selected | TODO | TODO |
| Platform/domain quality profile selected | TODO | TODO |
| Public web SEO/GEO profile selected where applicable | TODO | TODO |
| Visual design profile selected for user-facing changes where applicable | TODO | TODO |
| Animation and motion profile selected where applicable | TODO | TODO |
| Language-aware static analysis passed | TODO | TODO |
| Security checks passed | TODO | TODO |
| Database migration validated | TODO | TODO |
| API compatibility reviewed | TODO | TODO |
| Observability impact reviewed | TODO | TODO |
| Diff self-reviewed | TODO | TODO |
| Search metadata, crawler policy, structured data, and claims reviewed where applicable | TODO | TODO |
| Design direction, responsive composition, UI states, accessibility, motion, and visual evidence reviewed where applicable | TODO | TODO |
| Animation purpose, reduced motion, interruptibility, performance, compatibility, lifecycle cleanup, and evidence reviewed where applicable | TODO | TODO |

`NOT_RUN` is allowed only when paired with a reason and reviewer-visible risk. `NOT_APPLICABLE` is allowed only when the gate truly does not apply to the scoped change.

Record applicable gate results with `ai-agent-kit runtime check record`, then
render `ai-agent-kit runtime task report --id TASK-ID`. A previous passing
result becomes `STALE` when its repository commit does not match the current
commit. Missing, stale, failed, blocked, or not-run required gates prevent a
production-readiness result of `READY`.
