# Approvals: request details and rejection reasons

Generic engine: `approval_requests` + `approval_steps` (see [DATA-MODEL.md](DATA-MODEL.md)).
Subjects: `tour_plan`, `leave`, `expense`, `doctor`, `dcr_unlock` (DCR correction). Sign-up
requests are decided on their own routes but follow the same rejection-reason rule.

## GET /v1/approvals/{id}

Response `ApprovalDetail` = `Approval` + `subject` (nullable).

Who can read the request (else `404`):

- the requester;
- an assigned approver: any step's `approver_user_id` or `decided_by` (current or past step);
- the reporting line above the requester (same visibility as `GET /v1/approvals`).

Who gets `subject` (else `subject: null`): the requester, an assigned approver, or an in-line
viewer with read access to the subject (`tour_plan`, `dcr_unlock`: everyone in line; `leave`:
`leave:approve`; `expense`: `expenses:approve` or `finance:read`; `doctor`: `masters:read`).
`GET /v1/tour-plans`, `/v1/leave/*` and `/v1/expense-claims` access is unchanged. RLS stays
tenant-only; no SECURITY DEFINER function and no migration were needed.

`subject` is discriminated by `type`:

| `type`       | Fields                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tour_plan`  | `plan` (`TourPlan`), `days[] { date, entries[] { session, workType {id,name}, territories[{id,name}], jointWorkUsers[{id,name}], doctors[{id,name,specialtyName,categoryName}], chemists[{id,name}], notes } }`                                                                                                                                                                                 |
| `leave`      | `request` (`LeaveRequest`: typeCode, typeName, fromDate, toDate, half, days, reason, status, ...), `balance { item: LeaveBalanceItem, availableBefore, availableAfter } \| null`, `overlaps[] { userId, userName, typeCode, fromDate, toDate, status }` (peers with the same manager, pending/approved, overlapping dates)                                                                      |
| `expense`    | `claim` (`ExpenseClaim` with `lines[]`: date, category, amount, notes, mileageKm, source, allowancePlaceId, attachments), `allowancePlaces[] { id, name, band, oneWayKm }`, `receipts[] { attachmentId, lineId, contentType, downloadUrl, expiresAt }` (confirmed receipts only; presigned GET, 5 min, `StorageService.downloadUrl`; each URL issue is audited `expense.attachment_downloaded`) |
| `doctor`     | `doctor { id, name, specialtyName, categoryName, territory {id,name}, city, pincode, registrationNo, approvalStatus }`, `possibleDuplicates[{id,name}]`                                                                                                                                                                                                                                         |
| `dcr_unlock` | `date`, `reason`                                                                                                                                                                                                                                                                                                                                                                                |

## Rejection reasons (all subjects)

- Every reject needs a reason. Missing, empty or whitespace-only gives
  `422 REJECTION_REASON_REQUIRED`. The reason is trimmed; max 1000 characters (sign-up: 500).
  Routes: `POST /v1/approvals/{id}/decision`, `POST /v1/leave/requests/{id}/decision`,
  `POST /v1/expense-claims/{id}/decision` (field `comment`), `POST /v1/signup-requests/{id}/reject`
  (field `reason`).
- Stored on `approval_steps.comment` (engine) and the subject's `decision_comment`
  (tour plan, leave, expense) or `signup_requests.reason`. No new columns.
- Read by the submitter:
  - `TourPlan`, `LeaveRequest`, `ExpenseClaim` (and `ExpenseClaimSummary`): `rejectionReason`,
    `rejectedBy`, `rejectedAt` (null unless rejected). `decisionComment` stays as before.
  - `Approval.rejectionReason` on `GET /v1/approvals` and `GET /v1/approvals/{id}` (all subjects;
    the only place for doctors and DCR corrections).
- Notifications to the submitter include `Reason: <text>` in the body and `data.reason`:
  `leave.rejected`, `expense.rejected`, and new `tour_plan.rejected`, `doctor.rejected`,
  `dcr_unlock.rejected` (see [NOTIFICATIONS.md](NOTIFICATIONS.md)).
- Re-submit: a rejected expense claim keeps the reason while it is edited and clears it on
  submit (status changes). A rejected tour plan keeps `rejectionReason`/`rejectedBy`/`rejectedAt`
  while edited (status `draft`) and clears them on submit. Leave is final (apply again). The old
  approval request keeps its reason.
- Visibility: only users who can already read the record or the approval request (owner, the
  reporting line above, finance for submitted+ claims). Unrelated users get `404`.
- Sign-up applicants have no account to read the reason; it is stored on the request and
  visible to reviewers (`SignupRequest.reason`).

## Reading the subject by id (assigned approvers)

- `GET /v1/tour-plans/{id}`, `GET /v1/leave/requests/{id}`, `GET /v1/expense-claims/{id}` (plus
  `POST /v1/expense-attachments/{id}/download-url`, short-lived link) and `GET /v1/doctors/{id}` work
  for an assigned approver. Tour plans and doctors check `approval_steps` (current or past step);
  general read access is not widened.
- `rejectedBy` is `{ id, name }` everywhere. Doctors take `rejectionReason`/`rejectedBy`/`rejectedAt`
  from their latest approval request.
- `GET /v1/doctors?ids=` batch-fetches up to 100 doctors within the caller's scope.
- Tour plan and doctor final approvals notify the requester (`tour_plan.approved`,
  `doctor.approved`); rejections notify with the reason.
- Tour plan submit takes an optional `submitterNote` (migration
  `packages/db/migrations/0036_tour_plan_submitter_note.sql`).
