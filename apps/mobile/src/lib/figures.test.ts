/// <reference types="jest" />
import {
  callMix,
  filedDates,
  gapBars,
  monthMarks,
  rankBars,
  ringModel,
  salesRings,
} from '@/lib/figures';

const fmt = (unit: 'count' | 'ratio' | 'percent' | 'inr', value: number | null) =>
  value == null ? '—' : unit === 'inr' ? `₹${value}` : String(value);

describe('rings and ranks', () => {
  it('puts doctors seen over the list under the coverage ring', () => {
    const ring = ringModel(
      ['coverage_pct', 'unique_doctors_seen', 'msl_size'],
      [
        { kpi: 'coverage_pct', value: 40, unit: 'percent' },
        { kpi: 'unique_doctors_seen', value: 82, unit: 'count' },
        { kpi: 'msl_size', value: 200, unit: 'count' },
      ],
      fmt,
    );
    expect(ring).toEqual({ title: 'Coverage', percent: 40, caption: '82 of 200 doctors' });
  });

  it('draws a primary ring beside secondary', () => {
    const rings = salesRings(
      [
        { kpi: 'primary_achievement_pct', value: 50, unit: 'percent' },
        { kpi: 'primary_sales_value', value: 10, unit: 'inr', target: 20 },
        { kpi: 'secondary_achievement_pct', value: null, unit: 'percent' },
        { kpi: 'secondary_sales_value', value: 0, unit: 'inr' },
      ],
      fmt,
    );
    expect(rings.map((r) => r.title)).toEqual(['Primary', 'Secondary']);
    expect(rings[0]).toMatchObject({ percent: 50, caption: '₹10 of ₹20' });
    expect(rings[1]).toMatchObject({ percent: null, caption: '₹0' });
  });

  it('draws percent bars out of 100 and marks the leader', () => {
    const bars = rankBars(
      [
        { id: 'a', label: 'Anita', metrics: [{ kpi: 'coverage_pct', value: 80, unit: 'percent' }] },
        { id: 'b', label: 'Ravi', metrics: [{ kpi: 'coverage_pct', value: 40, unit: 'percent' }] },
      ],
      'coverage_pct',
      fmt,
    );
    expect(bars[0]).toMatchObject({ label: 'Anita', share: 0.8, lead: true });
    expect(bars[1]).toMatchObject({ label: 'Ravi', share: 0.4, lead: false });
  });

  it('picks the person furthest behind', () => {
    const gaps = gapBars(
      [
        { id: 'a', label: 'Anita', metrics: [{ kpi: 'coverage_pct', value: 80, unit: 'percent' }] },
        { id: 'b', label: 'Ravi', metrics: [{ kpi: 'coverage_pct', value: 20, unit: 'percent' }] },
      ],
      ['coverage_pct'],
      fmt,
    );
    expect(gaps[0]).toMatchObject({ name: 'Ravi', share: 0.8 });
  });
});

describe('calls and the month strip', () => {
  it('counts filed calls and ignores a draft', () => {
    const mix = callMix([
      {
        status: 'submitted',
        calls: [
          { outletKind: 'doctor', samples: [{}], pob: [] },
          { outletKind: 'chemist', samples: [], pob: [{}] },
        ],
      },
      { status: 'draft', calls: [{ outletKind: 'stockist', samples: [], pob: [] }] },
    ]);
    expect(mix.slices.map((s) => s.count)).toEqual([1, 1, 0]);
    expect(mix.samples).toBe(1);
    expect(mix.orders).toBe(1);
    expect(mix.quiet).toBe(0);
  });

  it('leaves Sunday blank and skips days still ahead', () => {
    const marks = monthMarks(
      '2026-11',
      '2026-11-02',
      filedDates([{ status: 'approved', date: '2026-11-02' }]),
    );
    const byDay = Object.fromEntries(marks.map((m) => [m.day, m.mark]));
    expect(byDay['2026-11-01']).toBe('rest');
    expect(byDay['2026-11-02']).toBe('filed');
    expect(byDay['2026-11-03']).toBe('ahead');
  });
});
