# Book Offer Contract

Map each provider response into this canonical shape.

```json
{
  "provider_id": "retailer-example",
  "offer_id": "offer-123",
  "book_match": {
    "level": "exact_edition",
    "identifiers": {"isbn13": "9780000000000"},
    "title": "Example Book",
    "language": "en",
    "publisher": "Example Press",
    "format": "paperback"
  },
  "merchant": {
    "name": "Example Books",
    "marketplace_seller": null,
    "country_code": "US"
  },
  "purchase": {
    "type": "buy",
    "condition": "new",
    "stock_status": "in_stock",
    "destination_country": "US"
  },
  "price": {
    "currency": "USD",
    "item": 12.50,
    "shipping": 2.99,
    "tax": null,
    "tax_included": false,
    "landed_total": null,
    "total_completeness": "shipping_known_tax_unknown"
  },
  "affiliate": {
    "is_affiliate": true,
    "disclosure": "BookMate may receive a commission."
  },
  "source": {
    "url": "https://merchant.example/offer/123",
    "observed_at": "2026-08-17T10:00:00Z",
    "expires_at": "2026-08-17T10:15:00Z"
  }
}
```

## Enumerations

`book_match.level`: `exact_edition`, `same_work`, `unverified`.

`purchase.type`: `buy`, `preorder`, `rental`, `subscription`.

`purchase.condition`: `new`, `used_like_new`, `used_good`, `used_acceptable`, `digital`, `unknown`.

`purchase.stock_status`: `in_stock`, `limited`, `preorder`, `out_of_stock`, `unknown`.

`price.total_completeness`:

- `landed_total`: item, mandatory shipping, and known tax form a destination-specific total.
- `tax_included`: item and mandatory shipping are known and tax is included.
- `shipping_known_tax_unknown`: shipping is known but tax is not.
- `item_only`: shipping and/or tax are unknown.
- `not_comparable`: subscription, rental, bundle, or another pricing model that needs its own group.

## Validation Rules

- Require provider, offer, merchant, edition match, purchase type/condition, currency, item price, source URL, and timezone-aware observation time.
- Require an edition identifier for `exact_edition`.
- Use ISO 4217 three-letter currency codes and non-negative numeric amounts.
- Require `landed_total` for completeness `landed_total` or `tax_included`.
- Require `landed_total >= item` and reconcile known item, shipping, and tax within normal rounding tolerance.
- Keep alternative editions separate from exact-edition ranking.
- Mark a total comparable only inside the same destination, currency, purchase type, condition group, and edition match.
- Preserve optional `raw_price` and `raw_availability` when provider meanings are ambiguous.
