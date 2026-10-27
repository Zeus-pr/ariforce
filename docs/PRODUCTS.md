# Product prices admin

System Admin screen for product MRP / PTR / PTS. POB value stays **quantity × PTR**.

## What existed before

- `products` already had `mrp`, `ptr`, `pts` (`numeric(12,2)`, nullable). No price history.
- POB value is computed in `DcrService` (`pobValue`) from the product's PTR **when the DCR is saved**
  and stored in `dcr_call_products.value`. Reads (`GET /v1/dcrs/*`), the KPI views (`0009_kpi_views`)
  and `GET /v1/kpis` sum the stored value; nothing re-prices on read. No backfill was needed.
- Generic masters routes (`POST/PATCH /v1/products`, `POST /v1/products/import`) used `masters:write`
  (RBM and up, director, system_admin) for every field, prices included.

## Changes

| Item          | Detail                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permission    | New `products:prices`, **system_admin only** (`0033_role_permissions_prices.sql`, generated; drift test follows it)                                    |
| History       | New append-only `product_price_history` (`0032_product_price_history.sql`): old/new MRP/PTR/PTS, source, bulkId, changed_by, changed_at; RLS forced    |
| Masters guard | Without `products:prices`, a product create/update/import that sets or changes a price → 403 `PRICES_ADMIN_ONLY`; empty price cells keep stored prices |
| Audit         | `product.prices_updated` per changed product (before/after), `product.prices_bulk` per bulk call (summary)                                             |

## Endpoints (all `products:prices`)

| Method and path                             | Body / query                                               | Response                         |
| ------------------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| `GET /v1/admin/products`                    | `?q&missingPtr&active&brand&divisionId&limit(≤200)&cursor` | 200 `AdminProductList`           |
| `PATCH /v1/admin/products/{id}/prices`      | `{mrp?, ptr?, pts?, version?}` (null clears; at least one) | 200 `AdminProduct`               |
| `POST /v1/admin/products/prices/bulk`       | `{rows: [{productId \| code, mrp?, ptr?, pts?}]}` (1..300) | 200 `ProductPricesBulkResponse`  |
| `GET /v1/admin/products/{id}/price-history` | -                                                          | 200 `ProductPriceHistory` (≤200) |

`AdminProduct`: `id, code, name, brand, divisionId, active, mrp, ptr, pts, updatedAt, updatedBy{id,name}|null,
pricesUpdatedAt|null, version` (`updatedBy` = last price change from history).

Validation: each price 0..1,000,000, at most 2 decimals; PTR ≤ MRP on the merged row (422 `PTR_ABOVE_MRP`);
stale `version` → 409 `VERSION_CONFLICT`; unknown or other-company product → 404 `PRODUCT_NOT_FOUND`.

Bulk: each row in its own transaction; result per row `{index, productId, productCode, status:
updated|unchanged|failed, code, message}` plus `summary {total, updated, unchanged, failed}` and `bulkId`.
Row errors: `VALIDATION`, `PRODUCT_NOT_FOUND`, `PTR_ABOVE_MRP`. Codes match case-insensitively.

## Decisions for lead

1. New permission `products:prices` instead of reusing `users:write` (the only other system_admin-only
   permission is about users; roles are editable per company, so a prices-specific key is safer).
2. Generic masters writes may no longer set or change prices without `products:prices`; this closes the
   back door (RBM/director could edit PTR). Imports keep working for non-price columns.
3. PTR ≤ MRP is enforced; PTS is not compared (lead rule only names PTR/MRP).
4. A **draft DCR re-saved** after a PTR change is re-priced at the current PTR (POB lines are replaced on
   every save, as before #40). Submitted/locked DCRs never change. Say if re-saves should keep old values.
5. Bulk is synchronous (300 rows), not a background import job.

## Not done

- No price import from the customer file (blocked: see the xlsx note in the report).
- No web screen (apps/web is out of scope here); MSW mocks are in `packages/contracts/src/mocks/product-prices.ts`.
