import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument, createApiClient, ROLE_KEYS, ROLE_RANK } from '../src';
import { createHandlers, fixtures as fx } from '../src/mocks';

const BASE = 'http://gaps.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
let api: ReturnType<typeof createApiClient>;
beforeAll(() => {
  api = createApiClient(BASE);
});
const uuid = () => crypto.randomUUID();

describe('contract gaps', () => {
  it('has the 8-level hierarchy plus system_admin', () => {
    expect(ROLE_KEYS).toHaveLength(9);
    expect(ROLE_RANK.business_manager).toBe(1);
    expect(ROLE_RANK.director).toBe(8);
    expect(ROLE_RANK.system_admin).toBe(0);
  });

  it('documents the new paths', () => {
    const doc = buildOpenApiDocument();
    for (const p of [
      '/v1/doctors/import',
      '/v1/check-ins',
      '/v1/attendance',
      '/v1/tour-plans/{month}',
      '/v1/dcrs',
      '/v1/approvals/{id}/decision',
      '/v1/products',
      '/v1/work-types',
      '/v1/settings/geofence',
      '/v1/me/consent',
    ])
      expect(doc.paths).toHaveProperty([p]);
  });

  it('list honours q, sort, cursor and total', async () => {
    const all = await api.GET('/v1/territories', {
      params: { query: { limit: 2, includeTotal: 'true', sort: 'code' } },
    });
    expect(all.data!.total).toBe(fx.territories.length);
    expect(all.data!.items).toHaveLength(2);
    const next = await api.GET('/v1/territories', {
      params: { query: { limit: 2, sort: 'code', cursor: all.data!.nextCursor! } },
    });
    expect(next.data!.items[0]!.id).not.toBe(all.data!.items[0]!.id);
    const q = await api.GET('/v1/territories', { params: { query: { q: 'east' } } });
    expect(q.data!.items.every((t) => t.name.toLowerCase().includes('east'))).toBe(true);
    const bad = await api.GET('/v1/doctors', {
      params: { query: { territoryId: fx.territories[0]!.id } },
    });
    expect(bad.data!.items.length).toBe(fx.doctors.length);
  });

  it('import dry-run reports per-row results and duplicates, then applies', async () => {
    const d = fx.doctors[0]!;
    const fresh = {
      territoryId: d.territoryId,
      name: 'Dr. New',
      qualification: null,
      specialtyId: null,
      categoryId: null,
      registrationNo: 'WB-99999',
      addressLine: null,
      city: 'Kolkata',
      state: null,
      pincode: '700001',
      location: null,
      phone: null,
    };
    const rows = [
      fresh,
      { ...fresh, registrationNo: d.registrationNo, name: 'x' },
      { name: '' },
      { ...fresh },
    ];
    const dry = await api.POST('/v1/doctors/import', {
      body: { dryRun: true, onDuplicate: 'skip', rows },
    });
    expect(dry.response.status).toBe(200);
    const st = dry.data!.results.map((r) => r.status);
    expect(st[0]).toBe('valid');
    expect(st[2]).toBe('error');
    expect(dry.data!.results[3]!.duplicateRule).toBe('in_file');
    if (d.registrationNo) expect(st[1]).toBe('duplicate');
    const real = await api.POST('/v1/doctors/import', {
      body: { dryRun: false, onDuplicate: 'skip', rows: [fresh] },
    });
    expect(real.response.status).toBe(201);
    expect(real.data!.totals.created).toBe(1);
  });

  it('check-in sequence, DCR with detailing/samples/POB, TP approval', async () => {
    const loc = {
      location: { lat: 22.57, lng: 88.36 },
      accuracyM: 12,
      capturedAt: new Date().toISOString(),
      isMock: false,
    };
    const early = await api.POST('/v1/check-ins', {
      body: {
        clientId: uuid(),
        kind: 'visit',
        outletKind: 'doctor',
        outletId: fx.doctors[0]!.id,
        ...loc,
      },
    });
    expect(early.response.status).toBe(409);
    expect(
      (await api.POST('/v1/check-ins', { body: { clientId: uuid(), kind: 'punch_in', ...loc } }))
        .response.status,
    ).toBe(201);
    const visit = await api.POST('/v1/check-ins', {
      body: {
        clientId: uuid(),
        kind: 'visit',
        outletKind: 'doctor',
        outletId: fx.doctors[0]!.id,
        ...loc,
      },
    });
    expect(visit.response.status).toBe(201);
    const att = await api.GET('/v1/attendance', {});
    expect(att.data!.items[0]!.visits).toBe(1);

    const dcr = await api.PUT('/v1/dcrs', {
      body: {
        date: visit.data!.date,
        workTypeId: fx.workTypes[0]!.id,
        territoryIds: [fx.doctors[0]!.territoryId],
        submit: true,
        calls: [
          {
            clientId: uuid(),
            outletKind: 'doctor',
            outletId: fx.doctors[0]!.id,
            checkInId: visit.data!.id,
            jointWorkUserIds: [],
            productsDetailed: [{ productId: fx.products[0]!.id, order: 1 }],
            samples: [{ productId: fx.products[0]!.id, quantity: 2 }],
            pob: [{ productId: fx.products[1]!.id, quantity: 10 }],
            remarks: null,
            calledAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(dcr.data!.status).toBe('submitted');
    expect(dcr.data!.calls[0]!.samples[0]!.quantity).toBe(2);

    await api.PUT('/v1/tour-plans/{month}', {
      params: { path: { month: '2026-11' } },
      body: { days: [] },
    });
    await api.POST('/v1/tour-plans/{month}/submit', { params: { path: { month: '2026-11' } } });
    const pend = await api.GET('/v1/approvals', {
      params: { query: { status: 'pending', subjectType: 'tour_plan' } },
    });
    const mine = pend.data!.items.find((a) => a.summary === 'Tour plan 2026-11')!;
    const noComment = await api.POST('/v1/approvals/{id}/decision', {
      params: { path: { id: mine.id } },
      body: { decision: 'reject' },
    });
    expect(noComment.response.status).toBe(422);
    const ok = await api.POST('/v1/approvals/{id}/decision', {
      params: { path: { id: mine.id } },
      body: { decision: 'approve' },
    });
    expect(ok.data!.status).toBe('approved');
    const tp = await api.GET('/v1/tour-plans/{month}', { params: { path: { month: '2026-11' } } });
    expect(tp.data!.status).toBe('approved');
  });
});
