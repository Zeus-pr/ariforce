/**
 * In-app notifications (#35), live API: GET /v1/notifications (newest first, cursor paged),
 * GET /v1/notifications/unread-count, POST /v1/notifications/:id/read, POST .../read-all.
 *
 * Gaps (CONTRACT flags; the app is ready for them, nothing is mocked): the API has no DCR
 * notifications (dcr.approved / dcr.rejected, entityType 'dcr'), no dcr_unlock.approved, no
 * tour plan ITEM types (entityType 'tour_plan_item'), and no "waiting for you" notifications to
 * approvers for DCR / TP / unlock requests. Unknown future types still list and open by
 * entityType / data.date when present.
 */
import type { Notification } from '@ariforce/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { apiFetch } from './api';

export const CONTRACT = {
  dcrNotifications: false,
  tpItemNotifications: false,
  approverNotifications: false,
} as const;

/** The live shape, widened for the types/entities Architect may add. */
export type Notif = Omit<Notification, 'type' | 'entityType'> & {
  type: Notification['type'] | (string & {});
  entityType: Notification['entityType'] | 'dcr' | 'tour_plan_item' | (string & {});
};

const key = ['notifications'] as const;

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ items: Notif[]; nextCursor: string | null }>('/v1/notifications', {
        signal,
        query: { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (p) => p.nextCursor,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: [...key, 'unread'],
    enabled,
    refetchInterval: 60_000,
    queryFn: ({ signal }) =>
      apiFetch<{ count: number }>('/v1/notifications/unread-count', { signal }).then(
        (r) => r.count,
      ),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Notif>(`/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>('/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Where a notification opens (existing app routes), or null when there is nothing to open. */
export function notificationHref(n: Notif): Href | null {
  const id = n.entityId;
  const date = str(n.data?.date) ?? str(n.data?.dcrDate);
  switch (n.entityType) {
    case 'leave_request':
      return n.type === 'leave.submitted' ? '/approvals' : '/leave';
    case 'expense_claim':
      return id ? { pathname: '/expenses/[id]', params: { id } } : '/expenses';
    case 'tour_plan':
      return '/tour-plan';
    case 'tour_plan_item':
      return id ? { pathname: '/tour-plan/form', params: { id } } : '/tour-plan';
    case 'doctor':
      return id ? { pathname: '/masters/[kind]/[id]', params: { kind: 'doctors', id } } : null;
    case 'dcr':
      return id ? { pathname: '/dcr/form', params: { id } } : '/dcr';
    case 'approval_request':
      // dcr_unlock.*: open that day's DCR when the payload has the date, else the DCR list.
      if (n.type.startsWith('dcr_unlock'))
        return date ? { pathname: '/dcr/form', params: { date } } : '/dcr';
      return '/approvals';
    default:
      return null;
  }
}

/** Icon per notification family. */
export function notificationIcon(n: Notif) {
  const t = n.type;
  if (t.startsWith('leave')) return 'beach' as const;
  if (t.startsWith('expense')) return 'receipt' as const;
  if (t.startsWith('tour_plan')) return 'calendar-month-outline' as const;
  if (t.startsWith('doctor')) return 'stethoscope' as const;
  if (t.startsWith('dcr')) return 'clipboard-text-outline' as const;
  return 'bell-outline' as const;
}
