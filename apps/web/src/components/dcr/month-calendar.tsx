'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { cn } from '@ariforce/ui/lib/utils';
import {
  datesOf,
  dayLabel,
  monthLabel,
  shiftMonth,
  weekdayMon,
} from '@/components/tour-plans/month';
import type { CalendarPillStatus, DayPill } from '@/lib/dcr/calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const PILL: Record<CalendarPillStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-info-soft text-info' },
  pending: { label: 'Pending', tone: 'bg-accent/10 text-teal-700' },
  locked: { label: 'Locked', tone: 'bg-muted text-foreground' },
  approved: { label: 'Approved', tone: 'bg-success-soft text-success' },
  rejected: { label: 'Rejected', tone: 'bg-danger-soft text-destructive' },
  tp: {
    label: 'From TP',
    tone: 'border border-dashed border-teal-600/40 bg-teal-50 text-teal-900',
  },
};

function dominant(pills: DayPill[]): CalendarPillStatus | null {
  if (!pills.length) return null;
  if (pills.some((p) => p.status === 'rejected')) return 'rejected';
  if (pills.some((p) => p.status === 'pending')) return 'pending';
  if (pills.some((p) => p.status === 'locked')) return 'locked';
  if (pills.some((p) => p.status === 'approved')) return 'approved';
  if (pills.some((p) => p.status === 'draft')) return 'draft';
  return pills[0]?.status ?? null;
}

/**
 * Month grid for DCR — same layout language as tour plans / leave calendars.
 */
export function DcrMonthCalendar({
  month,
  today,
  selected,
  pills,
  onMonthChange,
  onSelectDay,
  closedEmptyDays = false,
}: {
  /** DCR rule: only today can get a new report, so empty past/future days are disabled. */
  closedEmptyDays?: boolean;
  month: string;
  today: string;
  selected: string | null;
  pills: Map<string, DayPill[]>;
  onMonthChange: (month: string) => void;
  onSelectDay: (date: string, dayPills: DayPill[]) => void;
}) {
  const dates = datesOf(month);
  const lead = weekdayMon(`${month}-01`);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="dcr-month" data-testid="dcr-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <h2 id="dcr-month" className="min-w-40 text-center text-base font-semibold tabular-nums">
            {monthLabel(month)}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(['draft', 'pending', 'approved', 'rejected', 'locked', 'tp'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn('rounded px-1.5 py-0.5 font-medium', PILL[s].tone)}>
                {PILL[s].label}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div
        className="hidden grid-cols-7 gap-px pb-1 text-xs font-medium text-muted-foreground sm:grid"
        aria-hidden
      >
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2">
            {w}
          </div>
        ))}
      </div>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-7 sm:gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad${i}`} aria-hidden className="hidden sm:block" />
        ))}
        {dates.map((date) => {
          const dayPills = pills.get(date) ?? [];
          const empty = dayPills.length === 0;
          const status = dominant(dayPills);
          const isToday = date === today;
          const isSelected = date === selected;
          const closed = closedEmptyDays && empty && !isToday;
          return (
            <li key={date}>
              <button
                type="button"
                data-testid="dcr-cal-day"
                data-date={date}
                data-empty={empty || undefined}
                data-status={status ?? undefined}
                disabled={closed}
                onClick={() => onSelectDay(date, dayPills)}
                aria-label={`${dayLabel(date)}${dayPills.length ? `: ${dayPills.map((p) => p.label).join(', ')}` : ', no report'}`}
                aria-pressed={isSelected}
                className={cn(
                  'flex min-h-14 w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm transition-[transform,background-color] duration-150 active:scale-[0.98] sm:min-h-20',
                  empty ? 'border-dashed hover:bg-muted/60' : 'bg-card hover:bg-muted/60',
                  closed && 'cursor-not-allowed opacity-50 hover:bg-transparent active:scale-100',
                  isToday && 'border-primary',
                  isSelected && 'ring-2 ring-ring/40',
                )}
              >
                <span className="text-xs tabular-nums text-muted-foreground">
                  <span className="sm:hidden">{dayLabel(date)}</span>
                  <span className="hidden sm:inline">{Number(date.slice(8))}</span>
                </span>
                {empty ? (
                  <span className="text-muted-foreground">
                    {closedEmptyDays
                      ? isToday
                        ? 'File today'
                        : date < today
                          ? 'No report'
                          : 'Future day'
                      : date <= today
                        ? 'File this day'
                        : 'Future day'}
                  </span>
                ) : (
                  <>
                    {dayPills.slice(0, 3).map((p) => (
                      <span
                        key={p.itemId}
                        title={p.label}
                        className="line-clamp-2 max-w-full whitespace-normal [overflow-wrap:anywhere] text-xs font-medium leading-tight sm:text-[11px]"
                      >
                        {p.label}
                      </span>
                    ))}
                    {dayPills.length > 3 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{dayPills.length - 3} more
                      </span>
                    )}
                    {status && (
                      <span
                        className={cn(
                          'mt-0.5 rounded px-1.5 text-[11px] font-medium',
                          PILL[status].tone,
                        )}
                      >
                        {PILL[status].label}
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
