'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LeaveCalendarEntry } from '@/lib/leave/model';
import { Button } from '@ariforce/ui/components/button';
import { cn } from '@ariforce/ui/lib/utils';
import { datesOf, dayLabel, monthLabel, shiftMonth, thisMonthIST, weekdayMon } from '@/components/tour-plans/month';
import { api, apiReady, toApiError } from '@/lib/api';
import { dow, leaveMessage, today } from '@/lib/leave/model';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month view of approved and pending leave: team for approvers, otherwise just you (the API decides). */
export function LeaveCalendar({ weeklyOff, team }: { weeklyOff: number[]; team: boolean }) {
  const [month, setMonth] = useState(thisMonthIST());
  const [items, setItems] = useState<LeaveCalendarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dates = datesOf(month);
  const t = today();

  useEffect(() => {
    const ac = new AbortController();
    const ds = datesOf(month);
    void (async () => {
      setItems(null);
      await apiReady();
      const r = await api
        .GET('/v1/leave/calendar', { params: { query: { from: ds[0]!, to: ds.at(-1)!, includePending: 'true' } }, signal: ac.signal })
        .catch(() => null);
      if (ac.signal.aborted || !r) return;
      if (r.error) return setError(leaveMessage(toApiError(r)));
      setError(null);
      setItems(r.data?.items ?? []);
    })().catch(() => {});
    return () => ac.abort();
  }, [month]);

  const on = (d: string) => (items ?? []).filter((i) => i.dates.includes(d));
  const lead = weekdayMon(`${month}-01`);

  return (
    <section aria-labelledby="leave-cal-h" className="flex flex-col gap-3" data-testid="leave-calendar">
      <div className="flex items-center justify-between gap-2">
        <h2 id="leave-cal-h" className="text-base font-semibold" aria-live="polite">
          {monthLabel(month)}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{team ? 'You and your team' : 'Your leave'}</span>
        </h2>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-200" /> Approved
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-3 rounded-sm border border-dashed border-amber-500 bg-amber-50" /> Waiting
        </span>
      </div>
      <div className="hidden grid-cols-7 gap-px text-xs font-medium text-muted-foreground sm:grid" aria-hidden>
        {WEEK.map((w) => (
          <span key={w} className="px-2">
            {w}
          </span>
        ))}
      </div>
      <ol className={cn('grid grid-cols-1 gap-1.5 sm:grid-cols-7', items === null && 'animate-pulse')}>
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad${i}`} className="hidden sm:block" aria-hidden />
        ))}
        {/* On phones only days with leave are listed; the full grid shows from sm up. */}
        {dates.map((d) => {
          const es = on(d);
          const off = weeklyOff.includes(dow(d));
          return (
            <li
              key={d}
              data-testid="leave-cal-day"
              data-date={d}
              className={cn(
                'min-h-12 flex-col gap-1 rounded-md border px-2 py-1.5 text-xs sm:flex sm:min-h-20',
                es.length ? 'flex' : 'hidden',
                off && 'bg-muted/50',
                d === t && 'border-primary',
              )}
            >
              <span className="tabular-nums text-muted-foreground">
                <span className="sm:hidden">{dayLabel(d)}</span>
                <span className="hidden sm:inline">{Number(d.slice(8))}</span>
                {off && <span className="ml-1">· off</span>}
              </span>
              {es.map((e) => (
                <span
                  key={e.requestId}
                  data-testid="leave-cal-entry"
                  data-status={e.status}
                  title={`${e.userName}: ${e.typeCode}${e.half ? ' (half day)' : ''}, ${e.status === 'approved' ? 'approved' : 'waiting'}`}
                  className={cn(
                    'truncate rounded px-1.5 py-0.5',
                    e.status === 'approved' ? 'bg-emerald-100 text-emerald-900' : 'border border-dashed border-amber-500 bg-amber-50 text-amber-900',
                  )}
                >
                  {team ? `${e.userName.split(' ')[0]} · ` : ''}
                  {e.typeCode}
                  {e.half ? ' ½' : ''}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
      {items !== null && items.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="leave-cal-empty">
          No leave in {monthLabel(month)}.
        </p>
      )}
    </section>
  );
}
