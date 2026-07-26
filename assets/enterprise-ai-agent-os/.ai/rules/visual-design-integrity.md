# Visual Design Integrity Rules

These rules apply to user-facing pages, views, components, styles, visual assets, interaction states, and motion.

## Context Before Aesthetics

- Identify the product surface, audience, user goal, content hierarchy, brand assets, existing design system, and compliance constraints before choosing a visual direction.
- Treat repository-owned design tokens, components, brand guidance, and established interaction patterns as primary evidence.
- Use external references as inspiration only. Do not copy logos, product copy, proprietary assets, distinctive compositions, or brand claims.
- Prefer one primary visual influence and at most one secondary influence unless an approved design system defines otherwise.
- Do not impose marketing-site aesthetics on dashboards, transactional flows, documentation, admin tools, or regulated services.

## System Consistency

- Use explicit tokens or documented rules for typography, color, spacing, radii, borders, elevation, icons, and motion.
- Do not mix component or icon systems without a documented need, compatibility review, and migration boundary.
- Make visual hierarchy reflect information hierarchy and task priority.
- Use color, shape, position, text, and state together; never rely on color or motion as the only signal.
- Preserve intentional brand and product conventions during redesign unless the approved scope explicitly changes them.

## Complete Interaction Design

- Design applicable default, hover, active, focus, disabled, loading, empty, error, success, offline, unauthorized, and partial-data states.
- Keep navigation, primary actions, recovery paths, and destructive actions understandable and predictable.
- Preserve user-entered data during recoverable failures where safe.
- Ensure content remains legible under zoom, text expansion, localization, and supported viewport changes.

## Accessibility And Performance

- Accessibility, clarity, and task completion override novelty.
- Preserve semantic HTML, keyboard navigation, visible focus, contrast, touch-target usability, and assistive-technology behavior.
- Respect reduced-motion preferences and provide an equivalent understandable state without animation.
- Give motion a functional or communicative purpose and keep it within the repository's performance budget.
- Avoid visual effects that introduce layout instability, excessive paint, input latency, battery cost, or unreadable contrast.

## Evidence And Claims

- Verify material visual changes at representative mobile, tablet, and desktop widths when applicable.
- Verify relevant loading, empty, error, success, focus, and reduced-motion states.
- Distinguish repository-verified, screenshot-observed, browser-measured, reference-derived, inferred, unavailable, and not-applicable evidence.
- Do not claim a result is accessible, responsive, polished, premium, pixel-perfect, or visually matched without appropriate evidence.
- Do not fabricate testimonials, customer logos, awards, ratings, reviews, product imagery, people, credentials, or trust signals to improve appearance.

## Contextual Preferences

- Aesthetic heuristics such as asymmetry, restrained palettes, typography choices, card avoidance, motion intensity, or density are contextual preferences, not universal rules.
- Frameworks, styling systems, fonts, icon libraries, and animation libraries must follow the existing repository or an approved dependency decision.
- Any departure from the existing design language must state the user benefit, affected surfaces, migration boundary, and regression risk.
