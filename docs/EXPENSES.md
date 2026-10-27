# Expense claims (#52): API summary for Dev

One claim per user per month. A claim has lines (date, category, amount, notes, optional DCR or tour plan link); lines carry receipts stored in R2. Types come from `@ariforce/contracts` (`schemas/expenses.ts`); MSW mocks are in `src/mocks/expenses.ts` (one approval step, uploads accepted without bytes).

## States

```
draft --submit--> submitted --approve (last step)--> approved --pay--> paid
                      |  \--approve (earlier step)--> submitted (next approver)
                      \--reject--> rejected --edit + submit--> submitted
```

- Only the owner edits, and only in `draft` or `rejected` (else 409 `EXPENSE_NOT_EDITABLE`).
- Submit needs at least one line (422 `EXPENSE_EMPTY`), and every `hotel` line needs a confirmed receipt (422 `RECEIPT_REQUIRED`).
- Approval uses the generic approvals engine (entity `expense`). Step 1 goes to the claimant's manager, then to that manager's manager, up to `EXPENSE_APPROVAL_LEVELS` steps (default 2). A step must be decided by its approver or someone above them (403 `APPROVAL_NOT_YOUR_STEP`); the same person cannot decide two steps (403 `APPROVAL_ALREADY_DECIDED_BY_YOU`); nobody decides their own claim (403). Reject needs a comment.
- Pay (`expenses:pay`: **Director and System Admin**, company-wide; Prajesh 2026-10-27) only from `approved`, with a `paymentRef`. Nobody pays their own claim (403). Every other role, approvers included (ABM…VP), gets 403. Claims paid earlier by an accountant keep `paidBy`/`paidAt`/`paymentRef` unchanged and still read normally.

## Who sees what

- Own claims: `expenses:read` (BM and above).
- Team claims, not drafts: `expenses:approve` (ABM and above), within their reporting line.
- Company-wide `approved`/`paid` claims, receipts, reconciliation and expense reports: `expenses:pay` (Director, System Admin). The Director also sees every non-draft claim through `expenses:approve` (company-wide reporting line).
- A claim you cannot see is 404.

## Endpoints (all `/v1`, bearer auth)

