# KPI definitions

Source: competitor research in `docs/research/feature-catalog.md` (PR #16, "Dashboards/MIS": call
average, coverage, frequency compliance, missed doctors, hierarchy-scoped rollups). SQL lives in
`packages/db/drizzle/0009_kpi_views.sql`; the API is `GET /v1/kpis` (see `packages/contracts`).

## Conventions

- **Period**: a calendar month (`month=YYYY-MM`) or a date range (`from`/`to`, inclusive, IST).
  Month is the default grain; ranges are summed from day rows.
- **Time zone**: all dates are Asia/Kolkata (IST). A DCR is "on time" if submitted by end of D+1 IST.
- **Field day**: a DCR whose work type has `counts_as_field_day = true`. Leave, holiday and non-field
  days (meeting, transit, admin) are excluded from call denominators.
- **MSL (master/must-see list)**: approved, non-deleted doctors in the subtree of the territories
  assigned to the user (`kpi_user_doctor_list`). Required visits per month =
  `doctor.visits_per_cycle_override` ?? `doctor_category.visits_per_cycle` ?? 1.
- **Filters** (every KPI): `userId`, `territoryId` (includes descendants), `divisionId`/`productId`
  where product-based, `workTypeKind` for day-based KPIs. Deleted rows (`deleted_at`) are ignored.
- **Scope**: the caller only sees their reporting-line subtree (`users.manager_id`); Director sees the
  whole company; System Admin sees KPIs only if granted `reports:read`.

## Per-role rollup

Views are computed at **user** (rep) or **territory** grain. Rollups for the 8 roles —
1 Business Manager (BM), 2 Area BM, 3 Regional BM, 4 Zonal BM, 5 Sales Manager, 6 General Manager,
7 Vice President, 8 Director — are produced by the API by **summing numerators and denominators**
over the manager's team (self + reporting-line subtree) and then dividing. Never average percentages.

| Rollup        | Who           | Rows included                                                                               |
| ------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `self`        | any role      | the caller's own rows                                                                       |
| `team`        | ABM and above | all users under the caller (recursive `manager_id`), excluding self unless they report DCRs |
| `byUser`      | ABM and above | one row per direct/indirect report                                                          |
| `byTerritory` | any           | territory (HQ/area/region/zone) rows; sales KPIs are territory-grain natively               |
| `company`     | Director only | all users/territories                                                                       |

A manager's own field work (joint work, own calls) is counted under their own user row and is not
double-counted in the team row; joint-work calls count for the rep who owns the DCR.

## KPIs

