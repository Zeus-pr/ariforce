/**
 * Expense claims (#52), live API, ported from apps/web (lib/expenses, components/expenses):
 * one claim per user per month, lines per date, receipts via presigned PUT to R2, TA/DA auto-calc
 * (POST /v1/expense-claims/:id/allowances), submit, manager decision.
 *
 * DCR -> expense draft: the server does NOT create one on DCR submit today. Until it does
 * (CONTRACT.serverDraftsExpense), the app ensures it after a successful DCR submit and when the
 * Expense screen opens: create/get the month's claim, re-run TA/DA (auto lines are replaced on
 * every run, so it is idempotent), then drop auto lines of rejected DCRs (the live engine only
 * skips draft DCRs, not rejected ones).
 */
import type { Dcr, ExpenseCategory, ExpenseClaim, ExpenseStatus } from '@ariforce/contracts';
import {
  EXPENSE_FILE_TYPES,
  EXPENSE_MAX_FILE_BYTES,
  EXPENSE_MAX_FILES_PER_LINE,
  fileExt,
} from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';
import { reviewOf } from './dcr/adapter';
import type { PickedFile } from './file-pickers';

export const CONTRACT = {
  /** Server creates the day's expense draft (TA/DA) when a DCR is submitted. */
  serverDraftsExpense: false,
} as const;

export type Claim = ExpenseClaim;
export type Line = Claim['lines'][number];
export type ClaimSummary = Omit<Claim, 'lines'> & { lineCount: number };

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  travel: 'Travel',
  hotel: 'Hotel',
  food: 'Food',
  mileage: 'Mileage',
  allowance: 'Daily allowance',
  other: 'Other',
};
export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Sent back',
  paid: 'Paid',
};
export const STATUS_TONE = {
  draft: 'blue',
  submitted: 'orange',
  approved: 'green',
  rejected: 'red',
  paid: 'teal',
} as const satisfies Record<ExpenseStatus, string>;
export const isEditable = (s: ExpenseStatus) => s === 'draft' || s === 'rejected';
export const MAX_FILES = EXPENSE_MAX_FILES_PER_LINE;
export const MAX_MB = EXPENSE_MAX_FILE_BYTES / 1024 / 1024;
export const monthOf = (date: string) => date.slice(0, 7);
const MONTHS =
  'January February March April May June July August September October November December'.split(
    ' ',
  );
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

type ContentType = keyof typeof EXPENSE_FILE_TYPES;
/** The content type to declare: the picker's when allowed and matching, else from the extension. */
export function contentTypeFor(f: { name: string; type: string }): ContentType | null {
  const ext = fileExt(f.name);
  const types = Object.entries(EXPENSE_FILE_TYPES) as [ContentType, readonly string[]][];
  return (
    types.find(([t, exts]) => t === f.type && exts.includes(ext))?.[0] ??
    types.find(([, exts]) => exts.includes(ext))?.[0] ??
    null
  );
}
export function checkFile(f: PickedFile, existing: number): string | null {
  if (existing >= MAX_FILES) return `A line can have at most ${MAX_FILES} receipts.`;
  if (!contentTypeFor(f)) return `${f.name}: use JPG, PNG, HEIC, PDF, Excel or CSV.`;
  if (f.size > EXPENSE_MAX_FILE_BYTES) return `${f.name} is over ${MAX_MB} MB.`;
  return null;
}

