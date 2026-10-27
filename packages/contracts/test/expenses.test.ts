/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  EXPENSE_MAX_FILE_BYTES,
  ExpenseAttachmentCreate,
  ExpenseDecision,
  ExpenseLineInput,
  fileExt,
} from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://expenses.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const line = (o: Record<string, unknown> = {}) => ({
  date: '2026-09-10',
  category: 'food',
  amount: 250.5,
  notes: null,
  mileageKm: null,
  dcrId: null,
  tourPlanId: null,
  ...o,
});

describe('expense contracts', () => {
  it('line rules: mileage needs km and only mileage; 2 decimals', () => {
    expect(ExpenseLineInput.safeParse(line()).success).toBe(true);
    expect(ExpenseLineInput.safeParse(line({ category: 'mileage' })).success).toBe(false);
    expect(ExpenseLineInput.safeParse(line({ category: 'mileage', mileageKm: 12 })).success).toBe(
      true,
    );
    expect(ExpenseLineInput.safeParse(line({ mileageKm: 3 })).success).toBe(false);
    expect(ExpenseLineInput.safeParse(line({ amount: 1.234 })).success).toBe(false);
    expect(ExpenseLineInput.safeParse(line({ amount: 0 })).success).toBe(false);
  });

  it('attachment allow-list: type, extension and size', () => {
    const a = { fileName: 'r.JPG', contentType: 'image/jpeg', sizeBytes: 1000 };
    expect(fileExt('a.b.HEIC')).toBe('heic');
    expect(ExpenseAttachmentCreate.safeParse(a).success).toBe(true);
    for (const [fileName, contentType] of [
      ['r.heic', 'image/heic'],
      ['r.pdf', 'application/pdf'],
      ['r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['r.xls', 'application/vnd.ms-excel'],
      ['r.csv', 'text/csv'],
    ])
      expect(ExpenseAttachmentCreate.safeParse({ ...a, fileName, contentType }).success).toBe(true);
    expect(ExpenseAttachmentCreate.safeParse({ ...a, fileName: 'r.pdf' }).success).toBe(false);
    expect(
      ExpenseAttachmentCreate.safeParse({ ...a, contentType: 'application/zip' }).success,
    ).toBe(false);
    expect(
      ExpenseAttachmentCreate.safeParse({ ...a, sizeBytes: EXPENSE_MAX_FILE_BYTES + 1 }).success,
    ).toBe(false);
  });

  it('reject reason is enforced by the server (422 REJECTION_REASON_REQUIRED), not the schema', () => {
    expect(ExpenseDecision.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(ExpenseDecision.safeParse({ decision: 'reject' }).success).toBe(true);
    expect(ExpenseDecision.parse({ decision: 'reject', comment: '  x  ' }).comment).toBe('x');
    expect(
      ExpenseDecision.safeParse({ decision: 'reject', comment: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });

  it('permissions: BM own claims; ABM+ approve; accountant pays', () => {
    const P = DEFAULT_ROLE_PERMISSIONS as Record<string, readonly string[]>;
    expect(P.business_manager).toEqual(expect.arrayContaining(['expenses:read', 'expenses:write']));
    expect(P.business_manager).not.toContain('expenses:approve');
    for (const r of ['area_business_manager', 'general_manager', 'director'])
      expect(P[r]).toEqual(expect.arrayContaining(['expenses:write', 'expenses:approve']));
    expect(P.accountant).toContain('finance:write');
  });

  it('mock: draft -> lines -> hotel receipt -> submit -> approve -> pay; errors', async () => {
    let r = await call('bm', 'POST', '/v1/expense-claims', { month: '2026-09' });
    expect(r.status).toBe(201);
    const c = (await r.json()) as any;
    expect((await call('bm', 'POST', '/v1/expense-claims', { month: '2026-09' })).status).toBe(200);
    expect((await call('bm', 'POST', `/v1/expense-claims/${c.id}/submit`)).status).toBe(422);
    r = await call(
      'bm',
      'POST',
      `/v1/expense-claims/${c.id}/lines`,
      line({ category: 'hotel', amount: 1800 }),
    );
    expect(r.status).toBe(201);
    const hotel = ((await r.json()) as any).lines[0];
    r = await call('bm', 'POST', `/v1/expense-claims/${c.id}/submit`);
    expect(((await r.json()) as any).error.code).toBe('RECEIPT_REQUIRED');
    r = await call('bm', 'POST', `/v1/expense-claims/${c.id}/lines/${hotel.id}/attachments`, {
      fileName: 'bill.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(r.status).toBe(201);
    const up = (await r.json()) as any;
    expect(up.method).toBe('PUT');
    expect(
      (await fetch(up.uploadUrl, { method: 'PUT', headers: up.headers, body: 'x' })).status,
    ).toBe(200);
    const dl = await call('bm', 'POST', `/v1/expense-attachments/${up.attachment.id}/download-url`);
    expect(((await dl.json()) as any).error.code).toBe('UPLOAD_NOT_CONFIRMED');
    expect(
      (await call('bm', 'POST', `/v1/expense-attachments/${up.attachment.id}/confirm`)).status,
    ).toBe(200);
    r = await call('bm', 'POST', `/v1/expense-claims/${c.id}/submit`);
    expect(((await r.json()) as any).status).toBe('submitted');
    r = await call('bm', 'POST', `/v1/expense-claims/${c.id}/lines`, line());
    expect(((await r.json()) as any).error.code).toBe('EXPENSE_NOT_EDITABLE');
    expect(
      (await call('bm', 'POST', `/v1/expense-claims/${c.id}/decision`, { decision: 'approve' }))
        .status,
    ).toBe(403);
    r = await call('abm', 'POST', `/v1/expense-claims/${c.id}/decision`, { decision: 'approve' });
    expect(((await r.json()) as any).status).toBe('approved');
    expect(
      (await call('abm', 'POST', `/v1/expense-claims/${c.id}/pay`, { paymentRef: 'N1' })).status,
    ).toBe(403);
    r = await call('accountant', 'POST', `/v1/expense-claims/${c.id}/pay`, {
      paymentRef: 'NEFT-1',
    });
    expect(((await r.json()) as any).status).toBe('paid');
    r = await call('accountant', 'GET', '/v1/expense-reports?month=2026-09');
    expect(((await r.json()) as any).rows.length).toBe(1);
    r = await call('accountant', 'GET', '/v1/expense-reports/export?month=2026-09&format=pdf');
    expect(r.headers.get('content-type')).toBe('application/pdf');
    r = await call('abm', 'GET', `/v1/expense-claims/${c.id}/reconciliation`);
    expect(((await r.json()) as any).days[0].flags).toContain('no_dcr');
  });
});
