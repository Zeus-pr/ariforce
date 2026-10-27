import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Doctor,
  DoctorCreate,
  DoctorDuplicateCheck,
  DoctorDuplicateResult,
  DoctorUpdate,
} from '../src';
import { createHandlers } from '../src/mocks';
import * as fx from '../src/mocks/fixtures';

const BASE = 'http://doctors.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const seed = fx.doctors[0]!;
const body = (over: Record<string, unknown> = {}) => ({
  territoryId: seed.territoryId,
  name: 'Dr. New Mock',
  qualification: null,
  specialtyId: null,
  categoryId: null,
  registrationNo: null,
  addressLine: null,
  city: null,
  state: null,
  pincode: '700001',
  location: null,
  phone: null,
  ...over,
});

describe('doctor approval + duplicates (#26)', () => {
  it('schemas: approvalStatus is read-only, override flag only on create', () => {
    expect(Doctor.shape.approvalStatus.options).toEqual(['pending', 'approved', 'rejected']);
    expect('approvalStatus' in DoctorCreate.shape).toBe(false);
    expect('allowPossibleDuplicate' in DoctorUpdate.shape).toBe(false);
    expect(DoctorCreate.parse(body({ allowPossibleDuplicate: true })).allowPossibleDuplicate).toBe(
      true,
    );
    expect(DoctorDuplicateCheck.safeParse({ name: 'x', pincode: '0123' }).success).toBe(false);
  });

  it('mock: rbm adds pending, director approved; registration no. blocks; name+pincode warns', async () => {
    const r = await call('rbm', 'POST', '/v1/doctors', body());
    expect(r.status).toBe(201);
    const d = Doctor.parse(await r.json());
    expect(d.approvalStatus).toBe('pending');
    const dir = await call(
      'director',
      'POST',
      '/v1/doctors',
      body({ name: 'Dr. Other', pincode: null }),
    );
    expect(Doctor.parse(await dir.json()).approvalStatus).toBe('approved');

    const reg = await call(
      'director',
      'POST',
      '/v1/doctors',
      body({
        name: 'X',
        registrationNo: seed.registrationNo!.toLowerCase(),
        allowPossibleDuplicate: true,
      }),
    );
    expect(reg.status).toBe(409);
    const regBody = (await reg.json()) as {
      error: { code: string; details: { matches: unknown[] } };
    };
    expect(regBody.error.code).toBe('DOCTOR_DUPLICATE');
    expect(DoctorDuplicateResult.parse(regBody.error.details).matches[0]).toMatchObject({
      id: seed.id,
      rule: 'registration_no',
    });

    const soft = await call('rbm', 'POST', '/v1/doctors', body({ name: 'new mock' }));
    expect(soft.status).toBe(409);
    expect(((await soft.json()) as { error: { code: string } }).error.code).toBe(
      'DOCTOR_POSSIBLE_DUPLICATE',
    );
    const ok = await call(
      'rbm',
      'POST',
      '/v1/doctors',
      body({ name: 'new mock', allowPossibleDuplicate: true }),
    );
    expect(ok.status).toBe(201);
  });

  it('mock: duplicate-check sees created rows', async () => {
    const r = await call('bm', 'POST', '/v1/doctors/duplicate-check', {
      name: 'Dr New Mock',
      pincode: '700001',
    });
    expect(r.status).toBe(200);
    const res = DoctorDuplicateResult.parse(await r.json());
    expect(res.matches.length).toBeGreaterThanOrEqual(2);
    expect(res.matches.every((m) => m.rule === 'name_pincode')).toBe(true);
    const bad = await call('bm', 'POST', '/v1/doctors/duplicate-check', { pincode: '1' });
    expect(bad.status).toBe(422);
  });
});
