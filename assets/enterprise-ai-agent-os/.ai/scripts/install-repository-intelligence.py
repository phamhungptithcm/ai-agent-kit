#!/usr/bin/env python3
"""Install verified local repository-intelligence tooling when missing."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from repository_intelligence_lib import repo_root, run_command, stream_command, which


def print_verified_command(label: str, command: list[str]) -> None:
    print(f"{label}:")
    print("  " + " ".join(command))


def ensure_codegraph(execute: bool) -> int:
    root = repo_root()
    if which("codegraph"):
        version = run_command(["codegraph", "--version"], root, timeout=30)
        if version.ok:
            print(f"CodeGraph already installed: {version.stdout.strip() or 'available'}")
            return 0
        print(f"ERROR: CodeGraph is on PATH but its version check failed: {version.combined}", file=sys.stderr)
        return 1
    if not which("npm"):
        print("ERROR: CodeGraph is missing and npm is unavailable.", file=sys.stderr)
        print("Expected command after npm is available: npm install -g @colbymchenry/codegraph@1.5.0", file=sys.stderr)
        return 1

    command = ["npm", "install", "-g", "@colbymchenry/codegraph@1.5.0"]
    print_verified_command("Verified CodeGraph install command", command)
    if not execute:
        return 0
    result = stream_command(command, root, timeout=900)
    if not result.ok:
        print(result.combined, file=sys.stderr)
        return result.returncode or 1
    return 0


def ensure_cocoindex(execute: bool) -> int:
    root = repo_root()
    if which("ccc"):
        availability = run_command(["ccc", "--help"], root, timeout=30)
        if availability.ok:
            print("CocoIndex Code already installed: available")
            return 0
        print(f"ERROR: CocoIndex Code is on PATH but its help check failed: {availability.combined}", file=sys.stderr)
        return 1

    if which("uv"):
        command = ["uv", "tool", "install", "cocoindex-code[full]==0.2.39"]
    elif which("pipx"):
        command = ["pipx", "install", "cocoindex-code[full]==0.2.39"]
    else:
        print("ERROR: CocoIndex Code is missing and neither uv nor pipx is available.", file=sys.stderr)
        print('Expected command after installing uv: uv tool install "cocoindex-code[full]==0.2.39"', file=sys.stderr)
        return 1

    print_verified_command("Verified CocoIndex Code install command", command)
    if not execute:
        return 0
    result = stream_command(command, root, timeout=1800)
    if not result.ok:
        print(result.combined, file=sys.stderr)
        return result.returncode or 1
    if not shutil.which("ccc"):
        print("ERROR: install completed but ccc is still not resolvable on PATH. Open a new shell or add the uv tool bin directory.", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply the displayed, pinned missing-tool installation commands")
    parser.add_argument("--skip-codegraph", action="store_true")
    parser.add_argument("--skip-cocoindex", action="store_true")
    args = parser.parse_args()

    failures = 0
    if not args.skip_codegraph:
        failures += 0 if ensure_codegraph(args.apply) == 0 else 1
    if not args.skip_cocoindex:
        failures += 0 if ensure_cocoindex(args.apply) == 0 else 1
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
