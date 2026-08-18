---
name: find-library-books
description: Find nearby physical or digital libraries for a specific book or edition, distinguish a nearby branch from a catalog holding and real-time availability, and return verifiable catalog, reserve, or borrow actions. Use when users ask where to borrow, whether a library has a book, whether it is currently available, or which nearby branch to visit.
---

# Find Library Books

Find borrowable copies without overstating coverage or availability. Treat location, catalog holdings, and circulation status as three different facts.

## Workflow

1. Resolve the requested work and edition.
   - Prefer ISBN-13, OCLC, LCCN, or a provider edition ID.
   - Preserve language, translator, format, and publication year.
   - Ask one concise question if choosing the wrong edition would materially change results.
2. Confirm the search boundary.
   - Obtain a city/postcode or explicit location permission, radius, physical/digital preference, and acceptable alternative editions.
   - Obey the host's network/search policy. Never enable network access implicitly.
3. Query providers from strongest to weakest evidence.
   - Use configured local ILS or library-network APIs first.
   - Use licensed union catalogs or digital-lending APIs when credentials exist.
   - Use public SRU/Z39.50/OPAC catalogs or deep links as fallbacks.
   - Use OpenStreetMap only to locate branches, never to infer holdings.
4. Normalize every result to the contract in [references/contracts.md](references/contracts.md).
5. Run `python scripts/validate_holdings.py <results.json>` before ranking when file execution is available.
6. Rank by evidence level, edition match, actionable availability, distance, and freshness.
7. Present coverage and uncertainty before recommendations.

## Evidence Rules

Use exactly these levels:

- `nearby_only`: A library branch exists nearby; no claim about this title.
- `catalog_holding`: The catalog records this work/edition; current availability is unknown unless separately supplied.
- `realtime_circulation`: The provider reports an observed status such as available, checked out, or reservable.

Never translate `nearby_only` or `catalog_holding` into “可借”. Only `realtime_circulation` may support a current availability claim, and it must include `observed_at`.

## Output

Return:

1. The resolved edition and whether alternatives were allowed.
2. Search area, providers queried, credentials/coverage limitations, and observation time.
3. Results grouped as `current availability`, `catalog holdings`, then `nearby branches only`.
4. Branch, distance, match level, status, last checked time, source link, and available actions.
5. A clear fallback such as “open catalog and confirm” when real-time data is unavailable.

Do not say “no library has this book” unless an authoritative source defines complete coverage. Say “none found in the queried providers” and list them.

## Safety And Permissions

- Minimize location precision; do not retain a full address unless explicitly requested.
- Treat reserve, hold, checkout, login, and fee actions as writes requiring confirmation.
- Do not expose patron identifiers or circulation history.
- Do not scrape catalogs that prohibit automated access; prefer APIs, standards, and deep links.
- Keep affiliate or sponsored relationships out of library ranking.

## Provider Selection

Read [references/providers.md](references/providers.md) when choosing data sources or explaining global coverage. It distinguishes open location/metadata data from licensed holdings and real-time circulation.

