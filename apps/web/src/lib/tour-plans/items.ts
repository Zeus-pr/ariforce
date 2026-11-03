import { api, apiReady, toApiError } from '@/lib/api';

export type TpItem = {
  id: string;
  companyId: string;
  userId: string;
  userName: string;
  from: string;
  to: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  plan: {
    workTypeId: string;
    territoryIds: string[];
    workWithUserIds: string[];
    sfcRoutes: { hqTerritoryId: string; sfcRouteId: string }[];
    details: unknown;
  };
  version: number;
  filedDates: string[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
};

type TpItemListResponse = { items: TpItem[]; nextCursor: string | null; serverTime: string };
type Result<T> = { data?: T; error?: unknown; response: Response };
type Init = {
  params?: { path?: Record<string, string>; query?: Record<string, string | number> };
  body?: unknown;
};
const rawApi = api as unknown as {
  GET: (path: string, init?: Init) => Promise<Result<TpItemListResponse | TpItem>>;
  PUT: (path: string, init: Init) => Promise<Result<TpItem>>;
  POST: (path: string, init: Init) => Promise<Result<TpItem>>;
};

export type TpItemPlanInput = TpItem['plan'];

export async function fetchMyTourPlanItems(): Promise<TpItem[]> {
  await apiReady();
  const items: TpItem[] = [];
  let cursor: string | undefined;
  do {
    const r = await rawApi.GET('/v1/tour-plans/items', {
      params: { query: { mine: 'true', limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    if (!r.data || !('items' in r.data))
      throw new Error(toApiError(r).message || 'Could not load tour plans.');
    items.push(...r.data.items);
    cursor = r.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export async function fetchPendingTourPlanItems(currentUserId: string): Promise<TpItem[]> {
  await apiReady();
  const items: TpItem[] = [];
  let cursor: string | undefined;
  do {
    const r = await rawApi.GET('/v1/tour-plans/items', {
      params: { query: { status: 'pending', limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    if (!r.data || !('items' in r.data))
      throw new Error(toApiError(r).message || 'Could not load tour plans awaiting approval.');
    items.push(...r.data.items.filter((item) => item.userId !== currentUserId));
    cursor = r.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export async function saveTourPlanItem(input: {
  id?: string;
  version?: number;
  from: string;
  to: string;
  plan: TpItemPlanInput;
}): Promise<TpItem> {
  await apiReady();
  const r = await rawApi.PUT('/v1/tour-plans/items', {
    body: { ...input, ...(input.id ? { id: input.id, version: input.version } : {}) },
  });
  if (!r.data || 'items' in r.data)
    throw new Error(toApiError(r).message || 'Could not save the tour plan.');
  return r.data;
}

export async function submitTourPlanItem(id: string): Promise<TpItem> {
  await apiReady();
  const r = await rawApi.POST('/v1/tour-plans/items/{id}/submit', {
    params: { path: { id } },
    body: {},
  });
  if (!r.data || 'items' in r.data)
    throw new Error(toApiError(r).message || 'Could not submit the tour plan.');
  return r.data;
}

export async function decideTourPlanItem(
  id: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<TpItem> {
  await apiReady();
  const r = await rawApi.POST('/v1/tour-plans/items/{id}/decision', {
    params: { path: { id } },
    body: { decision, ...(comment ? { comment } : {}) },
  });
  if (!r.data || 'items' in r.data)
    throw new Error(toApiError(r).message || 'Could not update the tour-plan decision.');
  return r.data;
}
