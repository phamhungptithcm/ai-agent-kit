#!/usr/bin/env python3
"""Validate a versioned SEO/GEO truth contract with cross-record invariants."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MAX_CONTRACT_BYTES = 2 * 1024 * 1024
PUBLIC_STATUSES = {"PUBLIC"}
NON_PUBLIC_STATUSES = {"REDIRECT", "EXCLUDED", "PRIVATE"}
CLAIM_STATUSES = {"VERIFIED", "QUALIFIED", "UNKNOWN", "STALE", "REJECTED"}
SOURCE_STATUSES = {"CURRENT", "STALE", "REVOKED", "UNAVAILABLE"}
CRAWLER_PURPOSES = {"SEARCH_RETRIEVAL", "MODEL_TRAINING", "PREVIEW", "USER_TRIGGERED", "OTHER"}
CRAWLER_DECISIONS = {"ALLOW", "BLOCK", "UNSPECIFIED"}
SUPPORT_STATUSES = {"SUPPORTED", "IGNORED", "UNVERIFIED", "NOT_APPLICABLE"}
MEASUREMENT_STATUSES = {"MEASURED", "INCONCLUSIVE", "INVALID", "NOT_MEASURED", "UNAVAILABLE"}
MEASUREMENT_LAYERS = {
    "TECHNICAL_ELIGIBILITY",
    "SEARCH_VISIBILITY",
    "AI_VISIBILITY",
    "BUSINESS_OUTCOME",
    "INTEGRITY_GUARDRAIL",
}


def add_error(errors: list[str], path: str, message: str) -> None:
    errors.append(f"{path}: {message}")


def schema_type_matches(value: Any, expected: str) -> bool:
    return {
        "array": isinstance(value, list),
        "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "null": value is None,
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "object": isinstance(value, dict),
        "string": isinstance(value, str),
    }.get(expected, False)


def resolve_schema_ref(root_schema: dict[str, Any], reference: str) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise ValueError(f"unsupported JSON Schema reference {reference!r}")
    node: Any = root_schema
    for raw_part in reference[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or part not in node:
            raise ValueError(f"unresolved JSON Schema reference {reference!r}")
        node = node[part]
    if not isinstance(node, dict):
        raise ValueError(f"JSON Schema reference {reference!r} does not resolve to an object")
    return node


def validate_schema_node(
    value: Any,
    schema: dict[str, Any],
    root_schema: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    reference = schema.get("$ref")
    if isinstance(reference, str):
        validate_schema_node(value, resolve_schema_ref(root_schema, reference), root_schema, path, errors)
        return

    if "const" in schema and value != schema["const"]:
        add_error(errors, path, f"must equal {schema['const']!r}")
    allowed = schema.get("enum")
    if isinstance(allowed, list) and value not in allowed:
        add_error(errors, path, f"must be one of {allowed!r}")

    alternatives = schema.get("oneOf")
    if isinstance(alternatives, list):
        matches = 0
        for alternative in alternatives:
            alternative_errors: list[str] = []
            if isinstance(alternative, dict):
                validate_schema_node(value, alternative, root_schema, path, alternative_errors)
            if not alternative_errors:
                matches += 1
        if matches != 1:
            add_error(errors, path, "must match exactly one allowed schema")
        return

    expected = schema.get("type")
    expected_types = [expected] if isinstance(expected, str) else expected if isinstance(expected, list) else []
    if expected_types and not any(schema_type_matches(value, item) for item in expected_types):
        add_error(errors, path, f"must have type {' or '.join(expected_types)}")
        return

    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for field in required:
                if field not in value:
                    add_error(errors, f"{path}.{field}", "is required")
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            properties = {}
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            child_path = f"{path}.{key}"
            child_schema = properties.get(key)
            if isinstance(child_schema, dict):
                validate_schema_node(item, child_schema, root_schema, child_path, errors)
            elif additional is False:
                add_error(errors, child_path, "is not an allowed property")
            elif isinstance(additional, dict):
                validate_schema_node(item, additional, root_schema, child_path, errors)
        minimum_properties = schema.get("minProperties")
        if isinstance(minimum_properties, int) and len(value) < minimum_properties:
            add_error(errors, path, f"must contain at least {minimum_properties} properties")

    if isinstance(value, list):
        minimum_items = schema.get("minItems")
        if isinstance(minimum_items, int) and len(value) < minimum_items:
            add_error(errors, path, f"must contain at least {minimum_items} items")
        if schema.get("uniqueItems") is True:
            normalized = [json.dumps(item, sort_keys=True, separators=(",", ":")) for item in value]
            if len(normalized) != len(set(normalized)):
                add_error(errors, path, "must contain unique items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_schema_node(item, item_schema, root_schema, f"{path}[{index}]", errors)

    if isinstance(value, str):
        minimum_length = schema.get("minLength")
        maximum_length = schema.get("maxLength")
        if isinstance(minimum_length, int) and len(value) < minimum_length:
            add_error(errors, path, f"must contain at least {minimum_length} characters")
        if isinstance(maximum_length, int) and len(value) > maximum_length:
            add_error(errors, path, f"must contain no more than {maximum_length} characters")
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.search(pattern, value) is None:
            add_error(errors, path, f"must match pattern {pattern!r}")
        if schema.get("format") == "date":
            try:
                dt.date.fromisoformat(value)
            except ValueError:
                add_error(errors, path, "must use YYYY-MM-DD")

    minimum = schema.get("minimum")
    if isinstance(minimum, (int, float)) and isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < minimum:
            add_error(errors, path, f"must be at least {minimum}")


def validate_schema(contract: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    validate_schema_node(contract, schema, schema, "$", errors)
    return errors


def object_list(value: Any, path: str, errors: list[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        add_error(errors, path, "must be an array")
        return []
    result: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            add_error(errors, f"{path}[{index}]", "must be an object")
            continue
        result.append(item)
    return result


def index_records(records: list[dict[str, Any]], path: str, errors: list[str]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(records):
        record_id = record.get("id")
        if not isinstance(record_id, str) or not record_id.strip():
            add_error(errors, f"{path}[{index}].id", "must be a non-empty string")
            continue
        if record_id in indexed:
            add_error(errors, f"{path}[{index}].id", f"duplicate id {record_id!r}")
            continue
        indexed[record_id] = record
    return indexed


def date_value(value: Any, path: str, errors: list[str]) -> dt.date | None:
    if not isinstance(value, str) or not value:
        add_error(errors, path, "must be an ISO date")
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        add_error(errors, path, "must use YYYY-MM-DD")
        return None


def string_list(value: Any, path: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list):
        add_error(errors, path, "must be an array")
        return []
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item:
            add_error(errors, f"{path}[{index}]", "must be a non-empty string")
            continue
        result.append(item)
    return result


def require_reference(
    value: Any,
    records: dict[str, dict[str, Any]],
    path: str,
    errors: list[str],
) -> dict[str, Any] | None:
    if not isinstance(value, str) or not value:
        add_error(errors, path, "must be a non-empty reference id")
        return None
    record = records.get(value)
    if record is None:
        add_error(errors, path, f"references unknown id {value!r}")
    return record


def validate_url(value: Any, path: str, errors: list[str], *, https_required: bool = True) -> str | None:
    if not isinstance(value, str) or not value:
        add_error(errors, path, "must be a non-empty absolute URL")
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        add_error(errors, path, "must be an absolute URL")
        return None
    if https_required and parsed.scheme != "https":
        add_error(errors, path, "must use https")
    return value


def validate_freshness(
    record: dict[str, Any],
    path: str,
    as_of: dt.date,
    errors: list[str],
    *,
    required: bool = True,
) -> None:
    reviewed_field = "verified_at" if "verified_at" in record else "reviewed_at"
    reviewed = record.get(reviewed_field)
    due = record.get("review_due_at")
    if not required and reviewed is None and due is None:
        return
    reviewed_date = date_value(reviewed, f"{path}.{reviewed_field}", errors)
    due_date = date_value(due, f"{path}.review_due_at", errors)
    if reviewed_date and due_date and reviewed_date > due_date:
        add_error(errors, f"{path}.review_due_at", "must not precede verified/reviewed date")
    if due_date and due_date < as_of:
        add_error(errors, f"{path}.review_due_at", f"is stale as of {as_of.isoformat()}")


def validate_canonical_graph(routes: list[dict[str, Any]], errors: list[str]) -> None:
    edges: dict[str, str] = {}
    for route in routes:
        url = route.get("url")
        canonical = route.get("canonical")
        if isinstance(url, str) and isinstance(canonical, str) and canonical != url:
            edges[url] = canonical

    completed: set[str] = set()
    for source in sorted(edges):
        if source in completed:
            continue
        path: list[str] = []
        positions: dict[str, int] = {}
        node = source
        while node in edges and node not in completed and node not in positions:
            positions[node] = len(path)
            path.append(node)
            node = edges[node]
        if node in positions:
            cycle = path[positions[node] :] + [node]
            add_error(errors, "routes.canonical", f"cycle detected: {' -> '.join(cycle)}")
        completed.update(path)


def validate_contract(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if contract.get("schema_version") != 1:
        add_error(errors, "schema_version", "must equal 1")

    as_of = date_value(contract.get("as_of"), "as_of", errors) or dt.date.today()
    site = contract.get("site")
    if not isinstance(site, dict):
        add_error(errors, "site", "must be an object")
        site = {}
    base_url = validate_url(site.get("base_url"), "site.base_url", errors)
    if not isinstance(site.get("owner"), str) or not site.get("owner"):
        add_error(errors, "site.owner", "must identify an accountable owner")
    locales = set(string_list(site.get("locales"), "site.locales", errors))

    routes = object_list(contract.get("routes"), "routes", errors)
    entities = object_list(contract.get("entities"), "entities", errors)
    claims = object_list(contract.get("claims"), "claims", errors)
    sources = object_list(contract.get("sources"), "sources", errors)
    crawler_policies = object_list(contract.get("crawler_policies"), "crawler_policies", errors)
    provider_surfaces = object_list(contract.get("provider_surfaces"), "provider_surfaces", errors)
    measurements = object_list(contract.get("measurements"), "measurements", errors)

    route_ids = index_records(routes, "routes", errors)
    entity_ids = index_records(entities, "entities", errors)
    claim_ids = index_records(claims, "claims", errors)
    source_ids = index_records(sources, "sources", errors)
    index_records(crawler_policies, "crawler_policies", errors)
    index_records(provider_surfaces, "provider_surfaces", errors)
    index_records(measurements, "measurements", errors)
    source_positions = {record.get("id"): index for index, record in enumerate(sources)}
    for index, source in enumerate(sources):
        path = f"sources[{index}]"
        status = source.get("status")
        if status not in SOURCE_STATUSES:
            add_error(errors, f"{path}.status", f"must be one of {sorted(SOURCE_STATUSES)}")
        locator = source.get("locator")
        if not isinstance(locator, str) or not locator:
            add_error(errors, f"{path}.locator", "must identify a reviewable repository path or URL")
        if status == "CURRENT":
            validate_freshness(source, path, as_of, errors)

    for index, entity in enumerate(entities):
        path = f"entities[{index}]"
        validate_url(entity.get("canonical_url"), f"{path}.canonical_url", errors)
        if not isinstance(entity.get("type"), str) or not entity.get("type"):
            add_error(errors, f"{path}.type", "must name a visible entity type")
        names = entity.get("names")
        if not isinstance(names, dict) or not names:
            add_error(errors, f"{path}.names", "must contain at least one locale-specific name")
        elif any(locale not in locales for locale in names):
            add_error(errors, f"{path}.names", "must use only locales declared by site.locales")

    for index, claim in enumerate(claims):
        path = f"claims[{index}]"
        status = claim.get("status")
        if status not in CLAIM_STATUSES:
            add_error(errors, f"{path}.status", f"must be one of {sorted(CLAIM_STATUSES)}")
        if not isinstance(claim.get("exact_claim"), str) or not claim.get("exact_claim"):
            add_error(errors, f"{path}.exact_claim", "must be a non-empty exact public claim")
        referenced_sources = string_list(claim.get("source_ids"), f"{path}.source_ids", errors)
        for source_id in referenced_sources:
            source = require_reference(source_id, source_ids, f"{path}.source_ids", errors)
            if status in {"VERIFIED", "QUALIFIED"} and source and source.get("status") != "CURRENT":
                add_error(errors, f"{path}.source_ids", f"source {source_id!r} is not CURRENT")
        if status in {"VERIFIED", "QUALIFIED"}:
            if not isinstance(claim.get("owner"), str) or not claim.get("owner"):
                add_error(errors, f"{path}.owner", "is required for publishable claims")
            if not referenced_sources:
                add_error(errors, f"{path}.source_ids", "publishable claims require at least one source")
            validate_freshness(claim, path, as_of, errors)
        if status == "QUALIFIED" and (not isinstance(claim.get("qualification"), str) or not claim.get("qualification")):
            add_error(errors, f"{path}.qualification", "is required for QUALIFIED claims")
        for scope_id in string_list(claim.get("scopes"), f"{path}.scopes", errors):
            require_reference(scope_id, route_ids, f"{path}.scopes", errors)

    routes_by_url: dict[str, dict[str, Any]] = {}
    route_positions: dict[str, int] = {}
    for index, route in enumerate(routes):
        path = f"routes[{index}]"
        url = validate_url(route.get("url"), f"{path}.url", errors)
        if url:
            if url in routes_by_url:
                add_error(errors, f"{path}.url", f"duplicate URL {url!r}")
            routes_by_url[url] = route
            route_positions[url] = index
            if base_url and not url.startswith(base_url.rstrip("/") + "/") and url != base_url.rstrip("/"):
                add_error(errors, f"{path}.url", "must remain under site.base_url")
        status = route.get("status")
        if status not in PUBLIC_STATUSES | NON_PUBLIC_STATUSES:
            add_error(errors, f"{path}.status", "must be PUBLIC, REDIRECT, EXCLUDED, or PRIVATE")
        locale = route.get("locale")
        if locale not in locales:
            add_error(errors, f"{path}.locale", "must be declared by site.locales")
        indexable = route.get("indexable")
        sitemap = route.get("sitemap")
        if not isinstance(indexable, bool):
            add_error(errors, f"{path}.indexable", "must be boolean")
        if not isinstance(sitemap, bool):
            add_error(errors, f"{path}.sitemap", "must be boolean")
        robots = route.get("robots")
        if indexable is True and robots not in {"INDEX_FOLLOW", "INDEX_NOFOLLOW"}:
            add_error(errors, f"{path}.robots", "indexable routes require an INDEX directive")
        if indexable is False and robots not in {"NOINDEX_FOLLOW", "NOINDEX_NOFOLLOW"}:
            add_error(errors, f"{path}.robots", "non-indexable routes require a NOINDEX directive")
        canonical = route.get("canonical")
        if status == "PUBLIC":
            validate_url(canonical, f"{path}.canonical", errors)
            validate_freshness(route, path, as_of, errors)
        if status == "REDIRECT":
            validate_url(route.get("redirect_target"), f"{path}.redirect_target", errors)
            if indexable is not False or sitemap is not False:
                add_error(errors, path, "redirect routes must be non-indexable and sitemap-excluded")
            if canonical is not None:
                add_error(errors, f"{path}.canonical", "redirect routes must not emit a canonical")
        if status in {"EXCLUDED", "PRIVATE"} and (indexable is not False or sitemap is not False):
            add_error(errors, path, f"{status.lower()} routes must be non-indexable and sitemap-excluded")
        if sitemap is True and (status != "PUBLIC" or indexable is not True or canonical != url):
            add_error(errors, f"{path}.sitemap", "may include only self-canonical, public, indexable URLs")
        for entity_id in string_list(route.get("primary_entity_ids"), f"{path}.primary_entity_ids", errors):
            require_reference(entity_id, entity_ids, f"{path}.primary_entity_ids", errors)
        structured = object_list(route.get("structured_data", []), f"{path}.structured_data", errors)
        for item_index, item in enumerate(structured):
            item_path = f"{path}.structured_data[{item_index}]"
            if not isinstance(item.get("type"), str) or not item.get("type"):
                add_error(errors, f"{item_path}.type", "must name the visible schema type")
            for entity_id in string_list(item.get("entity_ids"), f"{item_path}.entity_ids", errors):
                require_reference(entity_id, entity_ids, f"{item_path}.entity_ids", errors)
            for claim_id in string_list(item.get("claim_ids"), f"{item_path}.claim_ids", errors):
                claim = require_reference(claim_id, claim_ids, f"{item_path}.claim_ids", errors)
                if claim and claim.get("status") not in {"VERIFIED", "QUALIFIED"}:
                    add_error(errors, f"{item_path}.claim_ids", f"claim {claim_id!r} is not publishable")

    for index, route in enumerate(routes):
        path = f"routes[{index}]"
        canonical = route.get("canonical")
        if isinstance(canonical, str):
            target = routes_by_url.get(canonical)
            if target is None:
                add_error(errors, f"{path}.canonical", "must resolve to a declared route")
            elif target.get("status") != "PUBLIC" or target.get("indexable") is not True:
                add_error(errors, f"{path}.canonical", "must target a public, indexable route")
        alternates = object_list(route.get("alternates", []), f"{path}.alternates", errors)
        alternate_locales: set[str] = set()
        alternate_urls: set[str] = set()
        for alternate_index, alternate in enumerate(alternates):
            alt_path = f"{path}.alternates[{alternate_index}]"
            locale = alternate.get("locale")
            target_url = alternate.get("url")
            if not isinstance(locale, str) or not locale:
                add_error(errors, f"{alt_path}.locale", "must be a non-empty locale")
            elif locale in alternate_locales:
                add_error(errors, f"{alt_path}.locale", f"duplicates alternate locale {locale!r}")
            else:
                alternate_locales.add(locale)
            if isinstance(target_url, str) and target_url in alternate_urls:
                add_error(errors, f"{alt_path}.url", f"duplicates alternate URL {target_url!r}")
            elif isinstance(target_url, str):
                alternate_urls.add(target_url)
            target = routes_by_url.get(target_url) if isinstance(target_url, str) else None
            if target is None:
                add_error(errors, f"{alt_path}.url", "must resolve to a declared route")
                continue
            if target.get("status") != "PUBLIC" or target.get("indexable") is not True:
                add_error(errors, f"{alt_path}.url", "must target a public, indexable route")
            if locale != target.get("locale"):
                add_error(errors, f"{alt_path}.locale", "must equal the target route locale")
            if target_url == route.get("url"):
                continue
            source_locale = route.get("locale")
            reciprocal = any(
                isinstance(item, dict)
                and item.get("locale") == source_locale
                and item.get("url") == route.get("url")
                for item in target.get("alternates", [])
            )
            if not reciprocal:
                target_index = route_positions.get(target_url, "?")
                add_error(errors, f"routes[{target_index}].alternates", f"missing reciprocal alternate to {route.get('url')!r}")

    validate_canonical_graph(routes, errors)

    crawler_keys: dict[tuple[str, str, str], str] = {}
    for index, policy in enumerate(crawler_policies):
        path = f"crawler_policies[{index}]"
        provider = policy.get("provider")
        user_agent = policy.get("user_agent")
        purpose = policy.get("purpose")
        decision = policy.get("decision")
        if not isinstance(provider, str) or not provider:
            add_error(errors, f"{path}.provider", "must be a non-empty provider")
        if not isinstance(user_agent, str) or not user_agent:
            add_error(errors, f"{path}.user_agent", "must be a non-empty user agent")
        if purpose not in CRAWLER_PURPOSES:
            add_error(errors, f"{path}.purpose", f"must be one of {sorted(CRAWLER_PURPOSES)}")
        if decision not in CRAWLER_DECISIONS:
            add_error(errors, f"{path}.decision", f"must be one of {sorted(CRAWLER_DECISIONS)}")
        key = (str(provider), str(user_agent), str(purpose))
        prior = crawler_keys.get(key)
        if prior is not None and prior != decision:
            add_error(errors, path, f"conflicts with another decision for {key}")
        crawler_keys[key] = str(decision)
        source = require_reference(policy.get("official_source_id"), source_ids, f"{path}.official_source_id", errors)
        if source:
            source_index = source_positions.get(source.get("id"), "?")
            if source.get("type") != "OFFICIAL_PROVIDER" or source.get("status") != "CURRENT":
                add_error(errors, f"sources[{source_index}]", "crawler policy sources must be CURRENT OFFICIAL_PROVIDER records")
        validate_freshness(policy, path, as_of, errors)

    surface_keys: set[tuple[str, str]] = set()
    for index, surface in enumerate(provider_surfaces):
        path = f"provider_surfaces[{index}]"
        provider = surface.get("provider")
        feature = surface.get("feature")
        support = surface.get("support_status")
        if not isinstance(provider, str) or not provider:
            add_error(errors, f"{path}.provider", "must be a non-empty provider")
        if not isinstance(feature, str) or not feature:
            add_error(errors, f"{path}.feature", "must be a non-empty feature")
        if support not in SUPPORT_STATUSES:
            add_error(errors, f"{path}.support_status", f"must be one of {sorted(SUPPORT_STATUSES)}")
        key = (str(provider), str(feature))
        if key in surface_keys:
            add_error(errors, path, f"duplicate provider feature {key}")
        surface_keys.add(key)
        source = require_reference(surface.get("official_source_id"), source_ids, f"{path}.official_source_id", errors)
        if source and (source.get("type") != "OFFICIAL_PROVIDER" or source.get("status") != "CURRENT"):
            add_error(errors, f"{path}.official_source_id", "must reference a CURRENT OFFICIAL_PROVIDER source")
        validate_freshness(surface, path, as_of, errors)

    for index, measurement in enumerate(measurements):
        path = f"measurements[{index}]"
        layer = measurement.get("layer")
        status = measurement.get("status")
        if layer not in MEASUREMENT_LAYERS:
            add_error(errors, f"{path}.layer", f"must be one of {sorted(MEASUREMENT_LAYERS)}")
        if status not in MEASUREMENT_STATUSES:
            add_error(errors, f"{path}.status", f"must be one of {sorted(MEASUREMENT_STATUSES)}")
        if not isinstance(measurement.get("metric"), str) or not measurement.get("metric"):
            add_error(errors, f"{path}.metric", "must be a non-empty metric definition")
        if status == "MEASURED":
            required = ["value", "evidence_source", "observed_from", "observed_to", "sample_size", "limitations"]
            for field in required:
                if field not in measurement:
                    add_error(errors, f"{path}.{field}", "is required when status is MEASURED")
            observed_from = date_value(measurement.get("observed_from"), f"{path}.observed_from", errors)
            observed_to = date_value(measurement.get("observed_to"), f"{path}.observed_to", errors)
            if observed_from and observed_to and observed_from > observed_to:
                add_error(errors, f"{path}.observed_to", "must not precede observed_from")
            if not isinstance(measurement.get("evidence_source"), str) or not measurement.get("evidence_source"):
                add_error(errors, f"{path}.evidence_source", "must be a non-empty evidence reference")
            sample_size = measurement.get("sample_size")
            if not isinstance(sample_size, int) or isinstance(sample_size, bool) or sample_size < 1:
                add_error(errors, f"{path}.sample_size", "must be a positive integer")
            string_list(measurement.get("limitations"), f"{path}.limitations", errors)
        elif "value" in measurement:
            add_error(errors, f"{path}.value", "must be omitted unless status is MEASURED")

    return sorted(set(errors))


def load_contract(path: Path) -> dict[str, Any]:
    root = Path.cwd().resolve()
    candidate = path if path.is_absolute() else root / path
    if candidate.is_symlink():
        raise ValueError("contract must be a bounded regular file, not a symlink")
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("contract path must remain inside the current repository") from exc
    stat = resolved.lstat()
    if resolved.is_symlink() or not resolved.is_file() or stat.st_size > MAX_CONTRACT_BYTES:
        raise ValueError("contract must be a bounded regular file")
    data = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("contract root must be a JSON object")
    return data


def load_schema() -> dict[str, Any]:
    schema_path = Path(__file__).resolve().parent.parent / "templates" / "seo-geo-contract.schema.json"
    if not schema_path.is_file() or schema_path.stat().st_size > MAX_CONTRACT_BYTES:
        raise ValueError("bundled SEO/GEO contract schema is missing or invalid")
    data = json.loads(schema_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("bundled SEO/GEO contract schema root must be an object")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract", type=Path)
    parser.add_argument("--json", action="store_true", help="emit machine-readable validation output")
    args = parser.parse_args()
    try:
        contract = load_contract(args.contract)
        errors = validate_schema(contract, load_schema()) + validate_contract(contract)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors = [f"contract: {exc}"]
    if args.json:
        print(json.dumps({"valid": not errors, "errors": errors}, indent=2, sort_keys=True))
    elif errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
    else:
        print("SEO/GEO contract validation passed")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
