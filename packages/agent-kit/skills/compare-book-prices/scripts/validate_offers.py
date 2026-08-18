#!/usr/bin/env python3
"""Validate, deduplicate, group, and rank canonical book offers."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MATCH_LEVELS = {"exact_edition", "same_work", "unverified"}
PURCHASE_TYPES = {"buy", "preorder", "rental", "subscription"}
CONDITIONS = {"new", "used_like_new", "used_good", "used_acceptable", "digital", "unknown"}
STOCK_STATES = {"in_stock", "limited", "preorder", "out_of_stock", "unknown"}
COMPLETENESS = {"landed_total", "tax_included", "shipping_known_tax_unknown", "item_only", "not_comparable"}
TOTAL_KNOWN = {"landed_total", "tax_included"}


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


def non_negative_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


def validate_record(record: dict[str, Any], index: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    prefix = f"offers[{index}]"
    required = {
        "provider_id": record.get("provider_id"),
        "offer_id": record.get("offer_id"),
        "book_match.level": nested(record, "book_match", "level"),
        "merchant.name": nested(record, "merchant", "name"),
        "purchase.type": nested(record, "purchase", "type"),
        "purchase.condition": nested(record, "purchase", "condition"),
        "purchase.stock_status": nested(record, "purchase", "stock_status"),
        "price.currency": nested(record, "price", "currency"),
        "price.item": nested(record, "price", "item"),
        "price.total_completeness": nested(record, "price", "total_completeness"),
        "source.url": nested(record, "source", "url"),
        "source.observed_at": nested(record, "source", "observed_at"),
    }
    for field, value in required.items():
        if value in (None, ""):
            errors.append(f"{prefix}.{field}: required")

    match = required["book_match.level"]
    purchase_type = required["purchase.type"]
    condition = required["purchase.condition"]
    stock = required["purchase.stock_status"]
    completeness = required["price.total_completeness"]
    if match not in MATCH_LEVELS:
        errors.append(f"{prefix}.book_match.level: invalid value {match!r}")
    if purchase_type not in PURCHASE_TYPES:
        errors.append(f"{prefix}.purchase.type: invalid value {purchase_type!r}")
    if condition not in CONDITIONS:
        errors.append(f"{prefix}.purchase.condition: invalid value {condition!r}")
    if stock not in STOCK_STATES:
        errors.append(f"{prefix}.purchase.stock_status: invalid value {stock!r}")
    if completeness not in COMPLETENESS:
        errors.append(f"{prefix}.price.total_completeness: invalid value {completeness!r}")
    if match == "exact_edition" and not nested(record, "book_match", "identifiers"):
        errors.append(f"{prefix}.book_match.identifiers: required for exact_edition")

    currency = required["price.currency"]
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        errors.append(f"{prefix}.price.currency: ISO 4217 three-letter code required")
    for field in ("item", "shipping", "tax", "landed_total"):
        value = nested(record, "price", field)
        if value is not None and not non_negative_number(value):
            errors.append(f"{prefix}.price.{field}: non-negative number required")

    total = nested(record, "price", "landed_total")
    item = nested(record, "price", "item")
    shipping = nested(record, "price", "shipping")
    tax = nested(record, "price", "tax")
    if completeness in TOTAL_KNOWN and total is None:
        errors.append(f"{prefix}.price.landed_total: required for {completeness}")
    if non_negative_number(total) and non_negative_number(item) and total < item:
        errors.append(f"{prefix}.price.landed_total: cannot be lower than item price")
    if completeness in TOTAL_KNOWN and all(non_negative_number(value) for value in (item, shipping, tax)):
        expected = round(float(item) + float(shipping) + float(tax), 2)
        if abs(float(total) - expected) > 0.02:
            errors.append(f"{prefix}.price.landed_total: expected {expected:.2f} from known components")

    if not valid_url(required["source.url"]):
        errors.append(f"{prefix}.source.url: valid HTTP(S) URL required")
    if not valid_timestamp(required["source.observed_at"]):
        errors.append(f"{prefix}.source.observed_at: ISO 8601 timezone required")
    if nested(record, "affiliate", "is_affiliate") is True and not nested(record, "affiliate", "disclosure"):
        errors.append(f"{prefix}.affiliate.disclosure: required for affiliate offers")
    if completeness not in TOTAL_KNOWN:
        warnings.append(f"{prefix}: landed total is incomplete or not comparable")
    return errors, warnings


def group_key(record: dict[str, Any]) -> str:
    if nested(record, "book_match", "level") != "exact_edition":
        return "alternative_or_unverified"
    if nested(record, "price", "total_completeness") not in TOTAL_KNOWN:
        return "exact_edition_incomplete_total"
    return "exact_edition_comparable"


def dedupe_and_group(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        unique[(str(record.get("provider_id", "")), str(record.get("offer_id", "")))] = record
    groups = {key: [] for key in ("exact_edition_comparable", "exact_edition_incomplete_total", "alternative_or_unverified")}
    for record in unique.values():
        groups[group_key(record)].append(record)
    groups["exact_edition_comparable"].sort(
        key=lambda offer: (
            str(nested(offer, "purchase", "destination_country") or ""),
            str(nested(offer, "price", "currency") or ""),
            str(nested(offer, "purchase", "condition") or ""),
            float(nested(offer, "price", "landed_total")),
        )
    )
    return groups


def process(payload: Any) -> dict[str, Any]:
    records = payload.get("offers", []) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        return {"valid": False, "errors": ["Input must be a list or an object with offers[]"], "warnings": [], "groups": {}}
    errors: list[str] = []
    warnings: list[str] = []
    typed_records: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"offers[{index}]: object required")
            continue
        typed_records.append(record)
        record_errors, record_warnings = validate_record(record, index)
        errors.extend(record_errors)
        warnings.extend(record_warnings)
    return {"valid": not errors, "errors": errors, "warnings": warnings, "groups": dedupe_and_group(typed_records)}


def self_test() -> None:
    sample = {
        "offers": [
            {
                "provider_id": "shop-a",
                "offer_id": "1",
                "book_match": {"level": "exact_edition", "identifiers": {"isbn13": "9780000000000"}},
                "merchant": {"name": "Shop A"},
                "purchase": {"type": "buy", "condition": "new", "stock_status": "in_stock", "destination_country": "US"},
                "price": {"currency": "USD", "item": 10.0, "shipping": 2.0, "tax": 1.0, "landed_total": 13.0, "total_completeness": "landed_total"},
                "affiliate": {"is_affiliate": False},
                "source": {"url": "https://shop.example/1", "observed_at": "2026-08-17T10:00:00Z"},
            },
            {
                "provider_id": "shop-b",
                "offer_id": "2",
                "book_match": {"level": "same_work", "identifiers": {"isbn13": "9780000000001"}},
                "merchant": {"name": "Shop B"},
                "purchase": {"type": "buy", "condition": "new", "stock_status": "in_stock", "destination_country": "US"},
                "price": {"currency": "USD", "item": 8.0, "shipping": None, "tax": None, "landed_total": None, "total_completeness": "item_only"},
                "affiliate": {"is_affiliate": True, "disclosure": "May earn commission."},
                "source": {"url": "https://shop.example/2", "observed_at": "2026-08-17T10:00:00Z"},
            },
        ]
    }
    result = process(sample)
    assert result["valid"], result
    assert len(result["groups"]["exact_edition_comparable"]) == 1
    assert len(result["groups"]["alternative_or_unverified"]) == 1
    print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", help="Canonical offers JSON file; reads stdin when omitted")
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
