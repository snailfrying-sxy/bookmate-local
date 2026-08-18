---
name: compare-book-prices
description: Compare current purchase offers for a specific book edition across legal retailer, publisher, marketplace, or affiliate sources, including condition, region, currency, shipping, tax, freshness, and coverage limits. Use when users ask where to buy a book, which offer is cheapest, or how prices differ for a particular ISBN, format, or edition.
---

# Compare Book Prices

Compare like with like. Treat title match, edition match, item price, and delivered total as separate facts.

## Workflow

1. Resolve the requested edition.
   - Prefer ISBN-13, ISBN-10, or a provider edition ID.
   - Preserve language, translator, publisher, publication year, format, and binding.
   - Ask one concise question if edition ambiguity could change the result.
2. Confirm the purchase boundary.
   - Determine destination country/region, currency, physical or digital format, new or used condition, and whether alternative editions are acceptable.
   - Obey the host's network/search policy. Never enable web access implicitly.
3. Query legal, configured providers.
   - Prefer official retailer, publisher, affiliate, or marketplace APIs.
   - Use Google Books sale information for discovery where available.
   - Use deep links when structured live prices are unavailable.
   - Do not evade rate limits, authentication, robots rules, or provider terms.
4. Normalize every offer to [references/contracts.md](references/contracts.md).
5. Run `python scripts/validate_offers.py <results.json>` before ranking when file execution is available.
6. Separate exact-edition offers from alternative or unverified editions.
7. Group incomparable totals instead of forcing a false ranking.
8. Rank comparable offers by landed total, edition match, merchant reliability, and freshness.
9. Present coverage, timestamps, shipping/tax uncertainty, and affiliate disclosures.

## Comparison Rules

- Say “lowest among queried comparable offers,” never “global lowest price.”
- Compare totals only when edition, condition class, destination, currency, and included costs are compatible.
- Do not silently convert currencies. If conversion is requested, show the FX source, rate, and observation time separately from merchant prices.
- Treat unknown shipping or tax as an incomplete total. Do not rank it ahead of a known landed total solely because the visible item price is lower.
- Label used, rental, subscription, preorder, ebook, audiobook, and marketplace offers explicitly.
- Preserve merchant/provider wording and observation time because prices can change after the response.

## Output

Return:

1. The resolved edition and purchase boundary.
2. Providers queried, unavailable providers, credentials/region limits, and observation time.
3. Exact-edition comparable offers ranked by landed total.
4. Exact-edition offers with incomplete totals in a separate group.
5. Alternative or unverified editions in a separate group, only if allowed.
6. Merchant, condition, item price, shipping, known tax, total, stock state, timestamp, and source/buy link.
7. A concise coverage statement and affiliate disclosure.

## Safety And Transactions

- Never place an order, start a subscription, or submit payment without explicit confirmation.
- Do not expose account, address, payment, or order-history data.
- Make affiliate relationships visible and keep commission out of price ranking.
- Do not present a deep link as a verified live price.
- Do not scrape providers that prohibit automated access.

## Provider Selection

Read [references/providers.md](references/providers.md) when choosing sources or explaining why a complete global price comparison is not available.
