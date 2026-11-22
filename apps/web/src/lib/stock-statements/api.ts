import { API_URL, apiReady, toApiError, type ApiError } from '@/lib/api';

export type StatementStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export type StatementLine = {
  productId: string;
  name: string;
  packSize: string | null;
  pts: number | null;
  openingQty: number | null;
  openingLocked: boolean;
  purchaseQty: number;
  freeQty: number;
  secondaryQty: number;
  frsQty: number;
  openingValue: number | null;
  purchaseValue: number | null;
  freeValue: number | null;
  secondaryValue: number | null;
  frsValue: number | null;
  closingQty: number | null;
  closingValue: number | null;
};

export type Statement = {
  id: string;
  stockistId: string;
  stockistName: string;
  address: string | null;
  month: string;
  status: StatementStatus;
  version: number;
  editable: boolean;
  canSubmit: boolean;
  canDecide: boolean;
  approvalRequestId: string | null;
  rejectionReason: string | null;
  currentApproverName: string | null;
  locked?: boolean;
  editOpen?: boolean;
  unlockPending?: boolean;
  canRequestUnlock?: boolean;
  totals: {
    openingQty: number;
    openingValue: number;
    purchaseQty: number;
    purchaseValue: number;
    freeQty: number;
    freeValue: number;
    secondaryQty: number;
    secondaryValue: number;
    closingQty: number;
    closingValue: number;
    frsQty: number;
    frsValue: number;
    actualSecondary: number;
  };
  lines: StatementLine[];
  aws: { status: 'pending' | 'confirmed' | null; contentType: string | null };
  ss: { status: 'pending' | 'confirmed' | null; contentType: string | null };
  history: HistoryItem[];
};

export type HistoryItem = {
  id: string;
  stockistId: string;
  stockistName: string;
  month: string;
  status: StatementStatus;
  actualSecondary: number;
  submittedByName: string | null;
  currentApproverName?: string | null;
  decidedByName?: string | null;
};

export type StockistOption = { id: string; name: string; city: string | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  await apiReady();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw toApiError(body);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/pdf')) return (await res.blob()) as T;
  return (await res.json()) as T;
}

export const listStockists = () =>
  call<{ items: StockistOption[] }>('/v1/stock-statements/stockists');

export const listStatements = (query: { waiting?: boolean; status?: StatementStatus }) => {
  const q = new URLSearchParams();
  if (query.waiting) q.set('waiting', 'true');
  if (query.status) q.set('status', query.status);
  const s = q.toString();
  return call<{ items: HistoryItem[] }>(`/v1/stock-statements${s ? `?${s}` : ''}`);
};

export const getStatement = (id: string) => call<Statement>(`/v1/stock-statements/${id}`);

export const openStatement = (stockistId: string, month: string) =>
  call<Statement>('/v1/stock-statements', {
    method: 'POST',
    body: JSON.stringify({ stockistId, month }),
  });

export const saveLines = (
  id: string,
  version: number,
  lines: {
    productId: string;
    openingQty: number | null;
    purchaseQty: number;
    freeQty: number;
    secondaryQty: number;
    frsQty: number;
  }[],
) =>
  call<Statement>(`/v1/stock-statements/${id}/lines`, {
    method: 'POST',
    body: JSON.stringify({ version, lines }),
  });

export const requestUnlock = (id: string) =>
  call<Statement>(`/v1/stock-statements/${id}/unlock`, { method: 'POST' });

export const submitStatement = (id: string, version: number) =>
  call<Statement>(`/v1/stock-statements/${id}/submit`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });

export const presignFile = (id: string, kind: 'aws' | 'ss', file: File, contentType: string) =>
  call<{ uploadUrl: string; headers: Record<string, string>; method: 'PUT' }>(
    `/v1/stock-statements/${id}/files`,
    {
      method: 'POST',
      body: JSON.stringify({ kind, contentType, sizeBytes: file.size }),
    },
  );

export const confirmFile = (id: string, kind: 'aws' | 'ss') =>
  call<Statement>(`/v1/stock-statements/${id}/files/confirm`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });

export const fileLink = (id: string, kind: 'aws' | 'ss') =>
  call<{ downloadUrl: string }>(`/v1/stock-statements/${id}/files/${kind}`);

export const removeFile = (id: string, kind: 'aws' | 'ss') =>
  call<Statement>(`/v1/stock-statements/${id}/files/${kind}`, { method: 'DELETE' });

export async function downloadPdf(id: string, name: string) {
  const blob = await call<Blob>(`/v1/stock-statements/${id}/export`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function messageOf(error: unknown) {
  const e = error as ApiError;
  return e?.message || 'Something went wrong. Try again.';
}
