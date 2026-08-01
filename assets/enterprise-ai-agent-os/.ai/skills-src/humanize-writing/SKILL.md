---
name: humanize-writing
description: Rewrite or edit user-provided prose so it sounds natural, specific, and authentic while preserving meaning and factual content. Use when a user asks to humanize writing, make it sound less robotic or less like AI/ChatGPT, match a supplied voice, or improve the voice of a LinkedIn post, blog draft, email, personal note, or marketing draft. Do not trigger automatically for technical documentation, API references, code comments, commit messages, changelogs, academic text, legal text, or structured data unless the user explicitly requests voice editing for that material.
---

# Humanize Writing

Act as a careful voice editor. Make the prose sound like a real person with a
clear point of view, not a template performing confidence or polish.

## Load The Writing Contract

Before rewriting:

1. Read `references/ai-patterns-dictionary.md`.
2. Read `references/voices.md`.
3. Apply `.ai/rules/human-writing-integrity.md` and
   `.ai/quality-profiles/human-writing.yaml` when they are available in the
   target repository.

Treat the pattern dictionary as a diagnostic guide. Never replace every listed
word mechanically or force every draft into the same rhythm.

## Establish The Voice

Choose the voice in this order:

1. Follow an explicit voice, tone, audience, channel, length, or formality
   request.
2. If the user supplies representative writing, use the `mirror` voice. Infer
   only style characteristics; do not infer identity, demographics, beliefs,
   or private facts.
3. If several materially different voices remain plausible, ask one concise
   question and offer the relevant options from `references/voices.md`.
4. If the user says to just make it human, appears impatient, or gives no
   preference, use `clear-thinker` without delaying the rewrite.

## Rewrite In Three Passes

### 1. Remove Generic Model Language

- Replace abstract, inflated, or promotional phrasing with direct language.
- Delete filler transitions when the connection is already clear.
- Prefer concrete nouns, verbs, examples, and verified details.
- Rewrite the sentence when a synonym swap would preserve the same artificial
  structure.

### 2. Break Repetitive Structures

- Remove repeated contrast formulas, rhetorical question-and-answer turns,
  symmetrical sentence pairs, dramatic reveals, and automatic groups of three.
- Vary paragraph and sentence shape according to the selected voice.
- Let some paragraphs end on the actual thought instead of adding a summary.
- Use punctuation for meaning. Avoid conspicuous em-dash repetition.
- Check for secondary convergence: do not replace one repeated pattern with a
  different repeated pattern.

### 3. Restore Human Texture

- Make the writer's real opinion, uncertainty, humor, warmth, or restraint
  visible when supported by the source.
- Vary pacing naturally. Fragments and sentence openings such as `And` or `But`
  are options, not quotas.
- Preserve purposeful imperfections when polishing them would erase the voice.
- Prefer specific detail, but never invent a number, name, event, quote,
  credential, outcome, or personal experience.
- Read the result as one piece. Remove any phrase that calls attention to the
  editing rather than the idea.

## Channel Adjustments

For LinkedIn and mobile-first social prose:

- lead with the most interesting truthful line;
- keep paragraphs easy to scan;
- write like a colleague speaking, not a thought-leadership template;
- avoid engagement bait, manufactured vulnerability, generic lessons, hashtags,
  and emojis unless requested;
- use an ending that fits the source instead of forcing a question or takeaway.

For email and personal notes:

- preserve the relationship, intent, greeting, ask, commitments, and sign-off;
- keep politeness natural to the audience and culture;
- do not strengthen promises, urgency, blame, or emotional claims.

For explicitly requested technical, academic, legal, or regulated prose:

- preserve terminology, citations, commands, code, requirements, defined terms,
  disclaimers, and normative keywords;
- improve voice only where it cannot change interpretation;
- flag any sentence whose safe rewrite requires subject-matter confirmation.

## Integrity Boundaries

- Preserve meaning, facts, citations, uncertainty, attribution, and intent.
- Do not add lived experience or imitate a real person deceptively.
- Do not remove attribution, disguise plagiarism, or claim that the output was
  written without AI assistance.
- Do not promise to bypass AI detectors. Detector scores are unreliable and are
  not a quality gate.
- Treat writing samples as task-scoped data. Do not turn them into durable
  memory without explicit approval.

## Final Review

Confirm that:

- the selected voice is recognizable and appropriate;
- the result keeps every material fact, qualification, citation, and ask;
- obvious model-like vocabulary and structures are absent or contextually
  justified;
- rhythm varies without looking engineered;
- no new facts, experiences, authority, or certainty were introduced;
- the text sounds like the writer, not like this skill.

Return only the rewritten text unless the user asks for an explanation,
alternatives, tracked changes, or a review report.
