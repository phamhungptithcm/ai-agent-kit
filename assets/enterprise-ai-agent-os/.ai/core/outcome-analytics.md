# Local Outcome Analytics

Outcome analytics are local and privacy-minimized by default. They may record
verified task success, scope violations, review duration, rework, rollback,
action decisions, eval score, evidence-backed cost, and action count.

They must not record source code, prompts, secrets, raw logs, file paths, email
addresses, names, or direct personal identifiers. Every metric declares its
calculation, unit, denominator, and exclusions. Missing observations remain
missing. Product claims require an adequate baseline and current sample; they
must never be generated from incomplete evidence.

Export is a separate, explicit action and is disabled by default.
