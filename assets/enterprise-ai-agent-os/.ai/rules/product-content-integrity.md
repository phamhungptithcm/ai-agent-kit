# Product Content Integrity Rules

These rules apply whenever a website, mobile app, desktop app, or other
user-facing experience adds or changes readable text, accessible text, or the
meaning and formatting of displayed data.

## Apply The Human Interface Quality Bar

- Evaluate `Purpose`, `Agency`, `Responsibility`, `Familiarity`, `Flexibility`,
  `Simplicity`, `Craft`, and `Delight` for every applicable product-content
  change using the bundled Apple Human Interface principles reference.
- Record a status and current evidence for every principle. A required failed or
  not-run principle blocks the Product Language Gate; a generic `Apple-like`,
  `premium`, or `polished` claim is not evidence.
- Treat purpose, user control, transparency, familiar behavior, inclusive
  adaptability, directness, complete execution, and humane care as product
  requirements rather than optional aesthetic preferences.
- Keep delight subordinate to clarity, safety, privacy, accessibility,
  performance, platform fit, and trust.
- Do not waive the principle review because a diff is small, content is stored
  separately, an implementation skill is primary, or delivery is urgent.

## Preserve Platform Integrity

- Identify the target platform and its current interaction, terminology,
  accessibility, and component conventions before approving content.
- Apply current Apple HIG component guidance for Apple-platform implementation.
  On other platforms, apply the human-centered principles without forcing
  Apple-only controls, gestures, terminology, assets, or trade dress.
- Preserve the product's own brand and design system. External systems define a
  quality bar or principle, not a license to imitate protected expression.
- Block when unknown platform context could materially change an action,
  permission flow, navigation pattern, accessible behavior, or recovery path.

## Start From The Person And Task

- Identify the audience, task, surface, state, business outcome, implemented
  behavior, and likely reading conditions before writing.
- Treat UI text as interface behavior, not decoration added after implementation.
- Use repository terminology, domain definitions, research, and implemented
  states as evidence. Label assumptions and unknowns.
- Do not invent business rules, product behavior, permissions, data definitions,
  guarantees, deadlines, recovery paths, or user-research findings.
- Block the content decision when missing context could change consequences,
  authorization, destructive behavior, metric interpretation, or legal meaning.

## Preserve Meaning And Trust

- Make labels, actions, messages, and data descriptions agree with the actual
  behavior and current state.
- Use one verified term for one concept and do not vary terminology merely for
  style.
- Name destructive and irreversible consequences explicitly.
- Never hide costs, consent, subscription terms, data use, permanence, failure,
  or limited availability behind vague or reassuring language.
- Do not claim success before the required durable outcome has occurred.
- Do not expose implementation details, private resource existence, sensitive
  data, or security internals through product content.

## Write Like A Helpful Person

- Use familiar, concrete, direct language appropriate to the audience and
  locale.
- Keep a calm, respectful tone. Do not blame, shame, command, patronize,
  threaten, pressure, or manufacture urgency.
- Use action verbs on controls when they describe the real outcome; direct does
  not mean hostile.
- Do not add `please`, apologies, jokes, excitement, emojis, or `Oops`
  mechanically.
- Adapt tone to the person's situation. Treat errors, denied access, money,
  health, safety, deletion, and other consequential states with restraint.
- Avoid robotic filler, corporate jargon, generic reassurance, and
  implementation-centered explanations.

## Be Concise Without Removing Help

- Keep the shortest wording that preserves purpose, consequence, recovery,
  accessibility, and required domain or legal meaning.
- Lead with the decision-critical information and progressively disclose
  secondary detail.
- Remove duplicate labels, repeated instructions, empty headings, and adjacent
  explanations of already clear controls.
- Do not enforce universal word counts. A vague one-word label can be worse than
  a specific phrase.
- Do not provide multiple cosmetic variants when one evidence-backed string is
  sufficient.

## Cover The Whole Experience

- Review applicable loading, empty, success, error, offline, unauthorized,
  stale, partial, disabled, pending, confirmation, and destructive states.
- Distinguish user input errors, system failures, dependency failures, and
  permission boundaries.
- Preserve safe user input through recoverable failures.
- Provide a next step only when it exists, is authorized, and can succeed.
- Make notifications and status messages timely, specific, and non-disruptive.

## Preserve Data Semantics

- Keep zero, null, unknown, not applicable, unavailable, redacted, estimated,
  stale, partial, and not measured distinct.
- Verify metric names, definitions, units, currencies, ranges, timezones,
  aggregation, comparison basis, source, precision, and freshness when material.
- Use locale-aware formatting and complete localizable messages.
- Map internal values to verified user language instead of exposing raw enum,
  schema, API, or analytics names.
- Never convert missing or failed data into a zero, blank success state, or
  confident claim.

## Protect Accessibility And Localization

- Give controls persistent understandable labels and align accessible names with
  visible labels.
- Do not rely on a placeholder, icon, position, color, sound, gesture, or visual
  styling as the only explanation.
- Associate instructions, errors, and status changes with the relevant control
  or region.
- Write links and controls so their purpose remains understandable when read by
  assistive technology.
- Avoid concatenated fragments, English-specific word order, slang, idioms, and
  culture-specific humor without an explicit localization treatment.
- Verify text expansion, zoom, wrapping, pluralization, bidirectional content,
  and locale-specific formats where applicable.

## Require Current Evidence

- Review content in the rendered screen, component, prototype, screenshot, or
  closest disclosed representation; a string file alone is insufficient for a
  final pass.
- Exercise representative user states and data conditions, not only the happy
  path.
- Record `PASSED`, `FAILED`, `NOT_APPLICABLE`, or `NOT_RUN` for every required
  Human Interface principle and product-content dimension.
- Block final success when business meaning, state coverage, accessibility,
  localization, data integrity, platform fit, a mandatory Human Interface
  principle, or in-context verification fails or is not run.
- Do not claim that content is clear, accessible, natural, localized, or
  production-ready without proportional evidence.
