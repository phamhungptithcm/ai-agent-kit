#!/usr/bin/env python3
"""Fail-closed validation for skill provenance, dispatch, and capability coverage."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MAX_JSON_BYTES = 2 * 1024 * 1024
MODES = {"ROUTED", "COMPOSED", "EXPLICIT_ONLY", "INTERNAL"}
SOURCE_STATUSES = {"ADAPT", "VENDOR", "REFERENCE_ONLY", "REJECT"}


def load_json(path: Path, label: str) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
        raise ValueError(f"{label} must be a bounded regular JSON file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def safe_file(root: Path, relative: str, label: str) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"{label} must stay inside the .ai root")
    candidate = root / relative
    current = root
    for part in Path(relative).parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f"{label} must not traverse symbolic links: {relative}")
    if not candidate.is_file():
        raise ValueError(f"{label} does not exist: {relative}")
    candidate.resolve(strict=True).relative_to(root.resolve(strict=True))
    return candidate


def validate_sources(lock: dict) -> set[str]:
    if lock.get("schema_version") != 1:
        raise ValueError("external source lock requires schema_version 1")
    policy = lock.get("policy")
    if not isinstance(policy, dict) or policy.get("execution") != "QUARANTINE_NO_EXECUTION":
        raise ValueError("external source lock must quarantine all source code")
    if not all(policy.get(field) is True for field in ("require_manual_security_review", "require_exact_commit", "require_source_hash")):
        raise ValueError("external source lock must require review, exact commits, and hashes")
    allowed = set(policy.get("allowed_adaptation_licenses", []))
    sources = lock.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("external source lock requires sources")
    ids: set[str] = set()
    for index, source in enumerate(sources):
        label = f"sources[{index}]"
        if not isinstance(source, dict):
            raise ValueError(f"{label} must be an object")
        source_id = source.get("id")
        if not isinstance(source_id, str) or not source_id or source_id in ids:
            raise ValueError(f"{label}.id must be unique and non-empty")
        ids.add(source_id)
        if not re.fullmatch(r"[a-f0-9]{40}", str(source.get("commit", ""))):
            raise ValueError(f"{label}.commit must be an exact 40-character hash")
        status = source.get("status")
        if status not in SOURCE_STATUSES:
            raise ValueError(f"{label}.status is invalid")
        source_hash = source.get("source_sha256")
        if status in {"ADAPT", "VENDOR"}:
            if source.get("license") not in allowed:
                raise ValueError(f"{label} has a disallowed or unknown adaptation license")
            if not re.fullmatch(r"[a-f0-9]{64}", str(source_hash or "")):
                raise ValueError(f"{label}.source_sha256 is required for adapted or vendored content")
            if not source.get("adapted_concepts"):
                raise ValueError(f"{label} must record adapted concepts")
        if status == "VENDOR":
            raise ValueError(f"{label} requests vendoring; this release permits adaptation only")
        if not isinstance(source.get("review"), str) or not source["review"].strip():
            raise ValueError(f"{label}.review is required")
    return ids


def validate(root: Path, coverage_file: Path) -> dict:
    root = root.resolve(strict=True)
    coverage = load_json(coverage_file, "capability coverage")
    if coverage.get("schema_version") != 1:
        raise ValueError("capability coverage requires schema_version 1")
    lock_file = safe_file(root, coverage.get("external_source_lock", ""), "external_source_lock")
    source_ids = validate_sources(load_json(lock_file, "external source lock"))
    routing_file = safe_file(root, coverage.get("routing_config", ""), "routing_config")
    routing = load_json(routing_file, "skill routing config")
    routes = routing.get("routes")
    if not isinstance(routes, dict):
        raise ValueError("skill routing config requires routes")

    skills_root = root / "skills-src"
    if skills_root.is_symlink() or not skills_root.is_dir():
        raise ValueError("skills-src must be a real directory")
    actual_skills = {item.name for item in skills_root.iterdir() if item.is_dir() and not item.is_symlink() and (item / "SKILL.md").is_file()}
    catalog = coverage.get("skill_catalog")
    if not isinstance(catalog, dict):
        raise ValueError("skill_catalog must be an object")
    catalog_skills = set(catalog)
    if actual_skills != catalog_skills:
        missing = sorted(actual_skills - catalog_skills)
        stale = sorted(catalog_skills - actual_skills)
        raise ValueError(f"skill catalog must cover canonical skills exactly; missing={missing or 'none'} stale={stale or 'none'}")

    routed_skills: dict[str, str] = {}
    for route_id, route in routes.items():
        skill_path = route.get("skill") if isinstance(route, dict) else None
        if not isinstance(skill_path, str) or not skill_path.endswith("/SKILL.md"):
            raise ValueError(f"route {route_id} has an invalid skill path")
        skill = skill_path.split("/", 1)[0]
        if skill in routed_skills:
            raise ValueError(f"skill {skill} is referenced by multiple routes")
        routed_skills[skill] = route_id

    for skill, metadata in catalog.items():
        if not isinstance(metadata, dict) or metadata.get("dispatch_mode") not in MODES:
            raise ValueError(f"skill {skill} has an invalid dispatch mode")
        if not re.fullmatch(r"\d+\.\d+\.\d+", str(metadata.get("introduced_in", ""))):
            raise ValueError(f"skill {skill} must declare a semantic introduced_in version")
        if not isinstance(metadata.get("capability"), str) or not metadata["capability"]:
            raise ValueError(f"skill {skill} must declare a capability")
        if metadata["dispatch_mode"] == "ROUTED" and skill not in routed_skills:
            raise ValueError(f"routed skill {skill} has no route")
        if metadata["dispatch_mode"] != "ROUTED" and skill in routed_skills:
            raise ValueError(f"non-routed skill {skill} is unexpectedly present in routing")
        unknown_sources = set(metadata.get("source_ids", [])) - source_ids
        if unknown_sources:
            raise ValueError(f"skill {skill} references unknown sources: {sorted(unknown_sources)}")

    manifest_file = safe_file(root, "manifest.yaml", "manifest")
    manifest_text = manifest_file.read_text(encoding="utf-8")
    capabilities = coverage.get("capabilities")
    if not isinstance(capabilities, list) or not capabilities:
        raise ValueError("capabilities requires at least one entry")
    covered_capability_skills: set[str] = set()
    artifact_count = 0
    for index, capability in enumerate(capabilities):
        if not isinstance(capability, dict):
            raise ValueError(f"capabilities[{index}] must be an object")
        for skill in capability.get("skills", []):
            if skill not in catalog:
                raise ValueError(f"capability {capability.get('id')} references unknown skill {skill}")
            if catalog[skill]["capability"] != capability.get("id"):
                raise ValueError(f"skill {skill} capability metadata disagrees with capability entry")
            covered_capability_skills.add(skill)
        for artifact in capability.get("required_artifacts", []):
            safe_file(root, artifact, f"capability {capability.get('id')} artifact")
            manifest_path = f'.ai/{artifact}'
            if manifest_path not in manifest_text:
                raise ValueError(f"capability artifact is not registered in manifest: {manifest_path}")
            artifact_count += 1

    return {
        "schema_version": 1,
        "status": "VALID",
        "target_version": coverage.get("target_version"),
        "skill_count": len(actual_skills),
        "route_count": len(routes),
        "source_count": len(source_ids),
        "capability_count": len(capabilities),
        "capability_skill_count": len(covered_capability_skills),
        "artifact_count": artifact_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--coverage", type=Path)
    args = parser.parse_args()
    coverage = args.coverage or args.root / "config" / "capability-coverage.json"
    try:
        print(json.dumps(validate(args.root, coverage), indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError) as exc:
        print(json.dumps({"schema_version": 1, "status": "INVALID", "error": str(exc)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
