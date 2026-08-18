# Library Holding Contract

Use this canonical shape after mapping provider-specific responses.

```json
{
  "provider_id": "local-koha",
  "library": {
    "id": "lib-1",
    "name": "Example City Library",
    "url": "https://library.example"
  },
  "branch": {
    "id": "branch-1",
    "name": "Central Branch",
    "address": "Approximate or display-safe address",
    "country_code": "US",
    "latitude": 40.0,
    "longitude": -73.0
  },
  "distance_km": 2.4,
  "book_match": {
    "level": "exact_edition",
    "identifiers": {"isbn13": "9780000000000"},
    "title": "Example Book",
    "format": "paperback",
    "language": "en"
  },
  "availability": {
    "status": "available",
    "evidence_level": "realtime_circulation",
    "copies_total": 3,
    "copies_available": 1
  },
  "actions": [
    {"type": "catalog", "url": "https://library.example/record/1"},
    {"type": "reserve", "url": "https://library.example/hold/1", "requires_confirmation": true}
  ],
  "source": {
    "url": "https://library.example/api/record/1",
    "observed_at": "2026-08-17T10:00:00Z",
    "expires_at": "2026-08-17T10:10:00Z"
  }
}
```

## Enumerations

`book_match.level`:

- `exact_edition`: Strong identifier or provider edition match.
- `same_work`: Different edition, translation, or format of the requested work.
- `unverified`: Title/author candidate that needs user or provider confirmation.

`availability.status`:

- `available`
- `checked_out`
- `reservable`
- `in_library_use_only`
- `ebook_available`
- `not_available`
- `unknown`

`availability.evidence_level`:

- `nearby_only`
- `catalog_holding`
- `realtime_circulation`

`actions.type`:

- `catalog`
- `reserve`
- `borrow`
- `directions`
- `contact`

## Validation Rules

- Require `provider_id`, library/branch names, match level, status, evidence level, and source observation time.
- Require at least one identifier for `exact_edition`.
- Require `realtime_circulation` for claims of `available`, `checked_out`, `reservable`, or `ebook_available`.
- Use `unknown` status for `nearby_only`.
- Keep timestamps in ISO 8601 with timezone.
- Preserve provider wording in an optional `raw_status`; do not discard ambiguous states.
- Treat `distance_km` as optional and never infer it from a place name alone.

