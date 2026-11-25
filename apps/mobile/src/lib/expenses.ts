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
import { noteOptions, reviewOf } from './dcr/adapter';
import { todayIST } from './dcr/dates';
import { expenseCaps } from './expense-caps';
import type { PickedFile } from './file-pickers';

export const CONTRACT = {
  /** Server drafts the day's TA/DA on DCR submit (options.autoExpenseOnDcrSubmit, runtime). */
  get serverDraftsExpense() {
    return expenseCaps.serverDrafts === true;
  },
};

/** Read the company setting once if no options response has been seen yet. */
export async function serverDraftsExpense(): Promise<boolean> {
  if (expenseCaps.serverDrafts == null)
    await apiFetch('/v1/dcrs/options', { query: { date: todayIST() } })
      .then((o) => noteOptions(o))
      .catch(() => {});
  return expenseCaps.serverDrafts === true;
}

/** POST /v1/dcrs/:id/submit -> expenseDraft (e80d8f6); null when not drafted by the server. */
export type ExpenseAutoDraft = {
  status: 'drafted' | 'skipped' | 'error';
  reason: 'claim_locked' | 'manual_line_exists' | 'no_allowance' | null;
  date: string;
  dcrId: string;
  claimId: string | null;
  claimStatus: ExpenseStatus | null;
  claimCreated: boolean;
  lines: number;
  da: number;
  ta: number;
  km: number;
  issues: string[];
  error: { code: string; message: string } | null;
};

const SKIP_NOTE = {
  claim_locked: 'the month’s claim is already submitted',
  manual_line_exists: 'you already added an allowance line for that day',
  no_allowance: 'this work type has no TA/DA',
} as const;
/** A short note for a skipped/failed server draft, or null when drafted (or not attempted). */
export function autoDraftNote(d: ExpenseAutoDraft | null | undefined): string | null {
  if (!d || d.status === 'drafted') return null;
  if (d.status === 'error')
    return 'Expense not drafted: TA/DA could not be calculated. Add it on the Expense screen.';
  return `Expense not drafted: ${d.reason ? SKIP_NOTE[d.reason] : 'nothing to draft'}.`;
}

/** e80d8f6 fields (absent on older APIs: fall back to the client check). */
export type LineFlags = {
  autoTrigger?: 'allowances_run' | 'dcr_submit' | null;
  dcrRejectedAt?: string | null;
};
export type ClaimFlags = { dcrRejectedDates?: string[] };
export const lineDcrRejected = (l: Line, fallback: () => boolean) => {
  const v = (l as Line & LineFlags).dcrRejectedAt;
  return v !== undefined ? !!v : fallback();
};
export const claimDcrRejected = (c: object, fallback: () => boolean) => {
  const v = (c as ClaimFlags).dcrRejectedDates;
  return v !== undefined ? v.length > 0 : fallback();
};

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
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};
/** Draft grey, Submitted teal, Approved navy, Paid green, Rejected red (same as web). */
export const STATUS_TONE = {
  draft: 'slate',
  submitted: 'teal',
  approved: 'navy',
  rejected: 'red',
  paid: 'green',
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
/** The content type to declare: picker mime when allow-listed, else from the extension. */
export function contentTypeFor(f: { name: string; type: string }): ContentType | null {
  const ext = fileExt(f.name);
  const types = Object.entries(EXPENSE_FILE_TYPES) as [ContentType, readonly string[]][];
  return (
    types.find(([t, exts]) => t === f.type && exts.includes(ext))?.[0] ??
    // Prefer mime over a mismatched extension (iOS often keeps .HEIC after JPEG re-encode).
    types.find(([t]) => t === f.type)?.[0] ??
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
/** Lines the server linked from a DCR (contract #121): read-only on the claim. */
export const isDcrLine = (l: object) => (l as { origin?: string }).origin === 'dcr';
const DCR_LINE_MESSAGE =
  'This item came from your DCR. Change it on that day’s report, not on the claim.';

export const expenseMessage = (e: unknown) =>
  e instanceof ApiError
    ? (e.code === 'EXPENSE_NOT_EDITABLE' &&
        (e.details as { reason?: string } | undefined)?.reason === 'DCR_LINE' &&
        DCR_LINE_MESSAGE) ||
      (e.code && MESSAGES[e.code]) ||
      e.message ||
      'Something went wrong.'
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

/** Submitted claims whose current approval step is this person (`canDecide`). */
export function useClaimQueue(myId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'queue', myId],
    enabled: enabled && !!myId,
    queryFn: ({ signal }) =>
      apiFetch<{ items: ClaimSummary[] }>('/v1/expense-claims', {
        signal,
        query: { status: 'submitted' },
      }).then((r) => r.items.filter((c) => c.userId !== myId && c.canDecide)),
  });
}

