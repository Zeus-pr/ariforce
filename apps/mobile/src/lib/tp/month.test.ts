/// <reference types="jest" />
import { outletAlreadyOnDay } from '@/lib/dcr/day-rules';
import {
  exemptLeaveDates,
  monthEnd,
  monthView,
  stretchesOf,
  TP_REMINDER_GAP_MS,
  tpDeadlinePassed,
  tpPunchGate,
  tpReminder,
  type MonthItem,
} from '@/lib/tp/month';

const plan = {
  workTypeId: 'wt',
  territoryIds: ['t'],
  workWithUserIds: [],
  sfcRoutes: [],
  details: null,
};

function item(
  id: string,
  from: string,
  to: string,
  status: MonthItem['status'],
  updatedAt = '2026-11-01T00:00:00.000Z',
): MonthItem {
  return { id, from, to, status, updatedAt, plan };
}

describe('month stretches', () => {
  const day = (date: string, workTypeId: string) => ({
    date,
    workTypeId,
    territoryIds: [workTypeId],
    workWithUserIds: [],
    sfcRoutes: [],
    details: null,
  });

  it('joins days of the same plan and splits when the plan changes', () => {
    const stretches = stretchesOf({
      from: '2026-12-01',
      to: '2026-12-31',
      plan: {
        ...plan,
        days: [
          day('2026-12-01', 'a'),
          day('2026-12-02', 'a'),
          day('2026-12-11', 'b'),
          day('2026-12-12', 'b'),
          day('2026-12-21', 'c'),
        ],
      },
    });
    expect(stretches.map((stretch) => [stretch.from, stretch.to, stretch.plan.workTypeId])).toEqual([
      ['2026-12-01', '2026-12-02', 'a'],
      ['2026-12-11', '2026-12-12', 'b'],
      ['2026-12-21', '2026-12-21', 'c'],
    ]);
  });
});

describe('one visit a day', () => {
  const sections = [
    { calls: [{ clientId: 'a', kind: 'doctor', outletId: 'd1' }] },
    { calls: [{ clientId: 'b', kind: 'chemist', outletId: 'c1' }] },
  ];

  it('blocks the same doctor on the other report', () => {
    expect(outletAlreadyOnDay(sections, 'doctor', 'd1', 'new')).toBe(true);
  });

  it('allows the same row to keep its own customer', () => {
    expect(outletAlreadyOnDay(sections, 'doctor', 'd1', 'a')).toBe(false);
  });

  it('allows a different kind', () => {
    expect(outletAlreadyOnDay(sections, 'stockist', 'd1', 'new')).toBe(false);
  });
});

