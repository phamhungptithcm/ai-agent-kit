# Animation Integrity Rules

These rules apply to UI transitions, keyframes, Web Animations, View Transitions, scroll-linked or scroll-triggered effects, gestures, physics, animated media, and animation-library usage.

## Decision Before Implementation

- Do not add animation without a stated user, spatial, feedback, state, explanatory, continuity, or carefully bounded delight purpose.
- Consider interaction frequency, input modality, task criticality, audience, surface, and interruption risk before selecting timing or technique.
- Do not delay task completion, navigation, feedback, or input solely to display an animation.
- Keep content, controls, state, and recovery usable when animation is disabled, unsupported, canceled, or fails.
- Do not apply marketing or decorative motion patterns to high-frequency, operational, regulated, trust-critical, or accessibility-critical workflows without explicit rationale.

## Accessibility And Input

- Define reduced-motion behavior for every non-trivial motion effect.
- Suppress or replace non-essential vestibular movement when reduced motion is requested; slowing the same motion is not automatically sufficient.
- Do not use motion as the only signal for state, hierarchy, direction, success, failure, or progress.
- Preserve semantic state, focus, keyboard behavior, screen-reader announcements, and input parity throughout enter and exit transitions.
- Gate hover-only effects for input devices that actually support hover where needed.
- Provide an accessible non-gesture alternative when a gesture is not essential to the task.
- Provide pause, stop, or equivalent control for persistent motion where required by applicable accessibility standards.

## Correctness And Lifecycle

- Define start, completion, cancellation, reversal, rapid retrigger, route-change, background-tab, and unmount behavior.
- Prevent stale completion callbacks from mutating current state.
- Cancel and clean up `requestAnimationFrame`, timers, animation handles, observers, listeners, subscriptions, and pointer capture.
- Do not allow exit animation to corrupt state, block required navigation indefinitely, or conceal a failed operation.
- Keep SSR, hydration, and initial animation state deterministic.
- Handle repeated interactions and development-mode effect re-execution without duplicate animations or leaked work.
- Infinite or ambient animation requires a documented purpose, visibility or pause policy, and bounded resource usage.

## Performance

- Name transition properties explicitly; do not use `transition: all`.
- Prefer properties and techniques that avoid unnecessary layout and paint, while allowing measured, justified exceptions.
- Review geometry-changing animation, large filters, blur, shadows, masks, clip paths, SVG, canvas, WebGL, video, and large composited layers for actual cost.
- Do not leave broad `will-change` declarations permanently enabled or create unbounded compositor layers.
- Ensure stagger and chained sequences do not block interaction or create excessive total duration.
- Test animation while realistic content, route transitions, network work, and main-thread activity occur.
- Pause or avoid unnecessary work when animation is offscreen, hidden, backgrounded, or no longer relevant.

## Dependencies And Compatibility

- Use the repository's current motion approach when it safely meets the requirement.
- Do not add a library when existing CSS, Web Animations, platform APIs, or approved dependencies are sufficient.
- Check runtime, framework, browser, server-rendering, and fallback compatibility before using emerging animation features.
- Do not hard-code a universal duration, easing curve, spring, scale value, library, or animation technique.
- Treat reference animations as inspiration; do not copy a product's signature motion or protected assets literally.

## Evidence And Claims

- Verify material animations at normal speed and in slow motion or frame-by-frame where practical.
- Verify reduced motion, repeated triggering, interruption, cancellation, representative input methods, and relevant mobile hardware.
- Record performance, layout stability, interaction responsiveness, console, and lifecycle evidence proportional to risk.
- Classify evidence as source-verified, browser-observed, trace-measured, device-observed, inferred, unavailable, or not applicable.
- Do not claim `60fps`, smoothness, hardware acceleration, accessibility, or zero performance impact without suitable evidence.