/** Manager approve / reject from the approvals inbox (same route as claim detail). */
export function useDecideExpenseClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      comment?: string;
    }) =>
      apiFetch<Claim>(`/v1/expense-claims/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(comment ? { comment } : {}) },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
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

const SFC_TA_TAG = '[SFC TA]';
const SFC_DA_TAG = '[SFC DA]';

/** TA / DA / km from a submitted DCR’s frozen SFC snapshots (one day). */
export function taDaFromSfc(dcr: Dcr): { ta: number; da: number; km: number; routes: string[] } {
  const snaps = (dcr.sfcRoutes ?? []).map((r) => r.snapshot).filter(Boolean);
  if (!snaps.length) return { ta: 0, da: 0, km: 0, routes: [] };
  const ta = snaps.reduce((s, x) => s + (x!.bothWayAmount ?? x!.oneWayAmount ?? 0), 0);
  const das = snaps.map((x) => x!.da ?? 0).filter((n) => n > 0);
  const da = das.length ? Math.max(...das) : 0;
  const km = snaps.reduce((s, x) => s + (x!.bothWayKm || 0), 0);
  const routes = snaps.map((x) => `${x!.fromPlace} → ${x!.toPlace}`);
  return {
    ta: Math.round(ta * 100) / 100,
    da: Math.round(da * 100) / 100,
    km: Math.round(km * 10) / 10,
    routes,
  };
}

function dayHasTa(lines: Line[]) {
  return lines.some(
    (l) =>
      (l.source === 'auto' && (l.category === 'travel' || l.category === 'mileage')) ||
      (l.notes ?? '').includes(SFC_TA_TAG),
  );
}
function dayHasDa(lines: Line[]) {
  return lines.some(
    (l) =>
      (l.source === 'auto' && l.category === 'allowance') || (l.notes ?? '').includes(SFC_DA_TAG),
  );
}

/**
 * If allowance engine left a day empty, seed travel/DA lines from that day’s DCR SFC snapshot.
 * Idempotent via [SFC TA]/[SFC DA] note tags. Manual extras stay separate and add to the total.
 */
export async function seedTaDaFromDcrSfc(claim: Claim, dcrs: Dcr[]): Promise<Claim> {
  let c = claim;
  if (!isEditable(c.status)) return c;
  for (const dcr of dcrs) {
    if (dcr.status === 'draft') continue;
    const { ta, da, km } = taDaFromSfc(dcr);
    if (!(ta > 0) && !(da > 0)) continue;
    const dayLines = c.lines.filter((l) => l.date === dcr.date);
    if (ta > 0 && !dayHasTa(dayLines)) {
      c = await apiFetch<Claim>(`/v1/expense-claims/${c.id}/lines`, {
        method: 'POST',
        body: {
          date: dcr.date,
          category: km > 0 ? 'mileage' : 'travel',
          amount: ta,
          notes: `${SFC_TA_TAG}\nFrom DCR SFC`,
          mileageKm: km > 0 ? km : null,
          dcrId: dcr.id,
          tourPlanId: null,
        } satisfies LineInput,
      });
    }
    if (da > 0 && !dayHasDa(c.lines.filter((l) => l.date === dcr.date))) {
      c = await apiFetch<Claim>(`/v1/expense-claims/${c.id}/lines`, {
        method: 'POST',
        body: {
          date: dcr.date,
          category: 'allowance',
          amount: da,
          notes: `${SFC_DA_TAG}\nFrom DCR SFC`,
          mileageKm: null,
          dcrId: dcr.id,
          tourPlanId: null,
        } satisfies LineInput,
      });
    }
  }
  return c;
}

/**
 * Make sure the month's claim carries the TA/DA draft for every submitted DCR day (idempotent).
 * 1) Server allowances engine when available
 * 2) Fallback: seed from each DCR’s frozen SFC TA/DA
 * Skips when the claim is no longer editable. Never throws.
 */
export async function ensureExpenseDraft(
  date: string,
  rejectedDcrIds: string[] = [],
  dcrs: Dcr[] = [],
) {
  try {
    const claim = await ensureClaim(monthOf(date));
    if (!isEditable(claim.status)) return claim;
    let c = claim;
    if (!(await serverDraftsExpense())) {
      try {
        const r = await runAllowances(claim.id, false);
        c = r.claim ?? claim;
      } catch {
        // Fall through to SFC seeding.
      }
    }
    // Drop auto lines of rejected DCRs (engine may still draft them).
    const bad = c.lines.filter(
      (l) => l.source === 'auto' && l.dcrId && rejectedDcrIds.includes(l.dcrId),
    );
    for (const l of bad)
      await apiFetch<void>(`/v1/expense-claims/${c.id}/lines/${l.id}`, { method: 'DELETE' });
    if (bad.length) c = await apiFetch<Claim>(`/v1/expense-claims/${c.id}`);

    // Fill any remaining gaps from DCR SFC snapshots (full records preferred).
    const needFetch = dcrs.filter((d) => !(d.sfcRoutes ?? []).some((r) => r.snapshot));
    const full: Dcr[] = [...dcrs.filter((d) => !needFetch.includes(d))];
    for (const d of needFetch) {
      try {
        full.push(await apiFetch<Dcr>(`/v1/dcrs/${d.id}`));
      } catch {
        full.push(d);
      }
    }
    if (full.length) c = await seedTaDaFromDcrSfc(c, full);
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
  const pay = useMutation({
    mutationFn: (paymentRef: string) =>
      apiFetch<Claim>(`/v1/expense-claims/${claimId}/pay`, {
        method: 'POST',
        body: { paymentRef },
      }),
    onSuccess: done,
  });
  return { save, remove, submit, decide, pay, refresh: done };
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

/**
 * Manual boxes on the claim form (from field expense statements).
 * Stored as `other` lines; tag is a notes prefix so we can round-trip.
 * (Company brand / Linux name is never shown — use signed-in user only.)
 */
export const MANUAL_FIELDS = [
  { key: 'additional_tada', label: 'Additional TA/DA', tag: 'Additional TA/DA' },
  { key: 'courier', label: 'Courier', tag: 'Courier' },
  { key: 'mobile', label: 'Mobile', tag: 'Mobile' },
  { key: 'team_meeting', label: 'Team meeting expense', tag: 'Team meeting' },
] as const;
export type ManualFieldKey = (typeof MANUAL_FIELDS)[number]['key'];

const TAG_RE = /^\[([^\]]+)\](?:\n|$)/;

export function manualTag(key: ManualFieldKey): string {
  return MANUAL_FIELDS.find((f) => f.key === key)!.tag;
}

export function parseManualLine(l: Line): ManualFieldKey | 'remarks' | null {
  if (l.source === 'auto') return null;
  const m = TAG_RE.exec(l.notes ?? '');
  if (!m) return l.category === 'other' && l.notes ? 'remarks' : null;
  const tag = m[1]!;
  const hit = MANUAL_FIELDS.find((f) => f.tag === tag);
  return hit?.key ?? (tag === 'Remarks' ? 'remarks' : null);
}

export function stripManualTag(notes: string | null): string {
  if (!notes) return '';
  return notes.replace(TAG_RE, '').trim();
}

export function withManualTag(key: ManualFieldKey | 'remarks', body: string): string {
  const tag = key === 'remarks' ? 'Remarks' : manualTag(key);
  const rest = body.trim();
  return rest ? `[${tag}]\n${rest}` : `[${tag}]`;
}

/** Split a day's lines into auto/SFC TA/DA vs manual boxes (statement layout). */
export function dayExpenseSplit(lines: Line[]) {
  const isTa = (l: Line) =>
    (l.source === 'auto' && (l.category === 'travel' || l.category === 'mileage')) ||
    (l.notes ?? '').includes(SFC_TA_TAG);
  const isDa = (l: Line) =>
    (l.source === 'auto' && l.category === 'allowance') || (l.notes ?? '').includes(SFC_DA_TAG);
  const tada = lines.filter((l) => isTa(l) || isDa(l));
  const ta = tada.filter(isTa).reduce((s, l) => s + l.amount, 0);
  const da = tada.filter(isDa).reduce((s, l) => s + l.amount, 0);
  const km = tada.reduce((s, l) => s + (l.mileageKm ?? 0), 0);
  const manual: Partial<Record<ManualFieldKey | 'remarks', Line>> = {};
  for (const l of lines) {
    if (isTa(l) || isDa(l)) continue;
    const k = parseManualLine(l);
    if (k) manual[k] = l;
  }
  return { auto: tada, ta, da, km, manual };
}

/**
 * PUT raw bytes to the R2 presigned URL.
 * Use ArrayBuffer + XHR: RN Blob/fetch often send a different length than the signed
 * Content-Length (or chunked encoding), which R2 rejects with 403.
 */
function putToR2(
  url: string,
  headers: Record<string, string>,
  body: ArrayBuffer,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.onload = () => resolve({ ok: x.status >= 200 && x.status < 300, status: x.status });
    x.onerror = () => resolve({ ok: false, status: 0 });
    x.send(body);
  });
}

/** Receipt upload (web lib/expenses/upload.ts): URL, PUT bytes to R2, confirm. */
export async function uploadReceipt(claimId: string, lineId: string, f: PickedFile) {
  const contentType = contentTypeFor(f);
  if (!contentType) throw new Error('Unsupported file type.');

  // Actual on-disk bytes — picker `size` is often wrong after compression.
  let bytes: ArrayBuffer;
  try {
    const local = await fetch(f.uri);
    bytes = await local.arrayBuffer();
  } catch {
    throw new Error('Could not read the file. Try picking it again.');
  }
  const sizeBytes = bytes.byteLength;
  if (!sizeBytes) throw new Error('That file is empty.');
  if (sizeBytes > EXPENSE_MAX_FILE_BYTES) throw new Error(`${f.name} is over ${MAX_MB} MB.`);

  const r = await apiFetch<{
    attachment: { id: string };
    uploadUrl: string;
    headers: Record<string, string>;
  }>(`/v1/expense-claims/${claimId}/lines/${lineId}/attachments`, {
    method: 'POST',
    body: { fileName: f.name, contentType, sizeBytes },
  });

  const put = await putToR2(r.uploadUrl, r.headers, bytes);
  if (!put.ok) {
    await apiFetch<void>(`/v1/expense-attachments/${r.attachment.id}`, { method: 'DELETE' }).catch(
      () => {},
    );
    throw new Error(
      put.status
        ? `Upload to storage failed (${put.status}). Try again.`
        : 'Upload failed. Check your connection and try again.',
    );
  }
  await apiFetch(`/v1/expense-attachments/${r.attachment.id}/confirm`, { method: 'POST' });
}

export const receiptUrl = (attachmentId: string) =>
  apiFetch<{ downloadUrl: string }>(`/v1/expense-attachments/${attachmentId}/download-url`, {
    method: 'POST',
  }).then((r) => r.downloadUrl);

export const deleteReceipt = (attachmentId: string) =>
  apiFetch<void>(`/v1/expense-attachments/${attachmentId}`, { method: 'DELETE' });

/** Last selectable day of a claim month: today if the month is current, else its last day. */
export function lastDayOf(month: string, today: string) {
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  return today < end ? today : end;
}

export type ReconDay = { date: string; dcrStatus: string | null; claimed: number };
export type Recon = {
  byCategory: Partial<Record<ExpenseCategory, number>>;
  days: ReconDay[];
};
export function useRecon(claimId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'recon', claimId],
    enabled: enabled && !!claimId,
    queryFn: ({ signal }) =>
      apiFetch<Recon>(`/v1/expense-claims/${claimId}/reconciliation`, { signal }),
  });
}
