import { describe, expect, it } from 'vitest';
import { tourPlanDraftCards, type TpCardDay } from '../src/tour-plan';

const A = [{ workTypeId: 'wt1', territoryIds: ['t1'] }];
const B = [{ workTypeId: 'wt2', territoryIds: ['t2'] }];
const day = (
  date: string,
  entries = A,
  status = 'approved',
  submissionId: string | null = 's1',
): TpCardDay<(typeof A)[number]> => ({ date, entries, status, submissionId });
const plan = (days: TpCardDay<(typeof A)[number]>[]) => [{ tourPlanId: 'tp1', days }];

describe('tourPlanDraftCards', () => {
  it('groups a consecutive approved range with identical entries into one card', () => {
    const cards = tourPlanDraftCards(
      plan([day('2026-11-03'), day('2026-11-02'), day('2026-11-04')]),
      [],
      '2026-11-02',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      from: '2026-11-02',
      to: '2026-11-04',
      pendingDates: ['2026-11-02', '2026-11-03', '2026-11-04'],
      fileableDates: ['2026-11-02'],
      filedDates: [],
    });
  });
  it('splits on gaps, different entries and different submissions; single day is its own card', () => {
    const cards = tourPlanDraftCards(
      plan([
        day('2026-11-02'),
        day('2026-11-04'),
        day('2026-11-05', B),
        day('2026-11-06', B, 'approved', 's2'),
      ]),
      [],
      '2026-11-01',
    );
    expect(cards.map((c) => [c.from, c.to])).toEqual([
      ['2026-11-02', '2026-11-02'],
      ['2026-11-04', '2026-11-04'],
      ['2026-11-05', '2026-11-05'],
      ['2026-11-06', '2026-11-06'],
    ]);
  });
  it('hides rejected, pending-approval and draft TP days', () => {
    const cards = tourPlanDraftCards(
      plan([
        day('2026-11-02', A, 'rejected'),
        day('2026-11-03', A, 'submitted'),
        day('2026-11-04', A, 'draft'),
      ]),
      [],
      '2026-11-01',
    );
    expect(cards).toEqual([]);
  });
  it('counts submitted/approved DCRs as filed, not drafts or rejected', () => {
    const [c] = tourPlanDraftCards(
      plan([day('2026-11-02'), day('2026-11-03'), day('2026-11-04'), day('2026-11-05')]),
      [
        { date: '2026-11-02', status: 'approved' },
        { date: '2026-11-03', status: 'submitted' },
        { date: '2026-11-04', status: 'rejected' },
        { date: '2026-11-05', status: 'draft' },
      ],
      '2026-11-04',
    );
    expect(c!.filedDates).toEqual(['2026-11-02', '2026-11-03']);
    expect(c!.pendingDates).toEqual(['2026-11-04', '2026-11-05']);
    expect(c!.draftDates).toEqual(['2026-11-05']);
    expect(c!.fileableDates).toEqual(['2026-11-04']);
  });
  it('hides the card once every day is filed', () => {
    const cards = tourPlanDraftCards(
      plan([day('2026-11-02'), day('2026-11-03')]),
      [
        { date: '2026-11-02', status: 'submitted' },
        { date: '2026-11-03', status: 'approved' },
      ],
      '2026-11-02',
    );
    expect(cards).toEqual([]);
  });
  it('hides the card once the last pending day is locked (before today), keeps it while one is today', () => {
    const p = plan([day('2026-11-02'), day('2026-11-03')]);
    expect(tourPlanDraftCards(p, [], '2026-11-04')).toEqual([]);
    const [c] = tourPlanDraftCards(p, [], '2026-11-03');
    expect(c!.pendingDates).toEqual(['2026-11-02', '2026-11-03']);
    expect(c!.fileableDates).toEqual(['2026-11-03']);
  });
  it('future-only card has no fileable dates', () => {
    const [c] = tourPlanDraftCards(plan([day('2026-11-10')]), [], '2026-11-02');
    expect(c!.fileableDates).toEqual([]);
  });
});
