# Library Data Providers

## Open Or Public Inputs

| Source | Useful for | Does not prove | Notes |
|---|---|---|---|
| OpenStreetMap / Overpass | Nearby library branches and coordinates | Holdings or availability | OSM data is ODbL; attribute OpenStreetMap contributors |
| Open Library | Work/edition candidates and identifiers | A local physical copy | Open API/dumps; coverage and uptime vary |
| Library of Congress APIs | Authority and bibliographic records | Nearby holdings | Public machine-readable catalog/digital collection data |
| Wikidata | Cross-language work/author/entity links | Holdings or price | CC0, but statements can be incomplete |
| SRU/CQL catalogs | Search a participating catalog | Universal or real-time coverage | Public access and record schemas vary by library |
| Public OPAC deep links | Let the user verify in a catalog | Structured real-time status | Prefer when no supported API exists |

## Credentialed Or Partner Inputs

| Source | Useful for | Access reality |
|---|---|---|
| OCLC WorldCat Search API | Bibliographic records and library holdings | Official page states qualifying OCLC subscriptions are normally required; commercial partnerships exist |
| OverDrive APIs | Digital metadata, library availability, holds, and checkout flows | Request API credentials and partner access |
| Koha REST API | A specific Koha library's biblios, items, checkout availability, and circulation | Each library controls deployment, public routes, auth, and policy |
| FOLIO / other ILS APIs | A specific institution's inventory, locations, requests, and circulation | Institution-specific credentials and schemas |
| Vendor discovery layers | Institution or consortium holdings | Contract-specific; never assume global access |

## Global Strategy

There is no fully open, globally complete, real-time physical-library availability dataset. Build adapters in this order:

1. User-configured home library or local consortium.
2. Country/region union catalog.
3. Licensed global catalog when available.
4. Public SRU/OPAC deep link.
5. Nearby branch discovery with an explicit “holdings unknown” label.

Cache bibliographic holdings longer than circulation status. Suggested starting TTLs: 24 hours for catalog holdings and 1–10 minutes for real-time availability, subject to provider terms.

## Official References

- OpenStreetMap copyright: https://www.openstreetmap.org/copyright
- Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API
- WorldCat Search API: https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html
- OverDrive Developer Portal: https://developer.overdrive.com/
- Koha REST API: https://api.koha-community.org/
- FOLIO documentation: https://docs.folio.org/docs/platform-essentials/
- SRU/CQL: https://www.loc.gov/standards/sru/
- Library of Congress APIs: https://www.loc.gov/apis/

