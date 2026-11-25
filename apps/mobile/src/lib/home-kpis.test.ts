/// <reference types="jest" />
import { homeKpiCards } from '@/lib/home-kpis';

describe('home KPI cards', () => {
  it('uses the live coverage list instead of a sample percent', () => {
    const cards = homeKpiCards([
      {
        kpi: 'call_average',
        value: 4.5,
        numerator: 9,
        denominator: 2,
        unit: 'ratio',
        target: null,
      },
      {
        kpi: 'coverage_pct',
        value: 0,
        numerator: 0,
        denominator: 80,
        unit: 'percent',
        target: null,
      },
      {
        kpi: 'unique_doctors_seen',
        value: 0,
        numerator: 0,
        denominator: null,
        unit: 'count',
        target: null,
      },
      { kpi: 'msl_size', value: 80, numerator: 80, denominator: null, unit: 'count', target: null },
      {
        kpi: 'chemist_call_average',
        value: null,
        numerator: 0,
        denominator: 0,
        unit: 'ratio',
        target: null,
      },
      {
        kpi: 'dcr_on_time_pct',
        value: null,
        numerator: 0,
        denominator: 0,
        unit: 'percent',
        target: null,
      },
    ]);
    const coverage = cards.find((c) => c.key === 'coverage_pct');
    expect(coverage).toMatchObject({ value: '0%', target: '0 of 80 doctors', progress: 0 });
    expect(cards.find((c) => c.key === 'call_average')?.value).toBe('4.5');
    expect(cards.find((c) => c.key === 'call_average')?.progress).toBeNull();
  });
});
