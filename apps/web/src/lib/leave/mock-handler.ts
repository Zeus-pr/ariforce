/**
 * Mock mode only: the contracts mock does not cross-check leave against Tour Plans / DCR, so this
 * applies the API rule (docs/LEAVE.md): a field/non-field entry on an approved leave day is
 * 422 LEAVE_DAY_BLOCKED with details.dates. Everything else falls through to the contract mock.
 */
import { http, HttpResponse } from 'msw';

type Entry = { workTypeId: string };
type Leave = { fromDate: string; toDate: string; half: 'am' | 'pm' | null };

const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function blockedDates(base: string, request: Request, candidates: { date: string; workTypeIds: string[] }[], fullOnly: boolean) {
  if (!candidates.length) return [];
  const headers: Record<string, string> = {};
  // MSW browser handlers run in the page: use the signed-in mock persona (TP/DCR requests do not carry it).
  try {
    const sess = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as { role?: string; previewRole?: string } | null;
    const who = request.headers.get('x-mock-user') ?? sess?.previewRole ?? sess?.role;
    if (who) headers['x-mock-user'] = who;
  } catch {
    /* default persona */
  }
  const [lr, wr] = await Promise.all([
    fetch(`${base}/v1/leave/requests?mine=true&status=approved&limit=200`, { headers }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${base}/v1/work-types?limit=200`, { headers }).then((r) => (r.ok ? r.json() : null)),
  ]).catch(() => [null, null]);
  if (!lr || !wr) return [];
  const working = new Set<string>(
    (wr.items as { id: string; kind: string }[]).filter((w) => w.kind === 'field' || w.kind === 'non_field').map((w) => w.id),
  );
  const leaveDays = new Set<string>();
  for (const l of lr.items as Leave[]) {
    if (fullOnly && l.half) continue;
    for (let d = l.fromDate; d <= l.toDate; d = addDay(d)) leaveDays.add(d);
  }
  return candidates.filter((c) => leaveDays.has(c.date) && c.workTypeIds.some((id) => working.has(id))).map((c) => c.date);
}

const blocked = (dates: string[]) =>
  HttpResponse.json(
    { error: { code: 'LEAVE_DAY_BLOCKED', message: 'Work entry on an approved leave day', details: { dates } } },
    { status: 422 },
  );

export function mockLeaveDayBlock(base: string) {
  return [
    // The contracts mock has no PUT /v1/leave/settings; echo the saved rules (page memory only).
    http.put(`${base}/v1/leave/settings`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
      if (!b || typeof b.version !== 'number')
        return HttpResponse.json({ error: { code: 'VALIDATION', message: 'version: required' } }, { status: 422 });
      return HttpResponse.json({ ...b, version: b.version + 1 });
    }),
    http.put(`${base}/v1/tour-plans/:month`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => null)) as { days?: { date: string; entries: Entry[] }[] } | null;
      const c = (b?.days ?? []).filter((d) => d.entries?.length).map((d) => ({ date: d.date, workTypeIds: d.entries.map((e) => e.workTypeId) }));
      const dates = await blockedDates(base, request, c, false);
      return dates.length ? blocked(dates) : undefined;
    }),
    http.put(`${base}/v1/dcrs`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => null)) as { date?: string; workTypeId?: string } | null;
      if (!b?.date || !b.workTypeId) return undefined;
      const dates = await blockedDates(base, request, [{ date: b.date, workTypeIds: [b.workTypeId] }], true);
      return dates.length ? blocked(dates) : undefined;
    }),
  ];
}
