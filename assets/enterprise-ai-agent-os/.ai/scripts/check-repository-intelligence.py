#!/usr/bin/env python3
"""Check the mandatory Repository Intelligence Gate."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from repository_intelligence_lib import (
    check_cocoindex,
    check_codegraph,
    gate_mode,
    gate_ready,
    gate_report,
    load_state,
    manual_commands,
    python_executable,
    repo_root,
)


def maybe_refresh(root: Path, quiet: bool) -> None:
    state = load_state(root)
    codegraph = check_codegraph(root, state)
    cocoindex = check_cocoindex(root, state)
    if gate_ready(codegraph, cocoindex):
        return
    if codegraph.installation != "Installed" or cocoindex.installation != "Installed":
        return
    if codegraph.index_status == "Missing" or cocoindex.index_status == "Missing":
        return
    subprocess.run(
        [python_executable(), str(root / ".ai" / "scripts" / "refresh-repository-index.py"), "--quiet"],
        cwd=root,
        text=True,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.DEVNULL if quiet else None,
        check=False,
    )


def hook_output(report: str, ready: bool) -> str:
    context = (
        report
        + (
            "\nUse CodeGraph first and CocoIndex second when they are ready, then verify critical conclusions against source."
            if ready
            else "\nRepository intelligence is DEGRADED. Continue with targeted source reads, rg/rg --files, Git history, "
            "compiler or language-server output, and tests. Record the unavailable index evidence and do not overstate confidence."
        )
    )
    payload: dict[str, object] = {
        "continue": True,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }
    if not ready:
        payload["systemMessage"] = (
            "Repository intelligence is DEGRADED, not blocked. Continue with bounded native repository inspection, "
            "state the evidence limitation, and preserve approval and risk gates."
        )
    return json.dumps(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit machine-readable status")
    parser.add_argument("--hook", action="store_true", help="emit Codex SessionStart hook JSON")
    parser.add_argument("--quiet", action="store_true", help="suppress non-essential output")
    parser.add_argument("--refresh-if-stale", action="store_true", help="run an incremental refresh when both indexes exist but are stale")
    args = parser.parse_args()

    root = repo_root()
    if args.refresh_if_stale:
        maybe_refresh(root, quiet=args.quiet or args.hook)

    state = load_state(root)
    codegraph = check_codegraph(root, state)
    cocoindex = check_cocoindex(root, state)
    ready = gate_ready(codegraph, cocoindex)
    report = gate_report(root, codegraph, cocoindex)

    if args.json:
        print(
            json.dumps(
                {
                    "ready": ready,
                    "mode": gate_mode(codegraph, cocoindex),
                    "codegraph": codegraph.as_dict(),
                    "cocoindex": cocoindex.as_dict(),
                    "manual_commands": manual_commands(codegraph, cocoindex),
                },
                indent=2,
                sort_keys=True,
            )
        )
    elif args.hook:
        print(hook_output(report, ready))
    elif not args.quiet or not ready:
        print(report)
        if not ready:
            print("Optional recovery commands (work may continue with native repository evidence):")
            for command in manual_commands(codegraph, cocoindex):
                print(f"- {command}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
