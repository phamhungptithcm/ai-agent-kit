# Governed Skill Routing

Skill routing turns task text into an explainable skill recommendation. It is intended for projects with overlapping skills where model-only selection is difficult to regression-test.

The router is read-only and deterministic. It does not execute a skill, install tools, or treat a fallback as authorization. Weak or tied signals return `ABSTAIN` with a suggestion for human or model review.

## Configuration

Store the routing contract in a versioned JSON file. Skill paths are relative to the directory passed with `--skills-root`.

The shipped kit installs a canonical contract at `.ai/config/skill-routing.json`. `runtime task create` discovers it automatically, records the route and config hash on the task, and the context compiler makes the routed skill mandatory. Team dispatch instructions then carry both the route hash and compiled context-pack hash. Passing `--routing-config` selects another repository-local contract explicitly.

```json
{
  "schema_version": 1,
  "id": "engineering-router-v1",
  "fallback_route": "start-task",
  "thresholds": {
    "minimum_score": 2,
    "minimum_margin": 1
  },
  "priority": ["fix-bug", "review-pr", "start-task"],
  "routes": {
    "fix-bug": {
      "label": "Fix a defect",
      "skill": "fix-bug/SKILL.md",
      "rules": [
        { "any": ["bug", "defect", "sửa lỗi"], "weight": 2 },
        { "all": ["fix", "test"], "weight": 2 }
      ]
    },
    "review-pr": {
      "label": "Review a change",
      "skill": "review-pr/SKILL.md",
      "rules": [
        { "any": ["review", "pull request", "PR"], "exclude": ["fix"], "weight": 2 }
      ]
    },
    "start-task": {
      "label": "Start a general task",
      "skill": "start-task/SKILL.md",
      "rules": [
        { "any": ["start task", "new task"], "weight": 2 }
      ]
    }
  }
}
```

Rules use normalized literal matching, not caller-provided regular expressions:

- `any`: at least one literal must match.
- `all`: every literal must match.
- `exclude`: no listed literal may match.
- `weight`: score added by a matching rule; defaults to `1` and is limited to `1..100`.

When scores tie, `priority` makes candidate ordering deterministic, but `minimum_margin` still causes the router to abstain. `fallback_route` is only a suggestion when nothing matches.

## Regression fixture

```json
{
  "schema_version": 1,
  "id": "engineering-routing-regression-v1",
  "thresholds": {
    "minimum_accuracy": 1,
    "minimum_coverage": 1,
    "maximum_false_positive_rate": 0
  },
  "cases": [
    {
      "id": "bug-en",
      "hint": "Fix this checkout bug and add a regression test",
      "expect": "fix-bug"
    },
    {
      "id": "unknown",
      "hint": "Explain the deployment architecture",
      "expect": null
    }
  ]
}
```

Use `expect: null` to test intentional abstention. Evaluation reports accuracy, positive-case coverage, negative-case false-positive rate, per-route recall, failed case IDs, and stable SHA-256 hashes that bind the result to its config and fixture.

## Commands

```bash
ai-agent-kit skills route \
  --config .ai/config/skill-routing.json \
  --hint "Fix the checkout bug"

ai-agent-kit skills verify \
  --config .ai/config/skill-routing.json \
  --skills-root .ai/skills-src \
  --fixture .ai/evals/e2e/skill-routing-cases.json

ai-agent-kit skills eval \
  --config .ai/config/skill-routing.json \
  --skills-root .ai/skills-src \
  --fixture .ai/evals/e2e/skill-routing-cases.json
```

`verify` checks exact route/priority coverage, unique target skills, bounded JSON inputs, path containment, real `SKILL.md` files, and symlink traversal. `route` and `eval` return a non-zero exit code for `ABSTAIN` or `FAILED` so automation fails closed.
