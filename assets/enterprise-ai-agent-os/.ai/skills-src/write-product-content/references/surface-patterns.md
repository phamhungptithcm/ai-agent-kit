# Product Content Surface Patterns

Use the sections that match the current surface. Treat examples as reasoning
patterns, not strings to copy without verifying behavior.

## Contents

1. Global decisions
2. Navigation, headings, and labels
3. Buttons and links
4. Forms and validation
5. State messages
6. Confirmations and destructive actions
7. Permissions and privacy
8. Displayed data
9. Accessibility and localization
10. Review examples

## 1. Global Decisions

- Prefer the product's established term when it is correct and understood.
- Prefer a common audience term over internal architecture or policy language.
- Use the same term across navigation, page title, field label, feedback, help,
  analytics definitions, and support content unless the contexts genuinely
  require different language.
- Make the product the actor when it performs an operation. Do not imply that a
  person caused a system, network, or authorization failure.
- Layer detail: put the decision-critical fact first, then optional explanation
  or help. Do not force every qualification into the primary label.
- Treat brevity as information design, not a word-count contest.

## 2. Navigation, Headings, And Labels

- Name destinations and categories with specific nouns people recognize.
- Make headings describe the page, section, task, or state; avoid generic
  headings such as `Overview`, `Information`, or `Error` when a specific name is
  available.
- Label a field by the information it expects, not the database property name.
- Keep visible and accessible labels aligned.
- Use helper text for format, consequence, or uncommon terminology. Do not
  repeat the label in the helper text.
- Do not use placeholder text as the only label; it disappears during entry and
  may be mistaken for a value.

## 3. Buttons And Links

- Start action labels with the verb that names the real outcome: `Save changes`,
  `Send request`, `Download invoice`, `Delete account`.
- Use a destination name for navigation when the component convention makes the
  movement clear: `Billing`, `Order details`.
- Avoid `Submit`, `Confirm`, `Continue`, `Yes`, `No`, and `OK` when a more
  specific result matters.
- Keep `Back`, `Next`, `Skip`, `Cancel`, `Close`, and `Done` only when their
  platform meaning is clear and accurate.
- Make destructive action text exact. Never soften deletion as `Remove` when it
  permanently deletes data.
- Do not explain a well-named button in adjacent body text.
- Make links describe their destination or purpose; avoid repeated `Learn more`
  when several links appear together.

## 4. Forms And Validation

- Ask only for data the current task needs.
- Put format or eligibility guidance before entry when it can prevent an error.
- Identify required and optional information consistently without relying on
  color or an unexplained symbol.
- Keep examples realistic but obviously non-personal.
- State validation in terms of the field and correction: `Enter an email address
  in the format name@example.com`.
- Avoid blame such as `You entered an invalid email`.
- Preserve entered data after recoverable errors unless security requires
  clearing a specific field.
- Separate a field error from a form-level or service-level failure.
- Do not claim a value is invalid when the service merely failed to validate it.

## 5. State Messages

### Loading

Name material work: `Loading report`, `Saving changes`. Omit a message for an
imperceptible wait. Add progress, expected duration, cancellation, or background
behavior only when implemented and useful.

### Empty

Distinguish:

- first use: no item has been created;
- no result: the current query found nothing;
- filtered empty: filters hide available items;
- true zero: the measured value is zero;
- unavailable: data could not be obtained;
- unauthorized: data may exist but cannot be shown.

Offer a next step only when the person can take it and has permission.

### Error

Use this order when each part is known and useful:

1. what did not complete;
2. whether user work is safe;
3. what can be done now;
4. support or diagnostic reference without exposing internals.

Do not show raw exceptions, stack traces, status codes, correlation tokens,
database fields, or security-sensitive resource details to ordinary users.

### Success

Confirm the durable result: `Changes saved`, `Request sent`. Do not announce
success before persistence or downstream acceptance when the product contract
requires it. State the next step or timing only when verified.

### Offline, Stale, And Partial

State what is available, what is not, and the timestamp or scope when it affects
decisions. Never present cached, estimated, or partial information as current
and complete.

## 6. Confirmations And Destructive Actions

- Use a specific title that states the decision, not `Are you sure?` alone.
- Explain irreversible effects, retained data, affected objects, and recovery
  only when verified.
- Name the destructive button after the action and object.
- Provide a safe cancel path using the platform convention.
- Do not use confirmshaming, hidden consequences, urgency, or unequal wording to
  steer the decision.
- Avoid confirmation dialogs for low-risk reversible actions when undo or direct
  feedback is safer and less disruptive.

## 7. Permissions And Privacy

- Distinguish unauthenticated, unauthorized, unavailable, and nonexistent
  without revealing protected resource existence.
- Explain why a permission is needed at the moment it becomes relevant.
- Describe the product capability unlocked, not a surveillance-oriented reason.
- Offer settings, sign-in, access request, or administrator contact only when the
  path exists.
- Do not expose another person's identity, tenant, account, role, or private
  data through an error or label.

## 8. Displayed Data

- Define a metric before naming it. Verify numerator, denominator, aggregation,
  exclusions, unit, period, timezone, and source when they affect meaning.
- Keep `0`, `—`, `N/A`, `Unknown`, `Not measured`, `Unavailable`, and `Redacted`
  semantically distinct. Prefer words when a symbol would be ambiguous.
- State whether a comparison is against the prior period, target, forecast, or
  another cohort.
- Mark estimated, sampled, delayed, stale, rounded, partial, and modeled values.
- Use locale-aware formatting and preserve meaningful precision.
- Translate internal statuses into audience language without changing their
  business meaning.
- Provide table, chart, and screen-reader equivalents that preserve the same
  label, value, unit, series, and time context.
- Never infer a business definition from a column name alone.

## 9. Accessibility And Localization

- Ensure speech-input users can say the visible label to activate a control.
- Keep accessible names concise but complete; add descriptions only for
  additional help or consequence.
- Announce dynamic errors, completion, and progress with the least disruptive
  appropriate mechanism.
- Do not encode meaning only in capitalization, punctuation, emoji, color, or an
  icon.
- Store complete messages with translator context. Do not concatenate fragments
  or assume English word order.
- Support plurals, grammatical gender when applicable, variable interpolation,
  right-to-left layout, and locale formats.
- Test expansion and wrapping instead of shortening translations until their
  meaning breaks.

## 10. Review Examples

| Weak or unsafe | Better pattern | Verify before using |
| --- | --- | --- |
| `Confirm` | `Save changes` | The action really persists changes. |
| `Something went wrong` | `Changes weren't saved. Try again.` | Retry is safe and available. |
| `No data` | `No orders yet` | This is true first-use empty state, not a failed load. |
| `You entered an invalid email` | `Enter an email address in the format name@example.com` | That format matches validation. |
| `Error 403` | `You don't have access to this report` | Revealing the report is permitted. |
| `Delete?` with `Yes` | `Delete account?` with `Delete account` | Deletion scope and recovery are accurate. |
| `Revenue` | `Revenue · Aug 2026 · USD` | Metric definition, period, and currency are verified. |
| `0` for missing telemetry | `Not measured` | The source truly has no measurement. |

For Vietnamese interfaces, prefer natural product language over literal English
word order. For example, use `Lưu thay đổi`, `Gửi yêu cầu`, or `Chưa có đơn hàng
nào` only when those phrases match the implemented action and state. Do not add
`Vui lòng` to every instruction; use it only when it improves the relationship
without weakening clarity.
