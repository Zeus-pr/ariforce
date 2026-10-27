/** Expense claims (#52): labels, rules and role checks shared by the expense pages. */
import {
  DEFAULT_ROLE_PERMISSIONS,
  EXPENSE_FILE_TYPES,
  EXPENSE_MAX_FILE_BYTES,
  EXPENSE_MAX_FILES_PER_LINE,
  fileExt,
  type ExpenseCategory,
  type ExpenseContentType,
  type ExpenseStatus,
  type Permission,
} from '@ariforce/contracts';
import type { Role } from '@/lib/roles';
import { canPayExpenses } from '@/lib/permissions';

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
export const STATUS_TONE: Record<ExpenseStatus, string> = {
  draft: 'bg-muted text-foreground',
  submitted: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-red-100 text-red-900',
  paid: 'bg-sky-100 text-sky-900',
};

export const can = (role: Role, p: Permission) => (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes(p);
/** Who gets the Expenses page at all. */
export const seesExpenses = (role: Role) =>
  can(role, 'expenses:read') || can(role, 'finance:read') || canPayExpenses(role);
export const isEditable = (s: ExpenseStatus) => s === 'draft' || s === 'rejected';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
export const money = (n: number) => inr.format(n);
export const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
export const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
export const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Accept list for the file input (types and extensions, so Safari offers HEIC and spreadsheets). */
export const ACCEPT = [
  ...Object.keys(EXPENSE_FILE_TYPES),
  ...Object.values(EXPENSE_FILE_TYPES).flat().map((e) => `.${e}`),
].join(',');
export const MAX_FILES = EXPENSE_MAX_FILES_PER_LINE;
export const MAX_MB = EXPENSE_MAX_FILE_BYTES / 1024 / 1024;

/** The content type to declare: the browser's when it is allowed and matches, else from the extension
 * (Safari often gives HEIC and CSV files an empty or generic type). */
export function contentTypeFor(file: { name: string; type: string }): ExpenseContentType | null {
  const ext = fileExt(file.name);
  const types = Object.entries(EXPENSE_FILE_TYPES) as [ExpenseContentType, readonly string[]][];
  const own = types.find(([t, exts]) => t === file.type && exts.includes(ext));
  if (own) return own[0];
  return types.find(([, exts]) => exts.includes(ext))?.[0] ?? null;
}

/** Client-side checks before asking for an upload URL; the server checks again. */
export function checkFile(file: { name: string; type: string; size: number }, existing: number): string | null {
  if (existing >= MAX_FILES) return `A line can have at most ${MAX_FILES} receipts.`;
  if (!contentTypeFor(file)) return `${file.name}: use JPG, PNG, HEIC, PDF, Excel or CSV.`;
  if (file.size > EXPENSE_MAX_FILE_BYTES) return `${file.name} is over ${MAX_MB} MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
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
  VERSION_CONFLICT: 'Someone changed this line. Reload and try again.',
};
export const messageFor = (e: { code?: string; message?: string }) =>
  (e.code && MESSAGES[e.code]) || e.message || 'Something went wrong.';

/** The signed-in user's id as the expense API knows it. Real mode: the profile from GET /v1/me.
 * Mock mode: the mock persona for the role (the expense mocks act as that persona, see lib/api.ts). */
export async function selfId(role: Role, user: { id: string } | null): Promise<string | null> {
  const { MOCKING } = await import('@/lib/api');
  if (!MOCKING) return user?.id ?? null;
  const m = await import('@ariforce/contracts/mocks');
  return m.fixtures.findMockUser(role)?.id ?? null;
}

/** Run an effect's request and swallow only the abort from its own cleanup (unmount, filter change). */
export function quietAbort(signal: AbortSignal, p: Promise<unknown>) {
  p.catch((e: unknown) => {
    if (!signal.aborted) throw e;
  });
}
