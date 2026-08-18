# Price Data Providers

## Source Types

| Source | Useful for | Access reality |
|---|---|---|
| Google Books API | Edition discovery plus country-specific `saleInfo`, list/retail price, and buy links when supplied | Public requests normally use an API key; coverage and sale fields vary by country and title |
| Publisher stores | Authoritative format/edition and direct offers | APIs are uncommon; deep links or partnerships may be required |
| Retailer/marketplace APIs | Regional live offers, stock, shipping, and seller condition | Usually credentialed, affiliate, locale-specific, and contract-limited |
| Affiliate networks | Multiple merchants and trackable buy links | Feeds/API access, commissions, update latency, and territory depend on the agreement |
| Public metadata sources | ISBN, publisher, language, and edition matching | Do not prove current price or stock |
| Search/deep links | Discovery and user verification | Never represent as normalized live prices without a permitted structured source |

Amazon's legacy Product Advertising API should not be assumed to be a permanent open source; Amazon documents its PA-API 5.0 deprecation and migration to Creators API. Re-check current program access, locale, attribution, caching, and display terms before implementation.

## Global Strategy

There is no complete, open, real-time global retail price database. Build adapters rather than a manually curated world-price table:

1. Resolve editions using open and partner bibliographic metadata.
2. Select providers by destination country and format.
3. Query official/partner APIs and feeds with permitted caching.
4. Normalize offers with provenance and short TTLs.
5. Fall back to clearly labeled merchant deep links.
6. Measure coverage by country, provider, format, and query success.

Store time-stamped offer observations, not a claim of permanent price truth. Suggested starting TTL is 5–30 minutes for live offers, subject to provider terms. Some affiliate programs restrict caching or require frequent refresh; their contract wins.

## Official References

- Google Books API volumes and `saleInfo`: https://developers.google.com/books/docs/v1/using
- Amazon PA-API 5.0 deprecation notice: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation
- Open Library data: https://openlibrary.org/data
- Wikidata data access: https://www.wikidata.org/wiki/Wikidata:Data_access

Open Library was not reachable from the current development network during the 2026-08-17 review. Re-check availability and current terms before depending on it.
