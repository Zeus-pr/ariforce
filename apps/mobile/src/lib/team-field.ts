/**
 * Manager team field view: attendance summary + check-in timeline (GET /v1/attendance, /v1/check-ins).
 */
import type { AttendanceDay, CheckIn } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';
import { listAttendanceDays, listCheckInsInRange } from './field';
import type { OutletKind } from './field';

type Page<T> = { items: T[] };

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const timeIST = (iso: string) => `${timeFmt.format(new Date(iso))} IST`;

const KIND_LABEL: Record<CheckIn['kind'], string> = {
  punch_in: 'Punch in',
  visit: 'Visit',
  punch_out: 'Punch out',
};

const OUTLET_LABEL: Record<OutletKind, string> = {
  doctor: 'Doctor',
  chemist: 'Chemist',
  stockist: 'Stockist',
};

export function checkInTitle(c: CheckIn, outletNames: ReadonlyMap<string, string>) {
  if (c.kind === 'visit' && c.outletId && c.outletKind) {
    const name = outletNames.get(c.outletId);
    const kind = OUTLET_LABEL[c.outletKind];
    return name ? `${kind} · ${name}` : `${kind} visit`;
  }
  return KIND_LABEL[c.kind];
}

export type PunchChip = 'in' | 'out' | 'absent' | 'incomplete';

export const PUNCH_CHIP_LABEL: Record<PunchChip, string> = {
  in: 'In',
  out: 'Out',
  absent: 'Absent',
  incomplete: 'Incomplete',
};

/** Punch status label for a team member's day row (plain text — no colored pills). */
export function punchChip(day: AttendanceDay): PunchChip {
  if (day.status === 'absent' || day.status === 'leave' || day.status === 'holiday') {
    return 'absent';
  }
  if (day.status === 'incomplete') return 'incomplete';
  if (day.punchIn && !day.punchOut) return 'in';
  if (day.punchIn && day.punchOut) return 'out';
  return 'incomplete';
}

export function teamFieldMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Could not load team field data.';
}

const OUTLET_PATH: Record<OutletKind, string> = {
  doctor: '/v1/doctors',
  chemist: '/v1/chemists',
  stockist: '/v1/stockists',
};

async function fetchOutletNames(kind: OutletKind, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const page = await apiFetch<Page<{ id: string; name: string }>>(OUTLET_PATH[kind], {
      query: { ids: slice.join(','), limit: 100 },
    });
    for (const row of page.items ?? []) names.set(row.id, row.name);
  }
  return names;
}

/** Resolve outlet names for visit check-ins on this day. */
export async function loadOutletNames(checkIns: CheckIn[]): Promise<Map<string, string>> {
  const byKind: Record<OutletKind, Set<string>> = {
    doctor: new Set(),
    chemist: new Set(),
    stockist: new Set(),
  };
  for (const c of checkIns) {
    if (c.kind === 'visit' && c.outletId && c.outletKind) byKind[c.outletKind].add(c.outletId);
  }
  const merged = new Map<string, string>();
  await Promise.all(
    (Object.keys(byKind) as OutletKind[]).map(async (kind) => {
      const part = await fetchOutletNames(kind, [...byKind[kind]]);
      part.forEach((v, k) => merged.set(k, v));
    }),
  );
  return merged;
}

export function checkInsForUser(checkIns: CheckIn[], userId: string) {
  return [...checkIns]
    .filter((c) => c.userId === userId)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/**
 * Team field for managers: attendance + check-ins of the reporting line for one day.
 * Pass `selfUserId` to drop the caller's own row — this screen is about the team, not self.
 */
export function useTeamFieldDay(date: string, selfUserId?: string) {
  const attendanceQ = useQuery({
    queryKey: ['team-field', 'attendance', date],
    queryFn: () => listAttendanceDays(date, date),
  });
  const checkInsQ = useQuery({
    queryKey: ['team-field', 'check-ins', date],
    queryFn: () => listCheckInsInRange(date, date),
  });

  const days = (attendanceQ.data ?? []).filter((d) => d.userId !== selfUserId);
  const checkIns = (checkInsQ.data ?? []).filter((c) => c.userId !== selfUserId);
  const sortedDays = [...days].sort((a, b) => a.userName.localeCompare(b.userName));

  const namesQ = useQuery({
    queryKey: [
      'team-field',
      'outlet-names',
      date,
      checkIns.map((c) => c.id).join(','),
    ],
    queryFn: () => loadOutletNames(checkIns),
    enabled: checkIns.length > 0,
  });

  const summary = sortedDays.reduce(
    (acc, d) => {
      const chip = punchChip(d);
      acc[chip] += 1;
      return acc;
    },
    { in: 0, out: 0, absent: 0, incomplete: 0 } as Record<PunchChip, number>,
  );

  return {
    days: sortedDays,
    checkIns,
    outletNames: namesQ.data ?? new Map<string, string>(),
    summary,
    isPending: attendanceQ.isPending || checkInsQ.isPending,
    isError: attendanceQ.isError || checkInsQ.isError,
    error: attendanceQ.error ?? checkInsQ.error,
    refetch: () => Promise.all([attendanceQ.refetch(), checkInsQ.refetch(), namesQ.refetch()]),
  };
}
