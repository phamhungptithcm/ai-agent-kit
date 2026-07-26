#!/usr/bin/env python3
"""Validate tracked approval evidence against a target path or actual Git diff."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
from pathlib import Path


DEFAULT_RECORD = ".ai/local/implementation-approval.md"
REQUIRED_FIELDS = [
    "Plan ID/version",
    "Repository intelligence gate status",
    "Approval status",
    "Approver",
    "Approval timestamp or task reference",
]


def repo_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return Path(result.stdout.strip()).resolve() if result.returncode == 0 else Path.cwd().resolve()


def parse_record(path: Path) -> tuple[dict[str, str], list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    fields: dict[str, str] = {}
    approved_paths: list[str] = []
    in_paths = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line == "Approved paths:":
            in_paths = True
            continue
        if in_paths and line.startswith("- `") and line.endswith("`"):
            approved_paths.append(line[3:-1])
            continue
        if in_paths and line and not line.startswith("-"):
            in_paths = False
        if ":" in line and not line.startswith("-"):
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields, approved_paths


def validate_record(path: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    if not path.exists():
        return [f"approval record missing: {path}"], []
    fields, approved_paths = parse_record(path)
    for field in REQUIRED_FIELDS:
        value = fields.get(field, "")
        if not value or "TODO" in value:
            errors.append(f"approval field missing or unresolved: {field}")
    if fields.get("Approval status", "").upper() != "APPROVED":
        errors.append("approval status must be APPROVED")
    if fields.get("Repository intelligence gate status", "").split("—", 1)[0].strip().upper() != "READY":
        errors.append("repository intelligence gate status must be READY")
    if not approved_paths:
        errors.append("approval record has no Approved paths")
    return errors, approved_paths


def normalize_path(root: Path, value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        try:
            path = path.resolve().relative_to(root)
        except ValueError:
            return "../outside-repository"
    return path.as_posix().lstrip("./")


def is_approved(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) or (pattern.endswith("/**") and path == pattern[:-3]) for pattern in patterns)


def changed_paths(root: Path, base_ref: str) -> list[str]:
    commands = [
        ["git", "diff", "--name-only", "--diff-filter=ACMR", base_ref, "--"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]
    paths: set[str] = set()
    for command in commands:
        result = subprocess.run(command, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"failed: {' '.join(command)}")
        paths.update(line.strip() for line in result.stdout.splitlines() if line.strip())
    return sorted(paths)


def hook_target(payload: dict[str, object]) -> str:
    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return ""
    for key in ("file_path", "path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str):
            return value
    return ""


def hook_response(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", default=os.environ.get("AI_AGENT_APPROVAL_RECORD", DEFAULT_RECORD))
    parser.add_argument("--path", help="validate one intended repository path")
    parser.add_argument("--base-ref", help="validate the actual diff from this Git ref")
    parser.add_argument("--hook", action="store_true", help="read a Claude PreToolUse payload from stdin")
    args = parser.parse_args()

    root = repo_root()
    record = Path(args.record)
    if not record.is_absolute():
        record = root / record
    errors, patterns = validate_record(record)

    targets: list[str] = []
    if args.hook:
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as exc:
            hook_response("deny", f"invalid approval hook input: {exc}")
            return 0
        target = hook_target(payload)
        if not target:
            hook_response("deny", "protected edit target is missing")
            return 0
        targets = [normalize_path(root, target)]
    elif args.path:
        targets = [normalize_path(root, args.path)]
    elif args.base_ref:
        try:
            targets = changed_paths(root, args.base_ref)
        except RuntimeError as exc:
            errors.append(str(exc))
    else:
        parser.error("one of --path, --base-ref, or --hook is required")

    for target in targets:
        if target.startswith("../") or not is_approved(target, patterns):
            errors.append(f"path outside approved scope: {target}")

    if args.hook:
        hook_response("deny" if errors else "allow", "; ".join(errors) if errors else "tracked approval covers target")
        return 0
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"implementation approval validation passed ({len(targets)} path(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