| #   | KPI                                      | Formula         | Numerator                                                       | Denominator                                | Period      | View                                | Edge cases                                                                                      |
| --- | ---------------------------------------- | --------------- | --------------------------------------------------------------- | ------------------------------------------ | ----------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Call average (doctor)                    | N / D           | doctor calls on field days                                      | field days                                 | month/range | `kpi_user_month.call_average`       | 0 field days → null, not 0; chemist calls reported separately                                   |
| 2   | Chemist call average                     | N / D           | chemist calls on field days                                     | field days                                 | month       | `kpi_user_month`                    | as above                                                                                        |
| 3   | Coverage / reach %                       | 100·N / D       | MSL doctors visited ≥ 1 time                                    | MSL size                                   | month       | `coverage_pct`                      | doctor moved territory mid-month counts in the list at query time; MSL 0 → null                 |
| 4   | Frequency compliance %                   | 100·N / D       | MSL doctors with visits ≥ required visits                       | MSL size                                   | month       | `frequency_compliance_pct`          | required = 0 counts as met; extra visits don't compensate other doctors                         |
| 5   | Missed-doctor (missed-call) rate %       | 100·N / D       | MSL doctors with 0 visits                                       | MSL size                                   | month       | `missed_doctor_pct`                 | = 100 − coverage; list in "Needs attention"                                                     |
| 6   | Unique doctors seen                      | count distinct  | distinct MSL doctors visited                                    | —                                          | month       | `unique_doctors_seen`               | off-list doctors are counted in calls but not here                                              |
| 7   | Doctor visits per day                    | N / D           | doctor calls                                                    | field days                                 | day/month   | `kpi_user_day.doctor_calls`         | same as call average at day grain                                                               |
| 8   | DCR compliance %                         | 100·N / D       | days with DCR submitted/approved                                | expected working days                      | month       | `dcr_submitted_days` + API calendar | expected = calendar days to date − Sundays − company holidays − approved leave; computed in API |
| 9   | DCR on-time %                            | 100·N / D       | DCRs submitted by D+1 IST                                       | submitted DCRs                             | month       | `dcr_on_time_days`                  | resubmission after rejection keeps first `submitted_at`                                         |
| 10  | TP adherence %                           | 100·N / D       | planned TP visits with a matching call (same outlet, same date) | planned TP visits in the approved TP       | month       | `kpi_tp_adherence_month`            | no approved TP → null and flagged; deviations need `deviation_reason`                           |
| 11  | Product-wise detailing                   | count           | calls with product detailed (and first-position count)          | — (share = N / doctor calls)               | month       | `kpi_product_month`                 | product filter by division via `products.division_id`                                           |
| 12  | Samples given                            | sum             | sample quantity by product                                      | —                                          | month       | `kpi_product_month.sample_qty`      |                                                                                                 |
| 13  | POB vs target                            | 100·N / D       | POB value booked in calls                                       | POB target (from targets, when configured) | month       | `pob_value`                         | no target → achievement null                                                                    |
| 14  | MSL size / MSL vs target                 | N vs D          | MSL size                                                        | configured MSL target per territory        | month       | `msl_size`                          | target optional (company setting)                                                               |
| 15  | Primary sales vs target, achievement %   | 100·N / D       | primary sales value (returns subtracted)                        | primary target (all-products row)          | month       | `kpi_sales_month` kind=primary      | territory grain; rollup by territory path; target 0/null → null                                 |
| 16  | Secondary sales vs target, achievement % | as 15           | secondary sales value                                           | secondary target                           | month       | kind=secondary                      | from stockist statements via import                                                             |
| 17  | Growth vs last year %                    | 100·(N − D) / D | this month's actual                                             | same month last year actual                | month       | `growth_pct`                        | LY 0/absent → null                                                                              |

### Notes

- Sales data comes from Excel/CSV import (`sales_actuals`, `sales_targets`, see `docs/IMPORT.md`);
  ERP/Tally integration is out of scope.
- GPS is captured only at punch-in, visit and punch-out; KPIs never require continuous tracking.
  A "verified call" share (visit with a geo capture within the geofence) can be added later.
- All percentages are rounded to 1 decimal in SQL; the API returns numerator and denominator as well
  so the UI can recompute rollups exactly.

## API implementation (`apps/api/src/kpis`)

- `GET /v1/kpis` and `GET /v1/kpis/products` need `reports:read`. Default period is the current IST month; `from`/`to` limits day-grain KPIs (calls, DCR compliance/on-time, POB) exactly, month-grain KPIs (MSL, coverage, frequency, TP adherence, sales, product report) use every month overlapping the range.
- Rollups: `self` (or `userId` in your team, else 403), `team` (you + reporting line, one summed row), `byUser`, `byTerritory` (children of `territoryId`, or your own territories), `company` (company-wide scope only, else 403). Rows sum numerators/denominators, never average percentages.
- `workingDays` on each row = (non-Sunday calendar days from `from` to min(`to`, today)) × users − non-Sunday off days, where off days are days filed as a leave/holiday DCR or covered by approved leave (`kpi_user_leave_day`, #51; a half day counts 0.5; the larger value wins when both apply). It is the denominator of `dcr_compliance_pct`. There is no company holiday calendar yet; holidays count only when filed as a holiday DCR.
- `pob_value` sums server-computed POB values (quantity × PTR, #40); POB on products without a PTR counts as 0 value. `pob_achievement_pct` is null until POB targets exist. `growth_vs_ly_pct` uses primary sales.
