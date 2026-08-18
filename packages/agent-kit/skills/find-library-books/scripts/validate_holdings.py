#!/usr/bin/env python3
"""Validate, deduplicate, and rank canonical library holding records."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MATCH_LEVELS = {"exact_edition", "same_work", "unverified"}
STATUSES = {
    "available",
    "checked_out",
    "reservable",
    "in_library_use_only",
    "ebook_available",
    "not_available",
    "unknown",
}
EVIDENCE_LEVELS = {"nearby_only", "catalog_holding", "realtime_circulation"}
REALTIME_STATUSES = {"available", "checked_out", "reservable", "ebook_available"}


def nested(record: dict[str, Any], *path: str) -> Any:
    value: Any = record
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def valid_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def validate_record(record: dict[str, Any], index: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    prefix = f"holdings[{index}]"

    required = {
        "provider_id": nested(record, "provider_id"),
        "library.name": nested(record, "library", "name"),
        "branch.name": nested(record, "branch", "name"),
        "book_match.level": nested(record, "book_match", "level"),
        "availability.status": nested(record, "availability", "status"),
        "availability.evidence_level": nested(record, "availability", "evidence_level"),
        "source.observed_at": nested(record, "source", "observed_at"),
    }
    for field, value in required.items():
        if value in (None, ""):
            errors.append(f"{prefix}.{field}: required")

    match_level = required["book_match.level"]
    status = required["availability.status"]
    evidence = required["availability.evidence_level"]
    if match_level not in MATCH_LEVELS:
        errors.append(f"{prefix}.book_match.level: invalid value {match_level!r}")
    if status not in STATUSES:
        errors.append(f"{prefix}.availability.status: invalid value {status!r}")
    if evidence not in EVIDENCE_LEVELS:
        errors.append(f"{prefix}.availability.evidence_level: invalid value {evidence!r}")

    if match_level == "exact_edition" and not nested(record, "book_match", "identifiers"):
        errors.append(f"{prefix}.book_match.identifiers: required for exact_edition")
    if status in REALTIME_STATUSES and evidence != "realtime_circulation":
        errors.append(f"{prefix}: {status} requires realtime_circulation evidence")
    if evidence == "nearby_only" and status != "unknown":
        errors.append(f"{prefix}: nearby_only must use unknown availability")
    if not valid_timestamp(required["source.observed_at"]):
        errors.append(f"{prefix}.source.observed_at: ISO 8601 timezone required")

    source_url = nested(record, "source", "url")
    if source_url is not None and not valid_url(source_url):
        errors.append(f"{prefix}.source.url: valid HTTP(S) URL required")
    if evidence != "nearby_only" and not source_url:
        warnings.append(f"{prefix}.source.url: add a verifiable catalog/provider link")

    distance = record.get("distance_km")
    if distance is not None and (not isinstance(distance, (int, float)) or distance < 0):
        errors.append(f"{prefix}.distance_km: non-negative number required")
    return errors, warnings


def dedupe_and_rank(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence_rank = {"realtime_circulation": 0, "catalog_holding": 1, "nearby_only": 2}
    match_rank = {"exact_edition": 0, "same_work": 1, "unverified": 2}
    status_rank = {"available": 0, "ebook_available": 1, "reservable": 2, "checked_out": 3, "in_library_use_only": 4, "not_available": 5, "unknown": 6}
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for record in records:
        key = (
            str(record.get("provider_id", "")),
            str(nested(record, "branch", "id") or nested(record, "branch", "name") or ""),
            json.dumps(nested(record, "book_match", "identifiers") or {}, sort_keys=True),
        )
        unique[key] = record
    return sorted(
        unique.values(),
        key=lambda item: (
            evidence_rank.get(nested(item, "availability", "evidence_level"), 9),
            match_rank.get(nested(item, "book_match", "level"), 9),
            status_rank.get(nested(item, "availability", "status"), 9),
            item.get("distance_km") if isinstance(item.get("distance_km"), (int, float)) else float("inf"),
        ),
    )


def process(payload: Any) -> dict[str, Any]:
    records = payload.get("holdings", []) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        return {"valid": False, "errors": ["Input must be a list or an object with holdings[]"], "warnings": [], "holdings": []}
    errors: list[str] = []
    warnings: list[str] = []
    typed_records: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"holdings[{index}]: object required")
            continue
        typed_records.append(record)
        record_errors, record_warnings = validate_record(record, index)
        errors.extend(record_errors)
        warnings.extend(record_warnings)
    return {"valid": not errors, "errors": errors, "warnings": warnings, "holdings": dedupe_and_rank(typed_records)}


def self_test() -> None:
    sample = {
        "holdings": [
            {
                "provider_id": "osm",
                "library": {"name": "Nearby Library"},
                "branch": {"name": "Nearby Branch"},
                "distance_km": 1.0,
                "book_match": {"level": "unverified", "identifiers": {}},
                "availability": {"status": "unknown", "evidence_level": "nearby_only"},
                "source": {"url": "https://openstreetmap.org/", "observed_at": "2026-08-17T10:00:00Z"},
            },
            {
                "provider_id": "koha",
                "library": {"name": "City Library"},
                "branch": {"id": "central", "name": "Central"},
                "distance_km": 3.0,
                "book_match": {"level": "exact_edition", "identifiers": {"isbn13": "9780000000000"}},
                "availability": {"status": "available", "evidence_level": "realtime_circulation"},
                "source": {"url": "https://library.example/item/1", "observed_at": "2026-08-17T10:00:00Z"},
            },
        ]
    }
    result = process(sample)
    assert result["valid"], result
    assert result["holdings"][0]["provider_id"] == "koha"
    print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", help="Canonical holdings JSON file; reads stdin when omitted")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.input:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    else:
        import sys

        payload = json.load(sys.stdin)
    print(json.dumps(process(payload), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

