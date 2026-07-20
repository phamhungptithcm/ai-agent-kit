#!/usr/bin/env python3
"""Build or update CodeGraph and CocoIndex indexes for this repository."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from repository_intelligence_lib import (
    cocoindex_version,
    codegraph_version,
    print_command_failure,
    repo_root,
    save_state,
    stream_command,
    which,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true", help="suppress tool progress output")
    parser.add_argument("--skip-codegraph", action="store_true")
    parser.add_argument("--skip-cocoindex", action="store_true")
    parser.add_argument("--timeout", type=int, default=3600, help="per-tool timeout in seconds")
    args = parser.parse_args()

    root = repo_root()
    if not args.skip_codegraph:
        if not which("codegraph"):
            print("ERROR: codegraph is not installed. Run .ai/scripts/install-repository-intelligence.py --execute", file=sys.stderr)
            return 1
        command = ["codegraph", "sync", ".", "--quiet"] if (root / ".codegraph").exists() else ["codegraph", "init", "."]
        result = stream_command(command, root, timeout=args.timeout, quiet=args.quiet)
        if not result.ok:
            print_command_failure(result)
            return result.returncode or 1

    if not args.skip_cocoindex:
        if not which("ccc"):
            print("ERROR: ccc is not installed. Run .ai/scripts/install-repository-intelligence.py --execute", file=sys.stderr)
            return 1
        result = stream_command(["ccc", "index"], root, timeout=args.timeout, quiet=args.quiet)
        if not result.ok:
            print_command_failure(result)
            return result.returncode or 1

    state = save_state(root, codegraph_version(root), cocoindex_version(root))
    if not args.quiet:
        print(f"repository intelligence indexes recorded for {state['git_commit']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