describe('tour plan month', () => {
  it('knows the last day of the month', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('treats a full-day leave and the weekly off as not required', () => {
    const leave = exemptLeaveDates(
      [
        { fromDate: '2026-12-02', toDate: '2026-12-02', half: null, status: 'pending' },
        { fromDate: '2026-12-03', toDate: '2026-12-03', half: 'am', status: 'approved' },
        { fromDate: '2026-12-04', toDate: '2026-12-04', half: null, status: 'rejected' },
      ],
      '2026-12-01',
      '2026-12-31',
      [0],
    );
    expect(leave.has('2026-12-02')).toBe(true);
    expect(leave.has('2026-12-03')).toBe(false);
    expect(leave.has('2026-12-04')).toBe(false);

    const days = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
    const drafts = days.map((d, i) => item(String(i), d, d, 'draft'));
    const view = monthView(
      drafts.filter((d) => d.from !== '2026-12-02' && d.from !== '2026-12-06'),
      '2026-12-01',
      '2026-12-07',
      leave,
      [0],
    );
    expect(view.kind).toBe('gaps');
    if (view.kind === 'gaps') {
      expect(view.dates).toEqual(['2026-12-05', '2026-12-07']);
    }
  });

  it('is ready when every working day is a draft, and sent once those are pending', () => {
    const drafts = [
      item('a', '2026-12-01', '2026-12-01', 'draft'),
      item('b', '2026-12-02', '2026-12-02', 'draft'),
    ];
    const ready = monthView(drafts, '2026-12-01', '2026-12-02', new Set(), []);
    expect(ready.kind).toBe('ready');
    if (ready.kind === 'ready') {
      expect(ready.days.map((d) => d.date)).toEqual(['2026-12-01', '2026-12-02']);
      expect(ready.draftIds.sort()).toEqual(['a', 'b']);
    }
    const sent = monthView(
      [item('m', '2026-12-01', '2026-12-02', 'pending')],
      '2026-12-01',
      '2026-12-02',
      new Set(),
      [],
    );
    expect(sent.kind).toBe('sent');
  });

  it('accepts December with or without a Sunday plan', () => {
    const weekdays = [
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-07',
    ].map((date, i) => item(String(i), date, date, 'approved'));
    const bare = monthView(weekdays, '2026-12-01', '2026-12-07', new Set(), []);
    expect(bare.kind).toBe('sent');
    const withSunday = monthView(
      [...weekdays, item('sun', '2026-12-06', '2026-12-06', 'approved')],
      '2026-12-01',
      '2026-12-07',
      new Set(),
      [],
    );
    expect(withSunday.kind).toBe('sent');
    const december = Array.from({ length: 31 }, (_, i) => {
      const date = `2026-12-${String(i + 1).padStart(2, '0')}`;
      return new Date(`${date}T00:00:00Z`).getUTCDay() === 0
        ? null
        : item(date, date, date, 'approved');
    }).filter((row): row is MonthItem => row !== null);
    const now = new Date('2026-11-22T10:00:00+05:30');
    expect(
      tpPunchGate({
        today: '2026-11-22',
        now,
        rank: 1,
        items: december,
        leaveDates: new Set(),
        weeklyOff: [],
      }).blocked,
    ).toBe(false);
  });

  it('refuses to mix a day that is already sent with drafts', () => {
    const view = monthView(
      [
        item('p', '2026-12-01', '2026-12-01', 'pending'),
        item('d', '2026-12-02', '2026-12-02', 'draft'),
      ],
      '2026-12-01',
      '2026-12-02',
      new Set(),
      [],
    );
    expect(view.kind).toBe('split');
  });

  it('blocks punch after the role day through month end, until next month is sent', () => {
    const now = new Date('2026-11-21T08:00:00+05:30');
    const open = tpPunchGate({
      today: '2026-11-21',
      now,
      rank: 1,
      items: [item('d', '2026-12-01', '2026-12-31', 'draft')],
      leaveDates: new Set(),
      weeklyOff: [0],
    });
    expect(open.blocked).toBe(true);
    expect(open.month).toBe('December 2026');

    const sent = tpPunchGate({
      today: '2026-11-30',
      now: new Date('2026-11-30T18:00:00+05:30'),
      rank: 1,
      items: [item('m', '2026-12-01', '2026-12-31', 'pending')],
      leaveDates: new Set(),
      weeklyOff: [0],
    });
    expect(sent.blocked).toBe(false);

    const early = tpPunchGate({
      today: '2026-11-20',
      now: new Date('2026-11-20T22:00:00+05:30'),
      rank: 1,
      items: [],
      leaveDates: new Set(),
      weeklyOff: [0],
    });
    expect(early.blocked).toBe(false);
    expect(tpDeadlinePassed('2026-11-20', new Date('2026-11-20T23:59:59.999+05:30'), 1)).toBe(
      false,
    );
  });

  it('reminds on the deadline day until the plan is sent, then waits eight hours', () => {
    const now = new Date('2026-11-20T10:00:00+05:30');
    const due = tpReminder({
      today: '2026-11-20',
      now,
      rank: 1,
      sent: false,
      lastDismissedAt: null,
    });
    expect(due?.body).toContain('20 November 2026, 11:59 pm');
    expect(
      tpReminder({ today: '2026-11-19', now, rank: 1, sent: false, lastDismissedAt: null }),
    ).toBeNull();
    expect(
      tpReminder({ today: '2026-11-20', now, rank: 1, sent: true, lastDismissedAt: null }),
    ).toBeNull();
    expect(
      tpReminder({
        today: '2026-11-21',
        now: new Date('2026-11-21T10:00:00+05:30'),
        rank: 1,
        sent: false,
        lastDismissedAt: new Date('2026-11-21T08:00:00+05:30').getTime(),
      }),
    ).toBeNull();
    const dismissed = new Date('2026-11-21T08:00:00+05:30').getTime();
    expect(
      tpReminder({
        today: '2026-11-21',
        now: new Date(dismissed + TP_REMINDER_GAP_MS + 1000),
        rank: 1,
        sent: false,
        lastDismissedAt: dismissed,
      })?.body,
    ).toContain('Punch in stays off');
  });
});
