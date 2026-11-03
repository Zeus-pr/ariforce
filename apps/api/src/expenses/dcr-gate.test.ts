import { describe, expect, it } from 'vitest';
import { dcrApprovalGap } from './dcr-gate';

const t = (s: number) => new Date(1_800_000_000_000 + s * 1000);
describe('dcrApprovalGap (expense needs approved DCRs)', () => {
  it('passes when every date has an approved DCR (other reports of the day ignored)', () => {
    expect(
      dcrApprovalGap(
        ['2026-11-02', '2026-11-03', '2026-11-02'],
        [
          { id: 'a', date: '2026-11-02', status: 'approved', updatedAt: t(1) },
          { id: 'b', date: '2026-11-02', status: 'rejected', updatedAt: t(2) },
          { id: 'c', date: '2026-11-03', status: 'approved', updatedAt: t(1) },
        ],
      ),
    ).toBeNull();
  });
  it('lists every unapproved date with its best report; rejected does not count', () => {
    expect(
      dcrApprovalGap(
        ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'],
        [
          { id: 'a', date: '2026-11-02', status: 'approved', updatedAt: t(1) },
          { id: 'r', date: '2026-11-03', status: 'rejected', updatedAt: t(1) },
          { id: 's', date: '2026-11-03', status: 'submitted', updatedAt: t(0) },
          { id: 'd', date: '2026-11-04', status: 'draft', updatedAt: t(1) },
          { id: 'x', date: '2026-11-05', status: 'rejected', updatedAt: t(1) },
        ],
      ),
    ).toEqual({
      dates: ['2026-11-03', '2026-11-04', '2026-11-05'],
      dcrIds: ['s', 'd', 'x'],
      dcrStatus: { '2026-11-03': 'submitted', '2026-11-04': 'draft', '2026-11-05': 'rejected' },
    });
  });
  it('a date with no report is missing', () => {
    expect(dcrApprovalGap(['2026-11-06'], [])).toEqual({
      dates: ['2026-11-06'],
      dcrIds: [],
      dcrStatus: { '2026-11-06': 'missing' },
    });
  });
  it('no lines, no gate', () => {
    expect(dcrApprovalGap([], [])).toBeNull();
  });
});
