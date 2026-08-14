# Trace and recover a run

1. Inspect the current repository and parent baseline before loading a run.
2. Verify the Run Envelope and Decision Chronicle hash chains.
3. Show the last checkpoint, active decisions, failed attempts, untried paths,
   blockers, and proposed next action.
4. Resolve drift and plugin trust before allowing writer dispatch.
5. Produce a non-destructive recovery preview naming affected decisions, files,
   checks, risks, and rollback strategy.
6. Wait for explicit mutation approval.
7. Resume through the governed runtime and append new events; never edit the old
   record.
8. Run review → fix → verify until required gates pass, then report evidence and
   remaining uncertainty.