| Method & path                                          | Permission                        | Body / query                                                 | 2xx                                          | Errors                                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /expense-claims`                                  | `me:read` + scope above           | `?month&userId&status`                                       | 200 `ExpenseClaimList`                       | 422                                                                                                                                                           |
| `POST /expense-claims`                                 | `expenses:write`                  | `ExpenseClaimCreate {month}`                                 | 201 new draft / 200 existing `ExpenseClaim`  | 403, 422 future month                                                                                                                                         |
| `GET /expense-claims/{id}`                             | `me:read`                         |                                                              | 200 `ExpenseClaim`                           | 404                                                                                                                                                           |
| `POST /expense-claims/{id}/lines`                      | `expenses:write`                  | `ExpenseLineInput`                                           | 201 `ExpenseClaim`                           | 403 not owner, 404, 409 `EXPENSE_NOT_EDITABLE`, 422 (date outside month or future, mileage rule, foreign/other-date DCR, foreign tour plan)                   |
| `PUT /expense-claims/{id}/lines/{lineId}`              | `expenses:write`                  | `ExpenseLineUpdate {line, version}`                          | 200 `ExpenseClaim`                           | 409 `VERSION_CONFLICT` (body has current line), plus the above                                                                                                |
| `DELETE /expense-claims/{id}/lines/{lineId}`           | `expenses:write`                  |                                                              | 200 `ExpenseClaim`                           | 404, 409                                                                                                                                                      |
| `POST /expense-claims/{id}/lines/{lineId}/attachments` | `expenses:write`                  | `ExpenseAttachmentCreate {fileName, contentType, sizeBytes}` | 201 `ExpenseAttachmentUpload`                | 409, 422 `VALIDATION` (type/extension/size), 422 `TOO_MANY_FILES` (max 5 per line), 503 storage off                                                           |
| `POST /expense-attachments/{id}/confirm`               | `expenses:write`                  |                                                              | 200 `ExpenseAttachment`                      | 409 `UPLOAD_MISSING`, 409 `EXPENSE_NOT_EDITABLE`, 422 `UPLOAD_SIZE_MISMATCH` / `UPLOAD_TYPE_MISMATCH` / `UPLOAD_FORMAT_INVALID` (the attachment is discarded) |
| `DELETE /expense-attachments/{id}`                     | `expenses:write`                  |                                                              | 204                                          | 404, 409                                                                                                                                                      |
| `POST /expense-attachments/{id}/download-url`          | `me:read` + claim visible         |                                                              | 200 `ExpenseDownload`                        | 404, 409 `UPLOAD_NOT_CONFIRMED`                                                                                                                               |
| `POST /expense-claims/{id}/submit`                     | `expenses:write`                  |                                                              | 200 `ExpenseClaim`                           | 409, 422 `EXPENSE_EMPTY` / `RECEIPT_REQUIRED`                                                                                                                 |
| `POST /expense-claims/{id}/decision`                   | `expenses:approve`                | `ExpenseDecision {decision, comment?}`                       | 200 `ExpenseClaim`                           | 403 (own claim, not your step, already decided by you), 404, 409 not submitted, 422 reject without comment                                                    |
| `POST /expense-claims/{id}/pay`                        | `expenses:pay`                    | `ExpensePay {paymentRef}`                                    | 200 `ExpenseClaim`                           | 404, 409 not approved                                                                                                                                         |
| `GET /expense-claims/{id}/reconciliation`              | `me:read` + claim visible         |                                                              | 200 `ExpenseReconciliation`                  | 404                                                                                                                                                           |
| `GET /expense-reports`                                 | `expenses:read` or `expenses:pay` | `ExpenseReportQuery {month, userId?, teamOf?, status?}`      | 200 `ExpenseReport`                          | 403, 422                                                                                                                                                      |
| `GET /expense-reports/export`                          | same                              | same + `format=xlsx\|pdf`                                    | 200 file (`Content-Disposition: attachment`) | 403, 422                                                                                                                                                      |

Errors use the standard envelope `{ error: { code, message, details? } }` (see API-CONVENTIONS.md).

**TA/DA auto-calculation (#39):** `POST /expense-claims/{id}/allowances` (owner, draft/rejected claim, `expenses:write`) drafts DA/TA lines (`source: 'auto'`, category `allowance`, `mileage` or `travel`) from submitted DCR days, the rate card and the fare chart; re-running replaces only auto lines, and editing a line or attaching a receipt makes it `manual`. Rate card and fare chart endpoints, rules and decisions: docs/TADA.md.

## Receipt upload flow

1. `POST /expense-claims/{id}/lines/{lineId}/attachments` with `{ fileName, contentType, sizeBytes }`.
   - Allowed: JPG/JPEG, PNG, HEIC/HEIF, PDF, XLSX, XLS, CSV; the extension must match `contentType`; max 10 MB; max 5 files per line.
   - Returns `{ attachment (status pending), uploadUrl, method: 'PUT', headers, expiresAt }`. The URL is valid for 10 minutes.
2. `PUT` the raw bytes to `uploadUrl` with exactly `headers` (content type is signed). No auth header; it goes straight to R2.
3. `POST /expense-attachments/{id}/confirm`. The server checks the object exists, its size and content type match the declaration, and the first bytes match the format (magic bytes: JPEG, PNG, HEIC/HEIF `ftyp`, `%PDF`, ZIP for XLSX, OLE for XLS, text for CSV). On failure the attachment is discarded and the object deleted; start again from step 1.
4. To view: `POST /expense-attachments/{id}/download-url` gives a 5-minute URL. Downloads are audited.

Object keys are `{companyId}/expense_receipt/{yyyy}/{mm}/{uuid}.{ext}`; the original file name is never stored. There is **no antivirus scan** yet, only the format checks above. The generic `POST /v1/files` refuses purpose `expense_receipt` (422) so receipts always go through this flow.

## Reconciliation

Per claimed day: the amount and line count, the DCR for that day, and flags:
`no_dcr`, `dcr_not_submitted` (DCR still draft), `non_field_day` (DCR work type is not field work), `dcr_link_mismatch` (a line links a different DCR), `outside_month`. `unmatchedAmount` sums flagged days. Only DCRs are compared (no attendance yet).

## Reports and export

`GET /expense-reports` returns one row per claim for the month (totals by category, DCR match counts) within the caller's scope; `teamOf` narrows to a manager and everyone below. `export` returns the same data as XLSX (sheets Claims and Lines) or PDF. Exports are audited (`expense.exported`).

## Audit actions

`expense.created`, `expense.line_added`, `expense.line_updated`, `expense.line_deleted`, `expense.submitted`, `expense.resubmitted`, `expense.step_approved`, `expense.approved`, `expense.rejected`, `expense.paid`, `expense.attachment_requested`, `expense.attachment_confirmed`, `expense.attachment_rejected`, `expense.attachment_deleted`, `expense.attachment_downloaded`, `expense.exported`.

## Migrations

1. `packages/db/migrations/0021_expense_claims.sql`: tables `expense_claims`, `expense_lines`, `expense_attachments` with RLS `tenant_isolation`, row-meta triggers and app grants.
2. `packages/db/migrations/0022_role_permissions_expenses.sql`: sets every role's permissions from `DEFAULT_ROLE_PERMISSIONS` (adds `expenses:*`, `finance:write`; since 0040 mark-paid is `expenses:pay` on director and system_admin, and no endpoint checks `finance:*`). Generated by `pnpm -F @ariforce/db db:role-perms`; the drift test fails if it is stale.
