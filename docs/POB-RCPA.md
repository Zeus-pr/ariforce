# POB and RCPA at chemist calls (#40)

- **POB** (personal order booking): what a chemist orders during a call.
- **RCPA** (retail chemist prescription audit): what the chemist is selling for one of our molecules,
  our brand and the competitor brands, as units (and optionally prescription counts).

Issue #40 is one line ("POB and RCPA capture at chemist calls", source docs/research, PR #16). The
research lists "POB at chemist/stockist" and "RCPA (competitor brands, Rx counts, photo)". Everything
else below is a decision; the ones the lead should confirm are in **Decisions**.

## Where it lives

Both are lines of a DCR call, saved with the DCR (`PUT /v1/dcrs`, same as detailed products and
samples). That keeps one write path, one idempotency key (`clientId` per call), one edit/lock rule
and offline-friendly replace-all semantics. Reads come back in `GET /v1/dcrs` and `GET /v1/dcrs/{id}`.

| Line | Storage                                                        | Allowed on             |
| ---- | -------------------------------------------------------------- | ---------------------- |
| POB  | `dcr_call_products` (`kind = 'pob'`, existing since 0008/0013) | chemist, stockist call |
| RCPA | `dcr_call_rcpa` (new, migration `0029_dcr_call_rcpa`)          | chemist call           |

### `dcr_call_rcpa`

| Column               | Type         | Notes                                                                    |
| -------------------- | ------------ | ------------------------------------------------------------------------ |
| `id`                 | uuid PK      | uuidv7                                                                   |
| `company_id`         | uuid FK      | RLS `tenant_isolation`                                                   |
| `call_id`            | uuid FK      | `dcr_calls.id`                                                           |
| `product_id`         | uuid FK      | **our** product that anchors the molecule (required, must be active)     |
| `competitor_brand`   | text ≤ 100   | null = the row counts our own brand; trimmed, inner spaces collapsed     |
| `competitor_company` | text ≤ 100   | optional, only with `competitor_brand`                                   |
| `quantity`           | int > 0      | units sold / seen (strips or packs, as the company counts them)          |
| `prescriptions`      | int ≥ 0      | optional Rx count                                                        |
| `doctor_id`          | uuid FK null | optional prescribing doctor, must be in the rep's scope                  |
| sync cols            |              | `created_at`, `updated_at`, `deleted_at`, `version` (lines are replaced) |

Constraints: CHECKs on quantity / prescriptions / lengths / company-only-with-brand; a partial unique
index on `(call_id, product_id, lower(coalesce(competitor_brand, '')))` for live rows (no duplicate
brand per molecule per call); FK indexes on `call_id`, `product_id`, `doctor_id`; a
`(company_id, lower(competitor_brand))` index for the brand lookup.

No new PII: chemist and doctor are references to masters the DCR already uses; no patient data, no
prescription images.

## Rules (server-side, 422 `VALIDATION` with `details`)

- `pob` on `doctor`, `chemist` and `stockist` calls (no outlet restriction).
- `rcpa` only on `chemist` calls → `details.rcpaOutletCallIds`.
- Products (POB and RCPA) must exist, not be deleted and be **active** → `details.inactiveProductIds`
  (unknown ids stay in `details.productIds`).
- Quantity > 0 (contract: int ≥ 1, ≤ 100000); prescriptions int 0..100000.
- Duplicates in one call: the same `productId` twice in `pob` → `details.duplicatePob`; the same
  (`productId`, normalised `competitorBrand`) twice in `rcpa` → `details.duplicateRcpa`.
- `stockistId` on a POB line must be a stockist in scope → `details.stockistIds`.
- `doctorId` on an RCPA line must be a doctor in scope → `details.rcpaDoctorIds`.
- `competitorCompany` without `competitorBrand` → contract 422.
- **POB value** is computed by the server: `quantity × products.ptr` when the product has a PTR,
  otherwise `null` (quantity only). A client `value` is accepted for compatibility and ignored.
- **Edit window**: exactly the DCR's — future dates 422, after `lockAt` 409 `DAY_LOCKED` unless a
  correction is approved, stale `version` 409. Only the owner writes (the PUT is always your own DCR).
- Reads follow the DCR: own + reporting-line subtree (`field:read`), 404 outside it, RLS by company.

## Competitor brand lookup

`GET /v1/rcpa/competitor-brands?q=&limit=` (`field:read`) returns
`{ items: [{ brand, company, uses }] }`: distinct brands already entered in the caller's company
(case-insensitive, most used first), so reps pick an existing spelling instead of creating
"Dolo 650" / "DOLO-650" variants. No competitor master table (see Decisions).

## Not built (no ask in #40)

- Manager summary endpoints (POB/RCPA by period, territory, product) and new KPIs (strike rate,
  RCPA share). The existing `pob_value` KPI keeps working (now from server-computed values).
- RCPA photo upload and OCR (OCR would be an AI feature: out of scope by product decision).
- Stockist order status / ERP or Tally sync (out of scope by product decision).

## Decisions (defaults chosen; lead to confirm)

1. **Embed in `PUT /v1/dcrs`** rather than separate add/replace endpoints per call. Same lock,
   version and idempotency rules for free; separate endpoints would duplicate them.
2. **POB on doctor, chemist and stockist calls** (Prajesh, 2026-10-27, via lead). An earlier draft
   rejected doctor-call POB with 422 `pobOutletCallIds`; that rule is removed, so doctor-call POB is
   accepted as it was before #40. RCPA stays chemist-only.
3. **POB value from PTR only** (stored at save; PTR is edited by the System Admin only, see PRODUCTS.md). Re-saving a DCR keeps a line's stored value while call, product and quantity are unchanged; an edited quantity or a new line is priced at the current PTR; client value ignored; no PTR → `value: null`. Behaviour change: before,
   the client's value was stored as-is (and fed `pob_value`).
4. **RCPA row = our product (molecule anchor) + optional competitor brand**; units required,
   Rx count optional. One row per brand per molecule per call.
5. **No competitor master**; free text normalised (trim, collapse spaces, case-insensitive dedupe) plus
   the lookup endpoint. A master (with molecule mapping) can come later without breaking the API.
6. **Optional doctor reference** on RCPA rows, scope-checked.
7. **No new permission**: writes are `field:write` (own DCR), reads `field:read`.
8. **No summaries / KPIs** until asked.
