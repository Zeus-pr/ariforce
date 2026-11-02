import { describe, expect, it } from 'vitest';
import {
  TourPlanItemUpsert,
  tpItemCard,
  tpItemDates,
  tpItemFiledDates,
} from '../src/schemas/tp-items';

const item = (from: string, to: string, status = 'approved') => ({ from, to, status });
const plan = { workTypeId: '01930000-0000-7000-8000-000000000001' };

describe('tpItemDates / tpItemFiledDates', () => {
  it('lists from..to across a month end', () => {
    expect(tpItemDates('2026-11-29', '2026-12-02')).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
  });
  it('counts submitted/approved reports in range only; drafts and rejected do not count', () => {
    expect(
      tpItemFiledDates('2026-11-02', '2026-11-05', [
        { date: '2026-11-01', status: 'approved' },
        { date: '2026-11-02', status: 'approved' },
        { date: '2026-11-03', status: 'submitted' },
        { date: '2026-11-04', status: 'rejected' },
        { date: '2026-11-05', status: 'draft' },
      ]),
    ).toEqual(['2026-11-02', '2026-11-03']);
  });
});

describe('tpItemCard', () => {
  it('only approved items make a card', () => {
    for (const s of ['draft', 'pending', 'rejected'])
      expect(tpItemCard(item('2026-11-02', '2026-11-04', s), [], '2026-11-02')).toBeNull();
  });
  it('one card for a range: today fileable, future days draft-only', () => {
    expect(tpItemCard(item('2026-11-02', '2026-11-04'), [], '2026-11-02')).toEqual({
      filedDates: [],
      pendingDates: ['2026-11-02', '2026-11-03', '2026-11-04'],
      draftDates: [],
      fileableDates: ['2026-11-02'],
    });
  });
  it('past unfiled days are not pending (locked); filed and draft days are tracked', () => {
    const c = tpItemCard(
      item('2026-11-02', '2026-11-05'),
      [
        { date: '2026-11-03', status: 'submitted' },
        { date: '2026-11-05', status: 'draft' },
      ],
      '2026-11-04',
    );
    expect(c).toEqual({
      filedDates: ['2026-11-03'],
      pendingDates: ['2026-11-04', '2026-11-05'],
      draftDates: ['2026-11-05'],
      fileableDates: ['2026-11-04'],
    });
  });
  it('hides when every day is filed', () => {
    expect(
      tpItemCard(
        item('2026-11-02', '2026-11-03'),
        [
          { date: '2026-11-02', status: 'approved' },
          { date: '2026-11-03', status: 'submitted' },
        ],
        '2026-11-02',
      ),
    ).toBeNull();
  });
  it('hides after the range ends (last day locked), even with unfiled days', () => {
    expect(tpItemCard(item('2026-11-02', '2026-11-03'), [], '2026-11-04')).toBeNull();
  });
  it('hides when only locked past days remain unfiled', () => {
    expect(
      tpItemCard(
        item('2026-11-02', '2026-11-04'),
        [{ date: '2026-11-04', status: 'submitted' }],
        '2026-11-04',
      ),
    ).toBeNull();
  });
  it('a rejected DCR reopens its day', () => {
    const c = tpItemCard(
      item('2026-11-02', '2026-11-02'),
      [{ date: '2026-11-02', status: 'rejected' }],
      '2026-11-02',
    );
    expect(c?.fileableDates).toEqual(['2026-11-02']);
  });
});

describe('TourPlanItemUpsert', () => {
  it('accepts one day and 31 days; rejects to < from and 32 days', () => {
    expect(
      TourPlanItemUpsert.safeParse({ from: '2026-11-02', to: '2026-11-02', plan }).success,
    ).toBe(true);
    expect(
      TourPlanItemUpsert.safeParse({ from: '2026-11-01', to: '2026-12-01', plan }).success,
    ).toBe(true);
    expect(
      TourPlanItemUpsert.safeParse({ from: '2026-11-03', to: '2026-11-02', plan }).success,
    ).toBe(false);
    expect(
      TourPlanItemUpsert.safeParse({ from: '2026-11-01', to: '2026-12-02', plan }).success,
    ).toBe(false);
  });
  it('defaults plan lists and details', () => {
    const r = TourPlanItemUpsert.parse({ from: '2026-11-02', to: '2026-11-02', plan });
    expect(r.plan).toEqual({
      ...plan,
      territoryIds: [],
      workWithUserIds: [],
      sfcRoutes: [],
      details: null,
    });
  });
});
