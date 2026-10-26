import type { Exception } from './rules';

/** Where an exception drills to. Later pages (team drill-down, Doctor 360) add their links here. */
export function detailLinks(e: Exception, manager: boolean): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const source: Record<string, string> = {
    '/attendance': 'Open attendance',
    '/dcr': 'Open DCR',
    '/tour-plans': 'Open tour plan',
    '/': 'Open dashboard',
  };
  if (manager && e.userId && !e.sample) out.push({ label: `Open ${e.who} in team performance`, href: `/team?u=${e.userId}` });
  if (e.doctorId) out.push({ label: 'Open doctor 360', href: `/doctors?id=${e.doctorId}` });
  out.push({ label: source[e.href] ?? 'Open', href: e.href });
  return out;
}
