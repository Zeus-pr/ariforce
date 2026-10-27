# Field-added doctor approval and duplicate detection (#26)

Status: built on `feat/26-doctor-approval`. The decisions marked **D#** need lead confirmation.
Regulatory detail (NMC/state council registration checks) is out of scope here; verify with counsel
before adding any registry lookup.

## What already existed

- `doctors.approval_status` (`approval_state` enum), set on insert: company-wide principals
  (Director, System Admin) → `approved`, everyone else → `pending`.
- Generic approval engine (#17) with `entity_type = 'doctor'` and `subjectType = 'doctor'` in the
  Approval DTO, but nothing opened a request or applied a decision for doctors.
- Import duplicate rules (docs/IMPORT.md "Duplicate rules (#26)"): `registration_no`
  (case-insensitive), then name without "Dr." + pincode. Imports are Director/System Admin only.

## What this adds

| Piece                              | Shape                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Doctor.approvalStatus`            | read-only `pending \| approved \| rejected` (other enum values are never written for doctors)                                                                 |
| `DoctorListQuery`                  | optional `approvalStatus` filter                                                                                                                              |
| `DoctorCreate`                     | optional `allowPossibleDuplicate: boolean` (default false)                                                                                                    |
| `POST /v1/doctors`                 | duplicate check first; pending doctors open an approval request (`subjectType: 'doctor'`, summary `New doctor <name>`) to the creator's reporting manager     |
| `POST /v1/doctors/duplicate-check` | body `{ name, pincode?, registrationNo? }` → `{ matches: DoctorDuplicate[] }`; permission = doctor read                                                       |
| `PATCH /v1/doctors/{id}`           | a rejected doctor edited by a non-company-wide user goes back to `pending` with a new request                                                                 |
| Decision hook                      | approve → `approved`; reject → `rejected` (row kept, audit `doctor.approved` / `doctor.rejected`; no notification yet)                                        |
| DCR                                | rejected doctors are refused in new/edited DCR calls (`422 VALIDATION`, `details.doctorIds`); pending doctors are allowed                                     |
| Migration `0035`                   | lookup indexes only: `doctors_regno_idx (company_id, upper(registration_no))`, `doctors_pincode_idx (company_id, pincode)`; no data change, no new permission |

`DoctorDuplicate = { id, name, territoryId, territoryName, rule: 'registration_no' | 'name_pincode', approvalStatus }`.
No phone, address or other contact data is returned.

### Errors on create

- `409 DOCTOR_DUPLICATE`: same registration number (strong). Cannot be overridden.
- `409 DOCTOR_POSSIBLE_DUPLICATE`: same name (without "Dr.") + pincode (weak). Re-post with
  `allowPossibleDuplicate: true` to create anyway; the matches are stored in the approval request
  payload so the approver sees them.
- Both carry `details.matches: DoctorDuplicate[]`.

## Who can add doctors (conflict with a prior decision)

`POST /v1/doctors` still needs `masters:write`, which BM and ABM do not have ("ABM and BM are read-only
on masters", docs/RBAC.md). So today "field-added" means RBM…VP (scoped roles with `masters:write`):
their doctors are `pending` and go to their reporting manager. BM/ABM may call the duplicate check
(read permission) but get `403` on create. Letting BM/ABM propose doctors needs a new permission
(e.g. `doctors:propose`, create-only, always pending) and a new role-permissions migration; it is
**not built** here because it reverses that decision (question Q1 below).

## Decisions for lead

- **D1** Duplicates are checked company-wide (all territories, all approval states except deleted),
  not just in the caller's hierarchy, so the response may name a doctor in another territory (id,
  name, territory name only).
- **D2** Registration number match blocks hard; name+pincode match is a warning the user may override.
  Company-wide roles go through the same check.
- **D3** Pending doctors can be visited and reported in DCR (field reality); only rejected ones are
  refused. Coverage/KPIs are unchanged (team "doctors" views already show approved only).
- **D4** Reject keeps the row as `rejected` (not soft-deleted) so history and re-submission work. The
  creator re-submits by editing it.
- **D5** One approval level (reporting manager; any manager above with `approvals:decide` may decide),
  same as tour plans. No company setting for levels yet.
- **D6** Edits to an approved doctor by a field user do not need re-approval.
- **D7** Duplicate check runs on create only, not when an edit changes name/pincode/registration.

## Questions for Prajesh

- **Q1** Should BM/ABM be able to add doctors as `pending` proposals (new `doctors:propose`)?
- **Q2** Should the approver be notified in-app (new notification types `doctor.submitted` /
  `doctor.approved` / `doctor.rejected`)? Not built; the request shows in `/v1/approvals?mine=to_decide`.

## Assumptions / out of scope

- No registry (NMC) verification; `verification_status` stays as-is.
- No merge tool for duplicates already in the DB.
- Web UI is out of this branch (API, contracts, mocks only).
