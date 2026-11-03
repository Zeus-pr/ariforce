import { describe, expect, it } from 'vitest';
import { resolveSfcCandidates, type SfcRouteLike } from '../src/dcr/sfc-resolve';

const HQ_A = 'hq-a';
const HQ_B = 'hq-b';
const ME = 'me';
let n = 0;
const route = (o: Partial<SfcRouteLike>): SfcRouteLike => ({
  id: `r${String(++n).padStart(2, '0')}`,
  userId: 'rep1',
  hqTerritoryId: HQ_A,
  category: 'ex',
  fromPlace: 'BURDWAN',
  toPlace: 'KATWA',
  sortOrder: 1,
  createdAt: '2026-10-01T00:00:00Z',
  ...o,
});
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe('resolveSfcCandidates (DCR SFC: own routes, else HQ fallback)', () => {
  it('falls back to the HQ routes of any owner when the filer has none there', () => {
    const katwa = route({ toPlace: 'KATWA' });
    const kandra = route({ fromPlace: 'KANDRA', toPlace: 'KATWA', sortOrder: 6 });
    const hqDay = route({ toPlace: 'BURDWAN', category: 'hq' });
    const meeting = route({ toPlace: 'KOLKATA', category: 'MEETING' });
    const out = resolveSfcCandidates([meeting, kandra, hqDay, katwa], ME, [HQ_A], 'ex_hq');
    expect(ids(out)).toEqual([katwa.id, kandra.id]);
    expect(out.every((r) => r.source === 'hq')).toBe(true);
  });

  it('own routes win on that HQ (even if none is in the band)', () => {
    const mine = route({ userId: ME, sortOrder: 5 });
    const theirs = route({ sortOrder: 1 });
    expect(resolveSfcCandidates([theirs, mine], ME, [HQ_A], 'ex_hq')).toEqual([
      { ...mine, source: 'own' },
    ]);
    const mineHqOnly = route({ userId: ME, category: 'hq' });
    expect(resolveSfcCandidates([theirs, mineHqOnly], ME, [HQ_A], 'ex_hq')).toEqual([]);
  });

  it('decides per HQ on a multi-HQ day', () => {
    const mineA = route({ userId: ME, hqTerritoryId: HQ_A });
    const otherA = route({ hqTerritoryId: HQ_A, toPlace: 'SALAR' });
    const otherB = route({ hqTerritoryId: HQ_B, toPlace: 'KALNA' });
    const out = resolveSfcCandidates([otherB, otherA, mineA], ME, [HQ_B, HQ_A], 'ex_hq');
    expect(out.map((r) => [r.id, r.source])).toEqual([
      [otherB.id, 'hq'],
      [mineA.id, 'own'],
    ]);
  });

  it('de-duplicates fallback routes on normalised from/to/category with a stable winner', () => {
    const late = route({ userId: 'rep2', sortOrder: 2, createdAt: '2026-10-02T00:00:00Z' });
    const early = route({ userId: 'rep3', sortOrder: 2, createdAt: '2026-10-01T00:00:00Z' });
    const spaced = route({ userId: 'rep4', fromPlace: 'Burdwan ', toPlace: 'katwa', sortOrder: 2 });
    const low = route({ userId: 'rep5', fromPlace: 'B-U-R-D-W-A-N', sortOrder: 9 });
    const reverse = route({ fromPlace: 'KATWA', toPlace: 'BURDWAN', sortOrder: 3 });
    const os = route({ category: 'os', sortOrder: 1 });
    const rows = [late, low, reverse, spaced, early, os];
    const out = resolveSfcCandidates(rows, ME, [HQ_A], 'ex_hq');
    // early and spaced tie on sort_order + created_at: lowest id wins (early was created first here).
    const winner = [early, spaced].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
    expect(ids(out)).toEqual([winner.id, reverse.id]);
    expect(ids(resolveSfcCandidates([...rows].reverse(), ME, [HQ_A], 'ex_hq'))).toEqual(ids(out));
    expect(ids(resolveSfcCandidates(rows, ME, [HQ_A], 'outstation'))).toEqual([os.id]);
  });

  it('returns nothing for HQs without routes', () => {
    expect(resolveSfcCandidates([route({})], ME, [HQ_B], 'ex_hq')).toEqual([]);
  });
});