const MESSAGES: Record<string, string> = {
  EXPENSE_NOT_EDITABLE: 'This claim can no longer be edited.',
  EXPENSE_EMPTY: 'Add at least one line before you submit.',
  RECEIPT_REQUIRED: 'Every hotel line needs a receipt before you submit.',
  TOO_MANY_FILES: `A line can have at most ${MAX_FILES} receipts.`,
  UPLOAD_MISSING: 'The upload did not arrive. Try the file again.',
  UPLOAD_SIZE_MISMATCH: 'The file changed during upload. Try again.',
  UPLOAD_TYPE_MISMATCH: 'The file type does not match its name. Try a different file.',
  UPLOAD_FORMAT_INVALID: 'That file does not look like a real receipt image, PDF or spreadsheet.',
  UPLOAD_NOT_CONFIRMED: 'This receipt is still uploading.',
  APPROVAL_NOT_YOUR_STEP: 'This claim is waiting for a different approver.',
  APPROVAL_ALREADY_DECIDED_BY_YOU: 'You already decided an earlier step of this claim.',
  VERSION_CONFLICT: 'Someone changed this line. Pull to refresh and try again.',
  REJECTION_REASON_REQUIRED: 'Give a reason to send it back.',
  PLACE_NOT_USABLE: 'One of the chosen places cannot be used. Pick another place.',
  DCR_NOT_APPROVED:
    'Can’t approve yet: the DCR for one of these days isn’t approved. Approve the DCR first, or send the claim back.',
};
export const expenseMessage = (e: unknown) =>
  e instanceof ApiError
    ? (e.code && MESSAGES[e.code]) || e.message || 'Something went wrong.'
    : (e as Error)?.message || 'Something went wrong.';

const key = ['expenses'] as const;

export function useMyClaims(myId: string | undefined) {
  return useQuery({
    queryKey: [...key, 'mine', myId],
    enabled: !!myId,
    queryFn: ({ signal }) =>
      apiFetch<{ items: ClaimSummary[] }>('/v1/expense-claims', {
        signal,
        query: { userId: myId },
      }).then((r) => [...r.items].sort((a, b) => b.month.localeCompare(a.month))),
  });
}

export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: [...key, 'one', id],
    enabled: !!id,
    queryFn: ({ signal }) => apiFetch<Claim>(`/v1/expense-claims/${id}`, { signal }),
  });
}

/** Team claims waiting for approval (web expenses-view, scope team). */
export function useClaimQueue(myId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'queue', myId],
    enabled: enabled && !!myId,
    queryFn: ({ signal }) =>
      apiFetch<{ items: ClaimSummary[] }>('/v1/expense-claims', {
        signal,
        query: { status: 'submitted' },
      }).then((r) => r.items.filter((c) => c.userId !== myId)),
  });
}

export const ensureClaim = (month: string) =>
  apiFetch<Claim>('/v1/expense-claims', { method: 'POST', body: { month } });

export type AllowanceDay = {
  date: string;
  dcrId: string;
  band: 'hq' | 'ex_hq' | 'outstation' | null;
  placeId: string | null;
  placeName: string | null;
  km: number | null;
  da: number;
  ta: number;
  issues: ('no_rate' | 'place_required' | 'manual_line_exists' | 'dcr_not_submitted')[];
};
export type AllowanceResult = {
  dryRun: boolean;
  days: AllowanceDay[];
  totals: { da: number; ta: number; km: number; lines: number };
  claim: Claim | null;
};
export const runAllowances = (
  claimId: string,
  dryRun: boolean,
  places: Record<string, string> = {},
) =>
  apiFetch<AllowanceResult>(`/v1/expense-claims/${claimId}/allowances`, {
    method: 'POST',
    body: { dryRun, places },
  });

