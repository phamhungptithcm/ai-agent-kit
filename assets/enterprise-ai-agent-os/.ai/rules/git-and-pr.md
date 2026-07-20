# Git & Pull Request Rules

required_review:

* "Preserve all existing user work. Never overwrite, revert, or discard unrelated changes."
* "Inspect repository status before making changes using `git status --short --branch`."
* "Verify repository status again after completing changes."
* "Review the current branch before making modifications."
* "Limit changes to the files and scope required by the assigned task."
* "Avoid opportunistic cleanup, formatting, or refactoring outside the requested scope."
* "Do not modify merge history, commit history, or branch history unless explicitly instructed."

repository_safety:

* "Do not execute destructive Git operations without explicit human approval."
* "Prohibited operations include `git reset --hard`, `git clean`, force checkout, force pull, force push, history rewriting, branch deletion, and reflog manipulation."
* "Do not overwrite merge conflicts by choosing one side without understanding the conflict."
* "Never discard uncommitted user work."

branch_management:

* "Work on the current task branch unless instructed otherwise."
* "Do not create, rename, delete, or merge branches without explicit approval."
* "Do not modify protected branches directly."
* "Do not push commits unless explicitly requested."
* "Do not create tags, releases, or release branches without explicit approval."

repository_Governance
* Require signed commits if the repository enforces them.
*Preserve commit authorship and attribution.
*Respect branch protection rules and required status checks.
pr_quality_gates
* Ensure CI passes before merge (when available).
* Ensure required reviewers and CODEOWNERS approvals are obtained.
* Verify security, dependency, and license checks complete successfully.
change_risk_classification
* Classify each PR as Low / Medium / High / Critical risk.
* Highlight production-impacting, security-sensitive, schema-changing, or breaking changes.
* Identify rollback complexity and operational risk.
commit_quality:

* "Keep commits focused on a single logical change."
* "Avoid mixing unrelated bug fixes, refactoring, formatting, dependency updates, or documentation changes."
* "Ensure commit content is internally consistent."
* "Do not commit temporary debugging code, commented-out code, generated logs, editor settings, or local configuration."

pull_request:
required_sections:
- "Business Summary"
- "Technical Summary"
- "Business Outcome"
- "Files Changed"
- "API Changes"
- "Database Changes"
- "Configuration Changes"
- "Security Impact"
- "Privacy Impact"
- "Performance Impact"
- "Backward Compatibility"
- "Testing Performed"
- "Deployment Notes"
- "Rollback Strategy"
- "Known Limitations"
- "Remaining Risks"

requirements:
- "Generate PR descriptions from actual repository changes."
- "Reference supporting documentation, specifications, issues, ADRs, or design documents where available."
- "Do not claim tests passed, deployments succeeded, or validations completed without evidence."

change_scope:

* "Review the actual Git diff before preparing delivery artifacts."
* "Exclude unrelated whitespace-only or formatting-only changes unless explicitly requested."
* "Avoid unrelated file renames or moves."
* "Keep PRs reviewable and narrowly scoped."

protected_assets:
approval_required:
- ".github/workflows/**"
- ".github/actions/**"
- "CODEOWNERS"
- "Terraform"
- "Production Kubernetes manifests"
- "Helm production values"
- "IAM policies"
- "RBAC configuration"
- "Secrets management"
- "Production deployment pipelines"
- "Release automation"
- "Infrastructure provisioning"
- "Security policy"
- "Build and deployment workflows"

requirements:
- "Changes require explicit task scope."
- "Changes require human approval before modification."

release_governance:

* "Do not publish releases automatically."
* "Do not modify release notes without evidence."
* "Do not change release versioning strategy."
* "Do not trigger production deployment workflows."

evidence:

* "Review Git diff before preparing commit messages or PR descriptions."
* "Use repository evidence instead of assumptions."
* "Do not fabricate reviewers, approvals, issue references, or linked work items."
* "Mark assumptions explicitly."

agent_constraints:

* "Do not resolve merge conflicts by guessing intended behavior."
* "Do not stage or commit unrelated user changes."
* "Do not amend commits without explicit approval."
* "Do not squash, rebase, cherry-pick, or rewrite history unless explicitly requested."
* "Do not remove files solely because they appear unused."
* "Do not modify generated artifacts unless repository policy requires committing regenerated output."
