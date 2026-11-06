import { doctors, userTerritories, users, type Tx } from '@ariforce/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export type OccasionKind = 'birthday' | 'anniversary';

export type OccasionHit = {
  doctorId: string;
  name: string;
  kind: OccasionKind;
  days: number;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days from `today` (YYYY-MM-DD) until the next month-day of `iso`. Year is ignored. 0..5, else null. */
export function daysUntilOccasion(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;
  const m = ISO.exec(iso.trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const [y, tm, td] = today.split('-').map(Number);
  if (!y || !tm || !td) return null;
  const start = Date.UTC(y, tm - 1, td);
  let target = occasionUtc(y, month, day);
  if (target < start) target = occasionUtc(y + 1, month, day);
  const diff = Math.round((target - start) / 86_400_000);
  return diff >= 0 && diff <= 5 ? diff : null;
}

/** Feb 29 in a non-leap year falls on Feb 28 so the reminder still happens. */
function occasionUtc(year: number, month: number, day: number) {
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(year, month - 1, Math.min(day, dim));
}

export function occasionWhen(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function occasionTitle(lines: { kind: OccasionKind }[]): string {
  const kinds = new Set(lines.map((l) => l.kind));
  if (kinds.size === 1 && kinds.has('birthday')) return 'Birthdays coming up';
  if (kinds.size === 1 && kinds.has('anniversary')) return 'Anniversaries coming up';
  return 'Doctor dates coming up';
}

export function occasionSummary(
  lines: { name: string; kind: OccasionKind; days: number }[],
): string {
  const shown = lines.slice(0, 12);
  const text = shown.map((l) => `${l.name}: ${l.kind} ${occasionWhen(l.days)}`).join('\n');
  const more = lines.length - shown.length;
  return more > 0 ? `${text}\n+${more} more` : text;
}

/**
 * Approved doctors whose birthday or anniversary is today or within the next 5 days.
 * Recipients are people assigned to the doctor's HQ (or local territory) and the managers above them.
 */
export async function doctorOccasionRecipients(tx: Tx, runDate: string) {
  const rows = await tx
    .select({
      id: doctors.id,
      name: doctors.name,
      territoryId: doctors.territoryId,
      localTerritoryId: doctors.localTerritoryId,
      dateOfBirth: doctors.dateOfBirth,
      anniversary: doctors.anniversary,
    })
    .from(doctors)
    .where(and(isNull(doctors.deletedAt), eq(doctors.approvalStatus, 'approved')));

  const hits: (OccasionHit & { territoryId: string; localTerritoryId: string | null })[] = [];
  for (const d of rows) {
    const birthday = daysUntilOccasion(d.dateOfBirth, runDate);
    const anniversary = daysUntilOccasion(d.anniversary, runDate);
    if (birthday !== null)
      hits.push({
        doctorId: d.id,
        name: d.name,
        territoryId: d.territoryId,
        localTerritoryId: d.localTerritoryId,
        kind: 'birthday',
        days: birthday,
      });
    if (anniversary !== null)
      hits.push({
        doctorId: d.id,
        name: d.name,
        territoryId: d.territoryId,
        localTerritoryId: d.localTerritoryId,
        kind: 'anniversary',
        days: anniversary,
      });
  }

  const out = new Map<string, OccasionHit[]>();
  if (!hits.length) return out;

  const territoryIds = [
    ...new Set(
      hits.flatMap((h) => [h.territoryId, h.localTerritoryId].filter((x): x is string => !!x)),
    ),
  ];
  const assigned = await tx
    .select({ userId: userTerritories.userId, territoryId: userTerritories.territoryId })
    .from(userTerritories)
    .innerJoin(users, eq(users.id, userTerritories.userId))
    .where(
      and(
        inArray(userTerritories.territoryId, territoryIds),
        isNull(users.deletedAt),
        eq(users.status, 'active'),
      ),
    );

  const byTerritory = new Map<string, string[]>();
  for (const a of assigned) {
    const list = byTerritory.get(a.territoryId) ?? [];
    list.push(a.userId);
    byTerritory.set(a.territoryId, list);
  }

  const managers = new Map<string, string[]>();
  const chain = async (userId: string) => {
    const cached = managers.get(userId);
    if (cached) return cached;
    const r = await tx.execute<{ id: string }>(sql`with recursive up(id, depth) as (
        select manager_id, 1 from users where id = ${userId} and manager_id is not null
        union all
        select u.manager_id, up.depth + 1 from up join users u on u.id = up.id
        where u.manager_id is not null and up.depth < 6)
      select up.id from up join users u on u.id = up.id
      where u.deleted_at is null and u.status = 'active'`);
    const ids = r.rows.map((x) => x.id);
    managers.set(userId, ids);
    return ids;
  };

  const push = (userId: string, hit: OccasionHit) => {
    const list = out.get(userId) ?? [];
    if (!list.some((x) => x.doctorId === hit.doctorId && x.kind === hit.kind)) list.push(hit);
    out.set(userId, list);
  };

  for (const hit of hits) {
    const seeds = new Set<string>([
      ...(byTerritory.get(hit.territoryId) ?? []),
      ...(hit.localTerritoryId ? (byTerritory.get(hit.localTerritoryId) ?? []) : []),
    ]);
    for (const userId of seeds) {
      push(userId, hit);
      for (const managerId of await chain(userId)) push(managerId, hit);
    }
  }
  return out;
}