export type AllowancePlace = {
  id: string;
  name: string;
  band: 'ex_hq' | 'outstation';
  km: number;
  active: boolean;
};
export function usePlaces(enabled: boolean) {
  return useQuery({
    queryKey: ['allowance-places'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      apiFetch<{ items: AllowancePlace[] }>('/v1/allowance-places', { signal }).then((r) =>
        r.items
          .filter((p) => p.active)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      ),
  });
}

/**
 * Make sure the month's claim carries the TA/DA draft for every submitted DCR day (idempotent).
 * Skips when the server does it, or when the claim is no longer editable. Never throws.
 */
export async function ensureExpenseDraft(date: string, rejectedDcrIds: string[] = []) {
  if (CONTRACT.serverDraftsExpense) return null;
  try {
    const claim = await ensureClaim(monthOf(date));
    if (!isEditable(claim.status)) return claim;
    const r = await runAllowances(claim.id, false);
    let c = r.claim ?? claim;
    // The live engine still drafts TA/DA for rejected DCRs: remove those unsubmitted auto lines.
    const bad = c.lines.filter(
      (l) => l.source === 'auto' && l.dcrId && rejectedDcrIds.includes(l.dcrId),
    );
    for (const l of bad)
      await apiFetch<void>(`/v1/expense-claims/${c.id}/lines/${l.id}`, { method: 'DELETE' });
    if (bad.length) c = await apiFetch<Claim>(`/v1/expense-claims/${c.id}`);
    return c;
  } catch {
    return null;
  }
}

/** Days whose DCR counts (submitted / locked-after-submit / approved), and rejected DCR ids. */
export function dcrDays(dcrs: Dcr[]) {
  const counted = new Map<string, Dcr>();
  const rejected: string[] = [];
  for (const d of dcrs) {
    const st = reviewOf(d).status;
    if (st === 'rejected') rejected.push(d.id);
    else if (st === 'submitted' || st === 'approved' || (st === 'locked' && d.submittedAt))
      counted.set(d.date, d);
  }
  return { counted, rejected };
}

export function useLineMutations(claimId: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: ({ line, body }: { line?: Line; body: LineInput }) =>
      line
        ? apiFetch<Line>(`/v1/expense-claims/${claimId}/lines/${line.id}`, {
            method: 'PUT',
            body: { line: body, version: line.version },
          })
        : apiFetch<Line>(`/v1/expense-claims/${claimId}/lines`, { method: 'POST', body }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (lineId: string) =>
      apiFetch<void>(`/v1/expense-claims/${claimId}/lines/${lineId}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  const submit = useMutation({
    mutationFn: () => apiFetch<Claim>(`/v1/expense-claims/${claimId}/submit`, { method: 'POST' }),
    onSuccess: done,
  });
  const decide = useMutation({
    mutationFn: ({ decision, comment }: { decision: 'approve' | 'reject'; comment?: string }) =>
      apiFetch<Claim>(`/v1/expense-claims/${claimId}/decision`, {
        method: 'POST',
        body: { decision, ...(comment ? { comment } : {}) },
      }),
    onSuccess: done,
  });
  return { save, remove, submit, decide, refresh: done };
}

export type LineInput = {
  date: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
  mileageKm: number | null;
  dcrId: string | null;
  tourPlanId: string | null;
};

/** Receipt upload (web lib/expenses/upload.ts): URL, PUT bytes to storage, confirm. */
export async function uploadReceipt(claimId: string, lineId: string, f: PickedFile) {
  const contentType = contentTypeFor(f);
  if (!contentType) throw new Error('Unsupported file type.');
  const blob = await (await fetch(f.uri)).blob();
  const size = f.size || blob.size;
  const r = await apiFetch<{
    attachment: { id: string };
    uploadUrl: string;
    headers: Record<string, string>;
  }>(`/v1/expense-claims/${claimId}/lines/${lineId}/attachments`, {
    method: 'POST',
    body: { fileName: f.name, contentType, sizeBytes: size },
  });
  const put = await fetch(r.uploadUrl, { method: 'PUT', headers: r.headers, body: blob }).catch(
    () => null,
  );
  if (!put?.ok) {
    // Leave no pending attachment behind.
    await apiFetch<void>(`/v1/expense-attachments/${r.attachment.id}`, { method: 'DELETE' }).catch(
      () => {},
    );
    throw new Error('Upload failed. Check your connection and try again.');
  }
  await apiFetch(`/v1/expense-attachments/${r.attachment.id}/confirm`, { method: 'POST' });
}

export const receiptUrl = (attachmentId: string) =>
  apiFetch<{ downloadUrl: string }>(`/v1/expense-attachments/${attachmentId}/download-url`, {
    method: 'POST',
  }).then((r) => r.downloadUrl);

export const deleteReceipt = (attachmentId: string) =>
  apiFetch<void>(`/v1/expense-attachments/${attachmentId}`, { method: 'DELETE' });
