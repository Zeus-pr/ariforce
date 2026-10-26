import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KPI_KEYS, buildOpenApiDocument, createApiClient } from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://kpis.test';
const server = setupServer(...createHandlers(BASE));
let api: ReturnType<typeof createApiClient>;
beforeAll(() => {
  server.listen();
  api = createApiClient(BASE);
});
afterAll(() => server.close());

describe('KPIs', () => {
  it('documents the KPI paths', () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths).toHaveProperty(['/v1/kpis']);
    expect(doc.paths).toHaveProperty(['/v1/kpis/products']);
  });

  it('returns all KPIs for a month with numerator/denominator', async () => {
    const { data, error } = await api.GET('/v1/kpis', { params: { query: { month: '2026-11' } } });
    expect(error).toBeUndefined();
    expect(data!.from).toBe('2026-11-01');
    expect(data!.to).toBe('2026-11-30');
    expect(data!.rows).toHaveLength(1);
    expect(data!.rows[0]!.metrics.map((m) => m.kpi)).toEqual([...KPI_KEYS]);
    const ca = data!.rows[0]!.metrics.find((m) => m.kpi === 'call_average')!;
    expect(ca.unit).toBe('ratio');
    expect(ca.value).toBeCloseTo(ca.numerator! / ca.denominator!, 1);
  });

  it('filters KPI keys and rolls up by user', async () => {
    const { data } = await api.GET('/v1/kpis', {
      params: {
        query: {
          month: '2026-11',
          rollup: 'byUser',
          kpis: ['coverage_pct', 'call_average'] as never,
        },
      },
      querySerializer: { array: { style: 'form', explode: false } },
    });
    expect(data!.rows.length).toBeGreaterThan(1);
    expect(data!.rows[0]!.metrics.map((m) => m.kpi)).toEqual(['coverage_pct', 'call_average']);
  });

  it('rejects month together with from/to', async () => {
    const { response } = await api.GET('/v1/kpis', {
      params: { query: { month: '2026-11', from: '2026-11-01' } },
    });
    expect(response.status).toBe(422);
  });

  it('returns product-wise detailing', async () => {
    const { data } = await api.GET('/v1/kpis/products', {
      params: { query: { month: '2026-11' } },
    });
    expect(data!.rows.length).toBeGreaterThan(0);
    expect(data!.rows[0]).toHaveProperty('firstPositionCalls');
  });
});
