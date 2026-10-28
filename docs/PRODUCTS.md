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

| Item           | Detail                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission     | New `products:prices`, **system_admin only** (`0033_role_permissions_prices.sql`, generated; drift test follows it)                                                                                                                                               |
| History        | New append-only `product_price_history` (`0032_product_price_history.sql`): old/new MRP/PTR/PTS, source, bulkId, changed_by, changed_at; RLS forced                                                                                                               |
| Generic routes | Unchanged (lead, 2026-10-27): `masters:write` holders (RBM and up, director, system_admin) still set prices via `POST/PATCH /v1/products` and import, same contract; price changes there also write history (source `masters`) and `product.prices_updated` audit |
| Audit          | `product.prices_updated` per changed product (before/after), `product.prices_bulk` per bulk call (summary)                                                                                                                                                        |

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

## Product image (migration 0047)

Upload box on the prices admin; the DCR picker reads the same `imageUrl` from `GET /v1/products`.

1. `POST /v1/files/upload-url` `{purpose: 'product_image', contentType: image/jpeg|png|webp, sizeBytes <= 5 MB, fileName?}`
   -> `{fileKey, uploadUrl, method: 'PUT', headers, expiresAt}` (10 min).
2. `PUT uploadUrl` with the raw bytes and exactly `headers` (content-type, content-length are signed).
3. `PUT /v1/products/{id}/image` `{fileKey, version?}` -> 200 `AdminProduct` with `imageUrl` and the new `version`.
4. `DELETE /v1/products/{id}/image` -> 200 `AdminProduct` (`imageUrl: null`).

All need `products:prices`. `products.image_file_key` holds the R2 key only. `imageUrl` is a presigned GET valid
30-60 min; re-fetch the list for a fresh one.

## Decisions for lead

1. New permission `products:prices` instead of reusing `users:write` (the only other system_admin-only
   permission is about users; roles are editable per company, so a prices-specific key is safer).
2. The generic product routes keep their previous behaviour exactly (Prajesh, 2026-10-27): whoever
   could edit prices there still can, and import semantics are unchanged (an empty price cell sets the
   price to null, as before). The admin page is an additional, system_admin-only way in. Price changes
   on the generic routes are still recorded in history (source `masters`) and audit; no contract change.
3. PTR ≤ MRP is enforced on the admin endpoints (not added to the generic routes); PTS is not compared (lead rule only names PTR/MRP).
4. Saved POB values stay as saved (lead rule, 2026-10-27). On `PUT /v1/dcrs` a POB line for the same
   call (clientId) and product with the **same quantity** keeps its stored value, so idempotent re-sends
   never change values. **Edited quantity = new line pricing** (current PTR). New lines use the current
   PTR. A stored `null` (no PTR when saved) is priced at the current PTR on the next save.
5. Bulk is synchronous (300 rows), not a background import job.

## Not done

- No price import from the customer file (blocked: see the xlsx note in the report).
- No web screen (apps/web is out of scope here); MSW mocks are in `packages/contracts/src/mocks/product-prices.ts`.
