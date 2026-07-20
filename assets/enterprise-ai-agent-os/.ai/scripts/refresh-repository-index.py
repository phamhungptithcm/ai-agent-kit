#!/usr/bin/env python3
"""Incrementally refresh existing repository-intelligence indexes."""

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
    parser.add_argument("--timeout", type=int, default=1800, help="per-tool timeout in seconds")
    args = parser.parse_args()

    root = repo_root()
    if not which("codegraph"):
        print("ERROR: codegraph is not installed.", file=sys.stderr)
        return 1
    if not which("ccc"):
        print("ERROR: ccc is not installed.", file=sys.stderr)
        return 1
    if not (root / ".codegraph").exists() or not (root / ".cocoindex_code").exists():
        print("ERROR: one or more indexes are missing. Run .ai/scripts/index-repository.py instead.", file=sys.stderr)
        return 1

    codegraph = stream_command(["codegraph", "sync", ".", "--quiet"], root, timeout=args.timeout, quiet=True)
    if not codegraph.ok:
        print_command_failure(codegraph)
        return codegraph.returncode or 1

    cocoindex = stream_command(["ccc", "index"], root, timeout=args.timeout, quiet=args.quiet)
    if not cocoindex.ok:
        print_command_failure(cocoindex)
        return cocoindex.returncode or 1

    state = save_state(root, codegraph_version(root), cocoindex_version(root))
    if not args.quiet:
        print(f"repository intelligence indexes refreshed for {state['git_commit']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
