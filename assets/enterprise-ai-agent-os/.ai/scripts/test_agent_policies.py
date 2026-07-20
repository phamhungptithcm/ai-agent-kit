#!/usr/bin/env python3
"""Exercise Codex execution-policy rules when the Codex CLI is available."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def static_checks(rules: Path) -> list[str]:
    text = rules.read_text(encoding="utf-8", errors="replace")
    errors: list[str] = []
    expected_fragments = [
        'pattern = ["git", ["status", "diff", "log", "show", "branch"]]',
        'pattern = ["git", ["add", "commit", "push", "tag", "merge", "rebase"]]',
        'pattern = ["git", ["reset", "clean", "checkout", "restore"]]',
        'pattern = [["rm", "del", "Remove-Item"],',
        'pattern = [["terraform", "kubectl", "aws", "az", "psql", "mysql", "sqlcmd", "mongo", "redis-cli"]]',
        "match = [",
        "not_match = [",
    ]
    for fragment in expected_fragments:
        if fragment not in text:
            errors.append(f"missing expected rule fragment: {fragment}")
    return errors


def run_codex_checks(codex: str, rules: Path, root: Path) -> list[str]:
    commands = [
        ["git", "status"],
        ["git", "commit", "-m", "test"],
        ["git", "reset", "--hard"],
        ["terraform", "apply"],
        ["env"],
    ]
    errors: list[str] = []
    for command in commands:
        result = subprocess.run(
            [codex, "execpolicy", "check", "--rules", str(rules), "--", *command],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            errors.append(
                f"codex execpolicy check failed for {' '.join(command)}: "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
    return errors


def main() -> int:
    root = repo_root()
    rules = root / ".codex" / "rules" / "default.rules"
    errors = static_checks(rules)

    codex = shutil.which("codex")
    if codex:
        errors.extend(run_codex_checks(codex, rules, root))
    else:
        print("codex CLI unavailable; using static policy tests only")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("agent policy tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
