/**
 * MSW handlers generated from the contracts, so apps/web can be built before the API is done.
 * Browser: `setupWorker(...createHandlers(baseUrl)).start()`; Node/tests: `setupServer(...)`.
 * Every response is parsed through the zod schema, so mocks can never drift from the contract.
 */
import { http, HttpResponse } from 'msw';
import * as z from 'zod';
import {
  Chemist,
  ChemistCreate,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  Me,
  Role,
  Specialty,
  Stockist,
  StockistCreate,
  Territory,
} from '../index';
import * as fx from './fixtures';

export { fx as fixtures };

const serverTime = () => new Date().toISOString();
const notFound = () =>
  HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });

function list<T extends { id: string; updatedAt: string }>(
  schema: z.ZodType<T>,
  rows: T[],
  url: URL,
) {
  const since = url.searchParams.get('updatedSince');
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const items = rows.filter((r) => !since || r.updatedAt > since).slice(0, limit);
  return HttpResponse.json({
    items: z.array(schema).parse(items),
    nextCursor: null,
    serverTime: serverTime(),
  });
}

function crud<
  T extends { id: string; updatedAt: string; version: number; deletedAt: string | null },
>(baseUrl: string, path: string, schema: z.ZodType<T>, createSchema: z.ZodType, seed: T[]) {
  const rows = structuredClone(seed);
  return [
    http.get(`${baseUrl}${path}`, ({ request }) => list(schema, rows, new URL(request.url))),
    http.get(`${baseUrl}${path}/:id`, ({ params }) => {
      const row = rows.find((r) => r.id === params.id);
      return row ? HttpResponse.json(schema.parse(row)) : notFound();
    }),
    http.post(`${baseUrl}${path}`, async ({ request }) => {
      const body = createSchema.safeParse(await request.json());
      if (!body.success)
        return HttpResponse.json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Invalid body',
              details: z.treeifyError(body.error),
            },
          },
          { status: 422 },
        );
      const ts = serverTime();
      const row = {
        ...(body.data as object),
        id: crypto.randomUUID(),
        companyId: fx.COMPANY_ID,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
        version: 1,
      } as unknown as T;
      rows.push(row);
      return HttpResponse.json(schema.parse(row), { status: 201 });
    }),
    http.patch(`${baseUrl}${path}/:id`, async ({ params, request }) => {
      const i = rows.findIndex((r) => r.id === params.id);
      if (i < 0) return notFound();
      const patch = (await request.json()) as Partial<T> & { version: number };
      if (patch.version !== rows[i]!.version)
        return HttpResponse.json(
          { error: { code: 'VERSION_CONFLICT', message: 'Stale version' } },
          { status: 409 },
        );
      rows[i] = { ...rows[i]!, ...patch, version: rows[i]!.version + 1, updatedAt: serverTime() };
      return HttpResponse.json(schema.parse(rows[i]));
    }),
    http.delete(`${baseUrl}${path}/:id`, ({ params }) => {
      const row = rows.find((r) => r.id === params.id);
      if (!row) return notFound();
      row.deletedAt = row.updatedAt = serverTime();
      row.version += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

export function createHandlers(baseUrl = '') {
  return [
    http.get(`${baseUrl}/v1/health`, () => HttpResponse.json({ status: 'ok' })),
    http.post(`${baseUrl}/v1/files/upload-url`, () =>
      HttpResponse.json({
        fileKey: 'mock/doctor_photo/2026/10/mock.jpg',
        uploadUrl: 'https://mock-r2.invalid/upload',
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ),
    http.post(`${baseUrl}/v1/files/download-url`, () =>
      HttpResponse.json({
        downloadUrl: 'https://mock-r2.invalid/download',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
    http.post(`${baseUrl}/v1/auth/sign-in/email`, () =>
      HttpResponse.json({
        token: 'mock-token',
        user: { id: fx.me.id, email: fx.me.email, name: fx.me.name },
      }),
    ),
    http.post(`${baseUrl}/v1/auth/sign-out`, () => HttpResponse.json({ success: true })),
    http.get(`${baseUrl}/v1/auth/get-session`, () =>
      HttpResponse.json({
        session: { id: 'mock-session', expiresAt: new Date(Date.now() + 864e5).toISOString() },
        user: { id: fx.me.id, email: fx.me.email, name: fx.me.name },
      }),
    ),
    http.get(`${baseUrl}/v1/me`, () => HttpResponse.json(Me.parse(fx.me))),
    http.get(`${baseUrl}/v1/roles`, () =>
      HttpResponse.json({ items: z.array(Role).parse(fx.roles) }),
    ),
    http.get(`${baseUrl}/v1/territories`, ({ request }) =>
      list(Territory, fx.territories, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/territories/:id`, ({ params }) => {
      const t = fx.territories.find((r) => r.id === params.id);
      return t ? HttpResponse.json(Territory.parse(t)) : notFound();
    }),
    http.get(`${baseUrl}/v1/specialties`, ({ request }) =>
      list(Specialty, fx.specialties, new URL(request.url)),
    ),
    http.get(`${baseUrl}/v1/doctor-categories`, ({ request }) =>
      list(DoctorCategory, fx.doctorCategories, new URL(request.url)),
    ),
    ...crud(baseUrl, '/v1/doctors', Doctor, DoctorCreate, fx.doctors),
    ...crud(baseUrl, '/v1/chemists', Chemist, ChemistCreate, fx.chemists),
    ...crud(baseUrl, '/v1/stockists', Stockist, StockistCreate, fx.stockists),
  ];
}
