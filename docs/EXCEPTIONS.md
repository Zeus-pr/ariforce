# Exceptions and the "Needs Attention" list (#56, #29)

## Source

- **#29** Manager "Needs Attention" dashboard: an exception list scoped by hierarchy.
- **#56** Exception and Alert Center, which extends #29:
  - severity ranking and a suggested corrective action;
  - each exception opens to show its context, owner, status and follow-up date;
  - acceptance: a manager can open, assign, resolve and follow up an exception.
- **#68** Proactive manager alerts. This is part of the AI-ideas block (#63-#68) and is **out of scope**. This doc includes no ranking model, prediction or "recommended next step" beyond the static action text per rule.

The issues do not name any rules. The rules below come from three places:

- the research use cases (docs/research, PR #16): "no punch-in, call average below norm, A-class doctors missed this cycle";
- the lead's brief;
- data that already exists in the schema.

## What an exception is

An exception is a stored row. It says that one rule fired for one user for one period:

- for day rules, the period is a company-local date;
- for month rules, it is the first day of the month.

Each row is unique on **(company, user, rule, period)**. That uniqueness is the dedupe key.

## Rules (thresholds are data)

Defaults live in code (`EXCEPTION_RULES` in contracts). A company overrides a rule with one `exception_rules` row per code. The override can set:

- `enabled`;
- `severity`;
- `threshold`;
- `action` (the suggested corrective action text).

If a company has no row for a rule, the defaults apply. This means new companies need no seed rows.

| Code                | Grain | Fires when                                                                                                                               | Default threshold | Severity |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| `dcr_missing`       | day   | Working day, the user is not on full-day leave, and the DCR lock has passed. There is no submitted or approved DCR and no punch-in.      | none              | high     |
| `punch_without_dcr` | day   | Same conditions as `dcr_missing`, but the user punched in that day.                                                                      | none              | high     |
| `dcr_late`          | day   | DCR was submitted after the on-time deadline (date + 1, IST), using the same definition as the `dcr_on_time_pct` KPI.                    | none              | low      |
| `low_call_average`  | day   | Submitted field-day DCR with doctor calls below the threshold.                                                                           | 8 calls           | medium   |
| `no_punch_in`       | day   | Working day, not on full-day leave, no leave/holiday DCR, and no punch-in.                                                               | none              | medium   |
| `geofence_breach`   | day   | Visit check-ins that day that were outside the fence or mock-located, and their number is at or above the threshold.                     | 1 visit           | medium   |
| `tp_not_submitted`  | month | It is on or after day N of month M, and the tour plan for M+1 is not submitted or approved. The period is the 1st of M+1.                | day 25            | high     |
| `coverage_gap`      | month | Month M is complete, and the share of listed doctors whose visit frequency was not met is above the threshold (`kpi_user_doctor_month`). | 20 %              | medium   |

How the inputs are defined:

- **Working day:** not a weekly off from `leave_settings.weekly_off_days` (default Sunday). The schema has no holiday calendar, so a holiday shows up only as a `holiday`-kind DCR.
- **Out of fence:** the visit's `distance_m` is greater than the doctor's `geofence_radius_m`, or the company's `default_geofence_m` otherwise (chemists and stockists always use the company default). Mock location means `is_mock`.

Who gets evaluated: active users who hold `field:write` (by default, BMs only) on dates on or after their `joined_on`.

Not built, so the lead should confirm:

- **Unusual expense:** the claim data exists, but nobody has defined "unusual". This needs a definition, for example "line amount > X × the user's 3-month median".
- **Late punch-in:** no shift start time exists.
- **"A-class missed":** `coverage_gap` covers every doctor category. A per-category variant can be added later with a `params` column.

## Computed vs stored

Exceptions are **stored**. A daily job evaluates them and writes rows.

Why stored:

- lists and counts are plain indexed reads;
- history stays stable after masters change;
- the lifecycle needs fields that a view cannot hold: explanation, assignee, follow-up date and resolution.

The cost: data is up to one day stale, and changing a threshold affects only later evaluations. Use backfill to re-run a range.

### Daily job and windows

- The runner enqueues the `exceptions.daily` system job once per UTC day. The 0031 allow-list includes it.
- Its handler calls `exceptions_enqueue_daily()`. This SECURITY DEFINER function is runner-only. It enqueues one `exceptions.evaluate` company job per company, with the dedupe key `<company>:<date>`.
- Each company job evaluates the window from **D-3 to D-1**, where D is today in the company timezone.
- Because the window overlaps, a late DCR or a later punch is picked up on the next run. Exceptions then **auto-resolve** or switch rule; see Lifecycle.
- Day rules that depend on the DCR lock skip any date whose lock has not passed yet. The lock is end of day plus `dcr_lock_after_hours`.

### Idempotency

Each evaluation is an upsert keyed on the dedupe key. Re-running a date has these effects:

- severity, value, threshold and context are refreshed on open or acknowledged rows;
- open or acknowledged rows whose condition no longer holds are auto-resolved;
- an auto-resolved row whose condition holds again is reopened;
- rows a manager has closed (resolved or dismissed) are never touched.

### Backfill

`POST /v1/exceptions/evaluate {from, to}` enqueues an evaluation for the caller's company:

- it needs `settings:write`;
- the range is at most 92 days and must end before today;
- it does not send digests.

## Lifecycle

```
open --(owner explains)--> acknowledged
open | acknowledged --(manager resolve + note)--> resolved
open | acknowledged --(manager dismiss + note)--> dismissed
open | acknowledged --(condition cleared on re-evaluation)--> resolved (autoResolved = true)
resolved (auto only) --(condition back)--> open
```

**Assign and follow up** (`PATCH /v1/exceptions/{id}`):

- a manager in scope sets `assigneeId` (anyone in the manager's scope, or the manager) and `followUpOn`;
- the default assignee when the row is created is the subject's direct manager.

**Notes:**

- Explain, resolve and dismiss need a note of 1-1000 characters.
- Notes are free text. The UI should tell users not to enter health or other personal details.

## Scope and permissions

No new permission was added, so no role-permission migration was needed.

| Action                             | Who                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List, summary, read one            | `field:read`. Covers your own exceptions plus your reporting-line subtree (`manager_id`, the same as the team profile). Director sees the whole company. System Admin, Distribution Head and Accountant lack `field:read`, so they get 403. |
| Explain                            | Only the subject, while the row is open or acknowledged                                                                                                                                                                                     |
| Resolve, dismiss, assign/follow-up | `approvals:decide` and the subject strictly below the caller in scope. A manager cannot close their own exceptions.                                                                                                                         |
| Read rules                         | `field:read`                                                                                                                                                                                                                                |
| Edit rules, backfill               | `settings:write` (Director, System Admin)                                                                                                                                                                                                   |

An out-of-scope or unknown id returns 404.

## Notifications (batched)

After each daily run, every **direct manager** of a user with **new** exceptions gets one in-app notification:

- type `exceptions.digest`;
- dedupe key `exceptions:<company-date>`;
- data: counts by severity and the evaluated window.

There is no notification per exception, and the subject is not notified. Backfill runs do not notify.

## Team profile (#75)

`TeamProfile.exceptions` is an additive field:

- `open`: open plus acknowledged;
- `openHigh`;
- `last30Days`: by period date;
- `byRule`: last 30 days, with `{ruleCode, count}`.

It is `null` when the viewer lacks `field:read`.

## Decisions for the lead to confirm

1. The rule list and defaults above, especially the 8 doctor calls per day and the 20 % coverage gap.
2. Rules are edited with `settings:write` (Director and System Admin). The alternative is RBM and above, which would need a new permission and a role-permissions migration.
3. Only `field:write` holders (BMs) are evaluated. Managers' own field days are not.
4. Digests go to the direct manager only, not up the chain.
5. Unusual expense, late punch-in and A-class-only coverage are not built (see above).
6. The suggested action is static text per rule and can be edited per company. Nothing from #68 is built.
