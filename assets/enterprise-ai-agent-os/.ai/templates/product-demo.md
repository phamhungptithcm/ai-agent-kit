# Product Demonstration

Authoring aid: produce a reproducible demonstration from the actual product. An unrehearsed script is not a ready demo.

## Audience, outcome and identity

Record audience, decision the presentation supports, user problem, demonstrated value, duration, presenter, candidate/version/digest, spec revision, environment and demonstration status (`NOT_REHEARSED`, `BLOCKED`, or `REHEARSED`). State whether data is synthetic, sanitized, or authorized live data. Record production readiness separately.

## Setup and repeatability

List verified prerequisites, exact commands/actions, permissions, dependency availability, seed/fixture source, expected initial state, reset/cleanup and what to do if a dependency fails. Keep credentials and personal/customer data out of captures. Validate reset before rehearsal.

## Presentation sequence

| Scene/time | User problem and action | Expected visible outcome | BR/SPEC/AC IDs | Executed evidence/capture | What the presenter may claim |
| --- | --- | --- | --- | --- | --- |

Show the entry point, core journey, outcome and at least one relevant denial/failure/recovery. Explain a design choice only when it helps the audience assess the product. Use current real captures; label edited recordings and synthetic data. Do not present mockups as implemented features.

## Claim ledger

| Claim | Supporting candidate/environment/evidence | Limitation and disclosure | Allowed wording |
| --- | --- | --- | --- |

Do not claim live host behavior, customer results, production integrations, performance or availability from local fixtures. Screenshots prove visible states, not complete business workflows.

## Rehearsal and handoff

Record rehearsal date/executor, exact candidate/environment, actual outcomes, capture paths/hashes, timing, reset result, defects and presenter handoff. Block any advertised journey that failed rehearsal. A fallback is a labeled recording of verified behavior or an explicit limitation, never a fabricated result.
