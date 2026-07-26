#!/usr/bin/env python3
"""Validate behavioral cases or score recorded agent responses offline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", default=".ai/evals/behavioral-cases.json")
    parser.add_argument("--responses-dir", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = cases_path if cases_path.exists() else root / cases_path
    payload = json.loads(cases_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    cases = payload.get("cases", [])
    ids: set[str] = set()
    for case in cases:
        case_id = case.get("id", "")
        if not case_id or case_id in ids:
            errors.append(f"missing or duplicate case id: {case_id!r}")
        ids.add(case_id)
        if not case.get("required") or not case.get("forbidden"):
            errors.append(f"{case_id}: required and forbidden checks must be non-empty")
        if args.responses_dir:
            response_path = args.responses_dir / case.get("response_file", "")
            if not response_path.exists():
                errors.append(f"{case_id}: response missing: {response_path}")
                continue
            response = response_path.read_text(encoding="utf-8", errors="replace").lower()
            for phrase in case["required"]:
                if phrase.lower() not in response:
                    errors.append(f"{case_id}: required phrase missing: {phrase}")
            for phrase in case["forbidden"]:
                if phrase.lower() in response:
                    errors.append(f"{case_id}: forbidden phrase present: {phrase}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    mode = "response scoring" if args.responses_dir else "schema validation"
    print(f"behavioral evaluation passed ({len(cases)} cases, {mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
