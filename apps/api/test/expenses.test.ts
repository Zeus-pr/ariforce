import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U } from '@ariforce/db';
import { bearerFor } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { StorageService } from '../src/files/storage.service';
import { sniffMatches } from '../src/expenses/files.util';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
// A past month unlikely to collide with other suites or re-runs on the same DB.
const YEAR = 2001 + (Date.now() % 20);
const M = `${YEAR}-02`;
const d = (n: number) => `${M}-${String(n).padStart(2, '0')}`;

/** In-memory R2 stand-in: presignPut records the key; tests "PUT" bytes with put(). */
class FakeStorage {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  async presignPut(c: string, purpose: string, type: string, size: number, ext: string) {
    const fileKey = `${c}/${purpose}/${YEAR}/02/${uuidv7()}.${ext}`;
    return {
      fileKey,
      uploadUrl: `https://r2.test/put/${encodeURIComponent(fileKey)}`,
      method: 'PUT' as const,
      headers: { 'content-type': type, 'content-length': String(size) },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }
  put(key: string, bytes: Uint8Array, type: string) {
    this.objects.set(key, { bytes, type });
  }
  async head(k: string) {
    const o = this.objects.get(k);
    return o ? { sizeBytes: o.bytes.length, contentType: o.type } : null;
  }
  async firstBytes(k: string, n: number) {
    return this.objects.get(k)!.bytes.slice(0, n);
  }
  async remove(k: string) {
    this.objects.delete(k);
  }
  async downloadUrl(c: string, k: string) {
    if (!k.startsWith(`${c}/`)) throw new Error('tenant');
    return { downloadUrl: `https://r2.test/get/x`, expiresAt: new Date().toISOString() };
  }
}

const pdf = (n: number) => {
  const b = new Uint8Array(n).fill(0x20);
  b.set([...'%PDF-1.4'].map((c) => c.charCodeAt(0)));
  return b;
};

describe.skipIf(!OWNER || !APP)('expense claims (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const store = new FakeStorage();
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let company = '';
  let field = '';
  let leave = '';
  const dcr = async (user: string, date: string, status: string, wt = field) => {
    const id = uuidv7();
    await owner.query(
      `insert into dcrs (id, company_id, user_id, date, work_type_id, status) values ($1,$2,$3,$4,$5,$6)`,
      [id, company, user, date, wt, status],
    );
    return id;
  };
  const audit = async (entity: string) =>
    (
      await owner.query(`select action from audit_log where entity_id = $1 order by at`, [entity])
    ).rows.map((r) => r.action as string);
  const line = (over: Record<string, unknown> = {}) => ({
    date: d(3),
    category: 'travel',
    amount: 500,
    notes: 'bus',
    ...over,
  });

  beforeAll(async () => {
    process.env.EXPENSE_APPROVAL_LEVELS = '2';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(store)
      .compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    company = (await owner.query(`select company_id from users where id = $1`, [U.rep])).rows[0]
      .company_id;
    field = (
      await owner.query(
        `select id from work_types where company_id = $1 and counts_as_field_day order by code limit 1`,
        [company],
      )
    ).rows[0].id;
    leave = (
      await owner.query(
        `select id from work_types where company_id = $1 and not counts_as_field_day order by code limit 1`,
        [company],
      )
    ).rows[0].id;
    for (const who of [
      'bm',
      'bm2',
      'abm',
      'rbm',
      'zbm',
      'sm',
      'gm',
      'vp',
      'sysadmin',
      'director',
    ]) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
  });
  afterAll(async () => {
    delete process.env.EXPENSE_APPROVAL_LEVELS;
    await owner?.end();
    await app?.close();
  });

  it('sniffs magic bytes', () => {
    expect(sniffMatches('application/pdf', pdf(20))).toBe(true);
    expect(sniffMatches('application/pdf', new Uint8Array([0x4d, 0x5a, 0, 0]))).toBe(false);
    expect(
      sniffMatches('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])),
    ).toBe(true);
    expect(sniffMatches('text/csv', new TextEncoder().encode('a,b\n1,2\n'))).toBe(true);
    expect(sniffMatches('text/csv', new Uint8Array([0x50, 0x4b, 3, 4, 0]))).toBe(false);
    const heic = new Uint8Array(16);
    heic.set(
      [...'ftypheic'].map((c) => c.charCodeAt(0)),
      4,
    );
    expect(sniffMatches('image/heic', heic)).toBe(true);
  });

  it('full flow: draft, lines, receipts, chain approval, finance, export, pay', async () => {
    const d3 = await dcr(U.rep, d(3), 'submitted');
    await dcr(U.rep, d(5), 'draft', leave);
    const otherDcr = await dcr(U.otherRep, d(3), 'submitted');

    const c1 = await http().post('/v1/expense-claims').set(as('bm')).send({ month: M });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body).toMatchObject({ status: 'draft', total: 0, month: M });
    const id = c1.body.id as string;
    const again = await http().post('/v1/expense-claims').set(as('bm')).send({ month: M });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect(
      (await http().post('/v1/expense-claims').set(as('bm')).send({ month: '2999-01' })).status,
    ).toBe(422);
    expect(
      (await http().post('/v1/expense-claims').set(as('sysadmin')).send({ month: M })).status,
    ).toBe(403);

    const add = (b: object, who = 'bm') =>
      http().post(`/v1/expense-claims/${id}/lines`).set(as(who)).send(b);
    let r = await add(line({ dcrId: d3 }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await add(line({ dcrId: otherDcr }))).status).toBe(422);
    expect((await add(line({ date: `${YEAR}-03-01` }))).status).toBe(422);
    expect((await add(line({ category: 'mileage' }))).status).toBe(422);
    expect((await add(line({ mileageKm: 10 }))).status).toBe(422);
    r = await add(line({ date: d(4), category: 'hotel', amount: 2000, notes: null }));
    expect(r.status).toBe(201);
    r = await add(line({ date: d(5), category: 'mileage', amount: 120.5, mileageKm: 40 }));
    expect(r.body.total).toBe(2620.5);
    expect((await add(line(), 'bm2')).status).toBe(404);
    const hotel = r.body.lines.find((l: { category: string }) => l.category === 'hotel');

    // Hotel needs a confirmed receipt before submit.
    const sub = () => http().post(`/v1/expense-claims/${id}/submit`).set(as('bm'));
    r = await sub();
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('RECEIPT_REQUIRED');

    const attach = (b: object) =>
      http().post(`/v1/expense-claims/${id}/lines/${hotel.id}/attachments`).set(as('bm')).send(b);
    expect(
      (await attach({ fileName: 'bill.png', contentType: 'application/pdf', sizeBytes: 100 }))
        .status,
    ).toBe(422);
    expect(
      (await attach({ fileName: 'bill.pdf', contentType: 'application/pdf', sizeBytes: 11e6 }))
        .status,
    ).toBe(422);
    expect(
      (
        await attach({
          fileName: 'bill.exe',
          contentType: 'application/x-msdownload',
          sizeBytes: 9,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await http()
          .post('/v1/files/upload-url')
          .set(as('bm'))
          .send({ purpose: 'expense_receipt', contentType: 'application/pdf', sizeBytes: 10 })
      ).status,
    ).toBe(422);

    // Disguised file: declared PDF, bytes are an executable -> rejected and removed.
    r = await attach({
      fileName: 'Hotel Bill Ravi.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const bad = r.body.attachment.id as string;
    const badKey = [...decodeURIComponent(r.body.uploadUrl).matchAll(/put\/(.+)$/g)][0]![1]!;
    expect(badKey.startsWith(`${company}/expense_receipt/`)).toBe(true);
    expect(badKey).not.toMatch(/ravi|bill/i);
    const confirm = (a: string) =>
      http().post(`/v1/expense-attachments/${a}/confirm`).set(as('bm'));
    expect((await confirm(bad)).body.error.code).toBe('UPLOAD_MISSING');
    store.put(badKey, new Uint8Array([0x4d, 0x5a, 0, 0]), 'application/pdf');
    r = await confirm(bad);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('UPLOAD_FORMAT_INVALID');
    expect(store.objects.has(badKey)).toBe(false);
    expect(await audit(bad)).toContain('expense.attachment_rejected');

    r = await attach({ fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 64 });
    const att = r.body.attachment.id as string;
    const key = decodeURIComponent(r.body.uploadUrl).split('/put/')[1]!;
    store.put(key, pdf(60), 'application/pdf');
    expect((await confirm(att)).body.error.code).toBe('UPLOAD_SIZE_MISMATCH');
    r = await attach({ fileName: 'b.PDF', contentType: 'application/pdf', sizeBytes: 64 });
    const good = r.body.attachment.id as string;
    store.put(decodeURIComponent(r.body.uploadUrl).split('/put/')[1]!, pdf(64), 'application/pdf');
    r = await confirm(good);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('confirmed');
    for (let i = 0; i < 4; i++)
      expect(
        (await attach({ fileName: `x${i}.jpg`, contentType: 'image/jpeg', sizeBytes: 10 })).status,
      ).toBe(201);
    r = await attach({ fileName: 'x.csv', contentType: 'text/csv', sizeBytes: 10 });
    expect(r.body.error.code).toBe('TOO_MANY_FILES');

    // Submit -> step 1 (ABM) -> step 2 (RBM) -> approved.
    r = await sub();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'submitted', approvalStep: 1 });
    expect((await add(line())).body.error.code).toBe('EXPENSE_NOT_EDITABLE');
    expect((await http().get(`/v1/expense-claims/${id}`).set(as('bm2'))).status).toBe(404);
    // Submitted (not yet approved): hidden from expenses:pay holders outside the chain.
    expect((await http().get(`/v1/expense-claims/${id}`).set(as('sysadmin'))).status).toBe(404);
    const decide = (who: string, b: object) =>
      http().post(`/v1/expense-claims/${id}/decision`).set(as(who)).send(b);
    expect((await decide('bm', { decision: 'approve' })).status).toBe(403);
    expect((await decide('bm2', { decision: 'approve' })).status).toBe(403);
    expect((await decide('abm', { decision: 'reject' })).status).toBe(422);
    r = await decide('abm', { decision: 'approve', comment: 'ok' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'submitted', approvalStep: 2 });
    r = await decide('abm', { decision: 'approve' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('APPROVAL_NOT_YOUR_STEP');
    const list = await http()
      .get('/v1/approvals?subjectType=expense&mine=to_decide')
      .set(as('rbm'));
    expect(list.body.items.some((a: { subjectId: string }) => a.subjectId === id)).toBe(true);
    r = await decide('rbm', { decision: 'approve' });
    expect(r.body.status).toBe('approved');
    expect((await decide('rbm', { decision: 'approve' })).status).toBe(409);

    // Downloads: owner, approver, expenses:pay (system admin, claim approved); not a peer. Audited.
    for (const who of ['bm', 'abm', 'sysadmin'])
      expect(
        (await http().post(`/v1/expense-attachments/${good}/download-url`).set(as(who))).status,
      ).toBe(200);
    expect(
      (await http().post(`/v1/expense-attachments/${good}/download-url`).set(as('bm2'))).status,
    ).toBe(404);
    expect((await audit(good)).filter((a) => a === 'expense.attachment_downloaded')).toHaveLength(
      3,
    );

    // Reconciliation against DCR days.
    r = await http().get(`/v1/expense-claims/${id}/reconciliation`).set(as('sysadmin'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ claimedDays: 3, dcrDays: 1, matchedDays: 1, total: 2620.5 });
    expect(r.body.unmatchedAmount).toBe(2120.5);
    const flags = Object.fromEntries(
      r.body.days.map((x: { date: string; flags: string[] }) => [x.date, x.flags]),
    );
    expect(flags[d(3)]).toEqual([]);
    expect(flags[d(4)]).toEqual(['no_dcr']);
    expect(flags[d(5)]).toEqual(['dcr_not_submitted', 'non_field_day']);

    // Reports + exports, scoped.
    r = await http().get(`/v1/expense-reports?month=${M}`).set(as('sysadmin'));
    expect(r.body.rows.map((x: { claimId: string }) => x.claimId)).toContain(id);
    expect(r.body.byCategory.hotel).toBeGreaterThanOrEqual(2000);
    r = await http().get(`/v1/expense-reports?month=${M}`).set(as('bm2'));
    expect(r.body.rows.map((x: { claimId: string }) => x.claimId)).not.toContain(id);
    const buf = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    r = await http()
      .get(`/v1/expense-reports/export?month=${M}&format=xlsx`)
      .set(as('sysadmin'))
      .buffer(true)
      .parse(buf as never);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    r = await http()
      .get(`/v1/expense-reports/export?month=${M}&format=pdf&userId=${U.rep}`)
      .set(as('abm'))
      .buffer(true)
      .parse(buf as never);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Pay: only expenses:pay (director, system admin). Every other rank, approver or not: 403.
    for (const who of ['bm', 'abm', 'rbm', 'zbm', 'sm', 'gm', 'vp'])
      expect(
        (await http().post(`/v1/expense-claims/${id}/pay`).set(as(who)).send({ paymentRef: 'x' }))
          .status,
        who,
      ).toBe(403);
    r = await http()
      .post(`/v1/expense-claims/${id}/pay`)
      .set(as('director'))
      .send({ paymentRef: 'NEFT-1' });
    expect(r.body).toMatchObject({ status: 'paid', paymentRef: 'NEFT-1' });
    expect(
      (
        await http()
          .post(`/v1/expense-claims/${id}/pay`)
          .set(as('sysadmin'))
          .send({ paymentRef: 'NEFT-1' })
      ).status,
    ).toBe(409);
    const acts = await audit(id);
    for (const a of [
      'expense.created',
      'expense.line_added',
      'expense.submitted',
      'expense.step_approved',
      'expense.approved',
      'expense.paid',
    ])
      expect(acts).toContain(a);
  });

  it('reject, edit and resubmit; no self-approval', async () => {
    const c = await http().post('/v1/expense-claims').set(as('bm2')).send({ month: M });
    const id = c.body.id as string;
    await http()
      .post(`/v1/expense-claims/${id}/lines`)
      .set(as('bm2'))
      .send(line({ amount: 99 }));
    let r = await http().post(`/v1/expense-claims/${id}/submit`).set(as('bm2'));
    const first = r.body.approvalId as string;
    r = await http()
      .post(`/v1/expense-claims/${id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: 'no receipt' });
    expect(r.body).toMatchObject({ status: 'rejected', decisionComment: 'no receipt' });
    const lineId = r.body.lines[0].id as string;
    r = await http()
      .put(`/v1/expense-claims/${id}/lines/${lineId}`)
      .set(as('bm2'))
      .send({ line: line({ amount: 80 }), version: 99 });
    expect(r.status).toBe(409);
    r = await http()
      .put(`/v1/expense-claims/${id}/lines/${lineId}`)
      .set(as('bm2'))
      .send({ line: line({ amount: 80 }), version: 1 });
    expect(r.body.total).toBe(80);
    r = await http().post(`/v1/expense-claims/${id}/submit`).set(as('bm2'));
    expect(r.body.status).toBe('submitted');
    expect(r.body.approvalId).not.toBe(first);
    expect(await audit(id)).toEqual(
      expect.arrayContaining(['expense.rejected', 'expense.resubmitted', 'expense.line_updated']),
    );

    const own = await http().post('/v1/expense-claims').set(as('abm')).send({ month: M });
    await http()
      .post(`/v1/expense-claims/${own.body.id}/lines`)
      .set(as('abm'))
      .send(line({ amount: 10 }));
    await http().post(`/v1/expense-claims/${own.body.id}/submit`).set(as('abm'));
    r = await http()
      .post(`/v1/expense-claims/${own.body.id}/decision`)
      .set(as('abm'))
      .send({ decision: 'approve' });
    expect(r.status).toBe(403);
  });
  it('System admin (expenses:pay only, no other expenses:*): approved/paid company-wide, read-only + pay', async () => {
    const A = `${YEAR}-03`;
    const day = (n: number) => `${A}-${String(n).padStart(2, '0')}`;
    const perms = (
      await owner.query(
        `select r.permissions from roles r join user_roles ur on ur.role_id = r.id where ur.user_id = $1`,
        [U.sysadmin],
      )
    ).rows.flatMap((r) => r.permissions as string[]);
    expect(perms.filter((x) => x.startsWith('expenses:'))).toEqual(['expenses:pay']);
    expect(perms.filter((x) => x.startsWith('finance:'))).toEqual([]);

    const mk = async (who: string, amount: number) => {
      const c = await http().post('/v1/expense-claims').set(as(who)).send({ month: A });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const r = await http()
        .post(`/v1/expense-claims/${c.body.id}/lines`)
        .set(as(who))
        .send(line({ date: day(2), amount }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return { id: c.body.id as string, lineId: r.body.lines[0].id as string };
    };
    const decide = (who: string, id: string, b: object) =>
      http().post(`/v1/expense-claims/${id}/decision`).set(as(who)).send(b);
    // approved (bm, with a confirmed receipt), submitted (bm2), rejected (abm), draft (rbm)
    const ap = await mk('bm', 120);
    const up = await http()
      .post(`/v1/expense-claims/${ap.id}/lines/${ap.lineId}/attachments`)
      .set(as('bm'))
      .send({ fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: 64 });
    expect(up.status).toBe(201);
    store.put(decodeURIComponent(up.body.uploadUrl).split('/put/')[1]!, pdf(64), 'application/pdf');
    const att = up.body.attachment.id as string;
    expect((await http().post(`/v1/expense-attachments/${att}/confirm`).set(as('bm'))).status).toBe(
      200,
    );
    expect((await http().post(`/v1/expense-claims/${ap.id}/submit`).set(as('bm'))).status).toBe(
      200,
    );
    expect((await decide('abm', ap.id, { decision: 'approve' })).status).toBe(200);
    expect((await decide('rbm', ap.id, { decision: 'approve' })).body.status).toBe('approved');
    const sb = await mk('bm2', 130);
    expect((await http().post(`/v1/expense-claims/${sb.id}/submit`).set(as('bm2'))).status).toBe(
      200,
    );
    const rj = await mk('abm', 140);
    await http().post(`/v1/expense-claims/${rj.id}/submit`).set(as('abm'));
    expect((await decide('rbm', rj.id, { decision: 'reject', comment: 'no' })).body.status).toBe(
      'rejected',
    );
    const dr = await mk('rbm', 150);

    const acc = as('sysadmin');
    const listIds = async () =>
      (await http().get(`/v1/expense-claims?month=${A}`).set(acc)).body.items.map(
        (x: { id: string }) => x.id,
      );
    expect(await listIds()).toEqual([ap.id]);
    expect((await http().get(`/v1/expense-claims/${ap.id}`).set(acc)).status).toBe(200);
    for (const h of [sb, rj, dr]) {
      expect((await http().get(`/v1/expense-claims/${h.id}`).set(acc)).status).toBe(404);
      expect((await http().get(`/v1/expense-claims/${h.id}/reconciliation`).set(acc)).status).toBe(
        404,
      );
    }
    const rec = await http().get(`/v1/expense-claims/${ap.id}/reconciliation`).set(acc);
    expect(rec.status).toBe(200);
    expect(rec.body.total).toBe(120);
    expect((await http().post(`/v1/expense-attachments/${att}/download-url`).set(acc)).status).toBe(
      200,
    );
    const dl = await owner.query(
      `select actor_user_id from audit_log where entity_id = $1 and action = 'expense.attachment_downloaded'`,
      [att],
    );
    expect(dl.rows.map((r) => r.actor_user_id)).toContain(U.sysadmin);
    const rep = await http().get(`/v1/expense-reports?month=${A}`).set(acc);
    expect(rep.status).toBe(200);
    expect(rep.body.rows.map((x: { claimId: string }) => x.claimId)).toEqual([ap.id]);
    for (const format of ['xlsx', 'pdf']) {
      const ex = await http()
        .get(`/v1/expense-reports/export?month=${A}&format=${format}`)
        .set(acc);
      expect(ex.status, format).toBe(200);
    }

    // Not allowed: create, lines, attachments, submit, decide; hidden claims cannot be paid.
    expect((await http().post('/v1/expense-claims').set(acc).send({ month: A })).status).toBe(403);
    expect(
      (
        await http()
          .post(`/v1/expense-claims/${dr.id}/lines`)
          .set(acc)
          .send(line({ date: day(3) }))
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .put(`/v1/expense-claims/${ap.id}/lines/${ap.lineId}`)
          .set(acc)
          .send({ line: line({ date: day(2) }), version: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .post(`/v1/expense-claims/${ap.id}/lines/${ap.lineId}/attachments`)
          .set(acc)
          .send({ fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: 64 })
      ).status,
    ).toBe(403);
    expect((await http().post(`/v1/expense-claims/${dr.id}/submit`).set(acc)).status).toBe(403);
    expect((await decide('sysadmin', sb.id, { decision: 'approve' })).status).toBe(403);
    expect(
      (await http().post(`/v1/expense-claims/${sb.id}/pay`).set(acc).send({ paymentRef: 'X' }))
        .status,
    ).toBe(404);

    const pay = await http()
      .post(`/v1/expense-claims/${ap.id}/pay`)
      .set(acc)
      .send({ paymentRef: 'NEFT-SA-1' });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.status).toBe('paid');
    expect(await listIds()).toEqual([ap.id]);
    expect((await http().get(`/v1/expense-claims/${ap.id}`).set(acc)).body.status).toBe('paid');
  });
});
