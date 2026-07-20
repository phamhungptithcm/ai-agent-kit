# Synchronize Work Item Workflow

Use this workflow to prepare or perform a safe Jira/work-item update.

1. Run the Repository Intelligence Gate when the update summarizes repository work or implementation evidence.
2. Verify the issue key, target system, desired action, and current state.
3. Verify an approved authenticated connector or integration is available.
4. Verify authorization and target workflow transition before making changes.
5. Prepare the exact comment or update body with CodeGraph/CocoIndex-backed path, impact, docs, and validation evidence when applicable.
6. If any prerequisite is missing or uncertain, do not update Jira. Produce copy-ready text instead.
7. If the update is performed, report the verified response and final state.

Do not transition or update Jira when the issue key, workflow, permission, integration, or target state is uncertain.
