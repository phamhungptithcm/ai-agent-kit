#!/usr/bin/env python3
"""Classify shell commands for agent hooks without executing them."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys


DENY_PATTERNS = [
    (r"\bgit\s+(reset\s+--hard|clean\s+-|checkout\s+--|restore\s+\.)", "destructive Git operation"),
    (r"\b(terraform\s+(apply|destroy)|kubectl\s+(delete|apply|create))\b", "infrastructure mutation"),
    (r"\b(rm\s+-[a-z]*r[a-z]*|Remove-Item\b.*-Recurse|del\s+/s)\b", "recursive deletion"),
    (r"\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(sh|bash|zsh|pwsh|powershell)\b", "download piped to execution"),
    (r"\b(psql|mysql|sqlcmd|mongo|redis-cli)\b.*\b(drop|truncate|delete|flushall)\b", "destructive data command"),
]
ASK_PATTERNS = [
    (r"\bgit\s+(add|commit|push|tag|merge|rebase|switch|checkout)\b", "Git state change"),
    (r"\b(npm|pnpm|yarn|pip|pip3|uv)\b.*\b(install|add|update|upgrade|tool)\b", "dependency or tool installation"),
    (r"\b(terraform|kubectl|aws|az|gcloud|psql|mysql|sqlcmd|mongo|redis-cli)\b", "external system command"),
    (r"^\s*(env|printenv|set)\s*$", "environment dump may expose secrets"),
    (r"\b(curl|wget|iwr|Invoke-WebRequest)\b", "network download"),
]


def classify(command: str) -> tuple[str, str]:
    normalized = " ".join(command.strip().split())
    if not normalized:
        return "deny", "empty command"
    for pattern, reason in DENY_PATTERNS:
        if re.search(pattern, normalized, flags=re.IGNORECASE):
            return "deny", reason
    for pattern, reason in ASK_PATTERNS:
        if re.search(pattern, normalized, flags=re.IGNORECASE):
            return "ask", reason
    return "allow", "command is not in a protected mutation class"


def payload_command(payload: dict[str, object]) -> str:
    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return ""
    value = tool_input.get("command")
    return value if isinstance(value, str) else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--command")
    parser.add_argument("--hook", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    command = args.command
    if args.hook:
        try:
            command = payload_command(json.load(sys.stdin))
        except json.JSONDecodeError:
            command = ""
    decision, reason = classify(command or "")
    if args.hook:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": decision,
                "permissionDecisionReason": reason,
            }
        }))
        return 0
    if args.json:
        print(json.dumps({"decision": decision, "reason": reason, "command": shlex.join(shlex.split(command or ""))}))
    else:
        print(f"{decision.upper()}: {reason}")
    return 2 if decision == "deny" else 1 if decision == "ask" else 0


if __name__ == "__main__":
    raise SystemExit(main())
