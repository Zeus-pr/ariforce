# Team member profile (#75)

Click a person in the team tree (`GET /v1/team`) to see their HQ, doctors/chemists, weekly or monthly performance, and export it. Read-only; no new tables, permissions or migrations.

## Endpoints

All under `/v1/team/members/{userId}`, tag `Team`, contracts in `packages/contracts/src/schemas/team-profile.ts`, mocks in `packages/contracts/src/mocks/team.ts` (`teamProfileHandlers`).

| Method | Path                                                | Response                                                                                                                                                                                                               |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/profile`                                          | `TeamProfile`: `member` (TeamNode without `depth`), `manager`, `hq`, `counts` {doctors, chemists, directReports, subtreeSize}, `today` {date, status, punchInAt, punchOutAt, leave}, `lastPunchInAt`, `canSeeExpenses` |
| GET    | `/performance?granularity=week\|month&from&to`      | `TeamPerformance`: {userId, granularity, from, to, generatedAt, buckets[], total}                                                                                                                                      |
| GET    | `/doctors?limit&cursor&q&territoryId&includeTotal`  | `TeamMemberDoctorPage`                                                                                                                                                                                                 |
| GET    | `/chemists?limit&cursor&q&territoryId&includeTotal` | `TeamMemberChemistPage`                                                                                                                                                                                                |
| GET    | `/export?format=xlsx\|pdf&granularity&from&to`      | file (xlsx: sheets Profile + Performance; pdf: A4 landscape), `cache-control: no-store`, audited as `team_profile.exported`                                                                                            |

Errors: 401 unauthenticated; 403 `FORBIDDEN` (see access); 404 `NOT_FOUND` (outside your subtree, unknown/invalid id, not a hierarchy user, pending/rejected signups); 422 `VALIDATION` (bad query, `from` > `to`, bad cursor) and `RANGE_TOO_LONG` (more than 26 weeks or 24 months; `details.max`, `details.requested`).

## Access (decided by Prajesh, 2026-10-27)

1. Anyone with a hierarchy role (BM included) may view their **own** profile and performance.
2. Viewing someone else needs ABM or above (`hierarchyRank >= MIN_MANAGER_RANK`) **and** `reports:read`, and the person must be strictly below the viewer in their own reporting subtree (`principal.teamUserIds`). Director (company-wide) sees every hierarchy user. Peers, people above, other branches: 404.
3. `system_admin`, `distribution_head`, `accountant` (no hierarchy role): 403, including for themselves. System Admin gets no field data by default (existing audited-grant rule).
4. BM viewing anyone else: 403.

The route guard only needs `me:read`; the rule above is enforced in `TeamProfileService.target()`. No new permission, no migration.

## Data rules

- **HQ** = the person's deepest assigned territory (most path segments).
- **Doctors** = approved doctors whose territory is under any of the person's territories (`kpi_user_doctor_list`). **Chemists** = same path rule. **Sales** in month KPIs = `kpi_sales_month` under the person's territory paths. Attribution by territory path is accepted.
- **Performance buckets**: months (`YYYY-MM`, default last 6) or ISO weeks Mon–Sun (`YYYY-Www`, default last 8). `from`/`to` are snapped to bucket boundaries. Metrics use `KpisService.userMetrics()` (same maths as `GET /v1/kpis?rollup=self`). Week buckets carry `WEEK_KPI_KEYS` only (call averages, visits/day, DCR compliance/on-time, POB); coverage, frequency, TP adherence and sales are month-grain and only in month buckets. Accepted.
- **Attendance** per bucket, over working days (Mon–Sat) up to today: present = a punch-in that day; leave = approved leave (`kpi_user_leave_day`, half = 0.5) or a DCR with a leave work type; holiday = DCR holiday work type; absent = the rest (a half-day leave without a punch-in counts 0.5 absent).
- **Expenses** {claimed, approved} INR from lines dated in the bucket on submitted/approved/paid claims; `null` unless own profile, or the viewer has `expenses:approve` or `finance:read`.
- **Exceptions** (#56) {open, openHigh, last30Days, byRule[{ruleCode, count}]} from stored exceptions (see `docs/EXCEPTIONS.md`); `null` unless the viewer has `field:read`.
- **PII**: no payroll/HR data. Phone/email only as `GET /v1/team` already shows the same viewer. Doctor/chemist rows carry no phone, address or DOB. Exports carry no phone/email.
- **Exceptions**: out of scope for this issue (rule-based exception centre is #56/#29).

## Gaps vs existing APIs (why new endpoints)

`GET /v1/team` gives the tree only; `GET /v1/kpis` gives one period per request (no time series); the masters API lists outlets by territory, not by person; there was no per-person export.
