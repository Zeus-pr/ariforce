import { DEFAULT_ROLE_PERMISSIONS, type ExceptionItem } from '@ariforce/contracts';
import type { Role } from '@/lib/roles';

export const can = (role: Role, perm: string) =>
  ((DEFAULT_ROLE_PERMISSIONS[role] ?? []) as string[]).includes(perm);
export const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const STATUS_LABEL = {
  open: 'Open',
  acknowledged: 'Explained',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
} as const;
export const isClosed = (x: Pick<ExceptionItem, 'status'>) =>
  x.status === 'resolved' || x.status === 'dismissed';
export const STATUS_FILTERS: Record<string, { label: string; value?: string }> = {
  active: { label: 'Open and explained', value: 'open,acknowledged' },
  open: { label: 'Open', value: 'open' },
  acknowledged: { label: 'Explained', value: 'acknowledged' },
  closed: { label: 'Resolved or dismissed', value: 'resolved,dismissed' },
  all: { label: 'All' },
};

export function exceptionMessage(code?: string, message?: string): string {
  switch (code) {
    case 'EXCEPTION_CLOSED':
      return 'This exception is already closed.';
    case 'VERSION_CONFLICT':
      return 'Someone else updated this exception. Reopen it to see the latest.';
    case 'ASSIGNEE_OUT_OF_SCOPE':
      return 'You can only assign yourself or someone in your team.';
    case 'FORBIDDEN':
      return message || 'You are not allowed to do that.';
    case 'NOT_FOUND':
      return 'This exception no longer exists or is outside your team.';
    default:
      return message || 'Something went wrong. Try again.';
  }
}

/** Where an exception drills to. */
export function sourceLink(x: ExceptionItem): { label: string; href: string } {
  if (x.ruleCode === 'tp_not_submitted') return { label: 'Open tour plans', href: '/tour-plans' };
  if (x.ruleCode === 'no_punch_in') return { label: 'Open attendance', href: '/attendance' };
  if (x.ruleCode === 'coverage_gap') return { label: 'Open doctors', href: '/doctors' };
  return { label: 'Open DCR', href: '/dcr' };
}

export function measured(x: ExceptionItem): string | null {
  if (x.value === null) return null;
  return x.threshold === null ? String(x.value) : `${x.value} (limit ${x.threshold})`;
}
