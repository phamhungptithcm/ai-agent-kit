# Failure Lab

Before production-readiness claims, exercise the material unhappy paths for the approved change: invalid input, denied permission, dependency failure, timeout, partial work, retry, cleanup, rollback, concurrency, and sensitive-data boundaries where applicable.

- Review the manifest before execution; execution requires explicit `--apply`.
- Use argv arrays and approved test runners. Never invoke a shell or interpolate untrusted text.
- Inject only bounded, non-secret environment switches.
- Store hashes of stdout and stderr, not raw output.
- A failed case blocks a passing Failure Lab report. Fix, rerun verification, and review again.
- `NOT_RUN` is honest evidence, not a pass.
