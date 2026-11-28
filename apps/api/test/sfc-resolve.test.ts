import { describe, expect, it } from 'vitest';
import { resolveSfcCandidates, type SfcRouteLike } from '../src/dcr/sfc-resolve';

const ME = 'me';
let n = 0;
const route = (o: Partial<SfcRouteLike>): SfcRouteLike => ({
  id: `r${String(++n).padStart(2, '0')}`,
  userId: ME,
  hqTerritoryId: 'hq-a',
  category: 'ex',
  fromPlace: 'BURDWAN',
  toPlace: 'KATWA',
  sortOrder: 1,
  createdAt: '2026-10-01T00:00:00Z',
  ...o,
});
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe('resolveSfcCandidates (one chart per person)', () => {
  it('returns only that person, in the band, in chart order', () => {
    const later = route({ toPlace: 'KATWA', sortOrder: 2 });
    const first = route({ toPlace: 'KANDRA', sortOrder: 1 });
    const hqDay = route({ toPlace: 'BURDWAN', category: 'hq' });
    const theirs = route({ userId: 'other', sortOrder: 0 });
    const out = resolveSfcCandidates([theirs, later, hqDay, first], ME, 'ex_hq');
    expect(ids(out)).toEqual([first.id, later.id]);
    expect(out.every((r) => r.source === 'own')).toBe(true);
  });

  it('keeps a route whose stored headquarters is not the day', () => {
    const mine = route({ hqTerritoryId: 'somewhere-else' });
    expect(ids(resolveSfcCandidates([mine], ME, 'ex_hq'))).toEqual([mine.id]);
  });

  it('returns nothing when the person has no route in the band', () => {
    const hqOnly = route({ category: 'hq' });
    expect(resolveSfcCandidates([hqOnly], ME, 'ex_hq')).toEqual([]);
  });

  it('lists one journey once when it was filed under two headquarters', () => {
    const suri = route({
      hqTerritoryId: 'suri',
      fromPlace: 'Burdwan',
      toPlace: 'Sial Bolpur',
      oneWayKm: 10,
      bothWayAmount: 59,
      da: 150,
    });
    const bmch = route({
      hqTerritoryId: 'burdwan-bmch',
      fromPlace: 'BURDWAN',
      toPlace: 'sial-bolpur',
      oneWayKm: '10.00',
      bothWayAmount: '59.00',
      da: '150',
      sortOrder: 2,
    });
    const differentFare = route({
      hqTerritoryId: 'burdwan-bmch',
      fromPlace: 'Burdwan',
      toPlace: 'Sial Bolpur',
      oneWayKm: 12,
      bothWayAmount: 80,
      da: 150,
      sortOrder: 3,
    });
    const out = resolveSfcCandidates([bmch, differentFare, suri], ME, 'ex_hq');
    expect(ids(out)).toEqual([suri.id, differentFare.id]);
  });
});
