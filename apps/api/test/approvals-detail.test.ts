import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthDates } from '@ariforce/contracts';
import { T, U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { StorageService } from '../src/files/storage.service';
import { JobsRunner } from '../src/jobs/jobs.runner';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
// Own months/years so re-runs and other suites do not collide.
const YEAR = 2001 + (Date.now() % 20);
const EM = `${YEAR}-07`;
const TPM = '2027-06';
// Leave may start at most at the end of this year: first Monday of December.
const LY = new Date().getFullYear();
let LMON = `${LY}-12-01`;
while (new Date(`${LMON}T00:00:00Z`).getUTCDay() !== 1)
  LMON = new Date(Date.parse(`${LMON}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const TAG = uuidv7().slice(-6).toUpperCase();

class FakeStorage {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();
  async presignPut(c: string, purpose: string, type: string, size: number, ext: string) {
    const fileKey = `${c}/${purpose}/${YEAR}/07/${uuidv7()}.${ext}`;
    return {
      fileKey,
      uploadUrl: `https://r2.test/put/${encodeURIComponent(fileKey)}`,
      method: 'PUT' as const,
      headers: { 'content-type': type, 'content-length': String(size) },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
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
    return {
      downloadUrl: `https://r2.test/get/${encodeURIComponent(k)}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }
}
const pdf = (n: number) => {
  const b = new Uint8Array(n).fill(0x20);
  b.set([...'%PDF-1.4'].map((c) => c.charCodeAt(0)));
  return b;
};

// GET /v1/approvals/{id} subject details + required rejection reasons (C). Needs the SSD test DB.
describe.skipIf(!OWNER || !APP)('approval details + rejection reasons (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let runner: JobsRunner;
  const store = new FakeStorage();
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const drain = async () => {
    while ((await runner.runOnce(50)) > 0);
  };
  const notices = async (who: string, type: string) => {
    await drain();
    const r = await http().get('/v1/notifications?limit=100').set(as(who));
    expect(r.status).toBe(200);
    return (r.body.items as { type: string; body: string; entityId: string }[]).filter(
      (n) => n.type === type,
    );
  };
  const BLANKS = [{}, { comment: '' }, { comment: '   \n\t ' }];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(store)
      .compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    runner = app.get(JobsRunner);
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['bm', 'bm2', 'abm', 'rbm', 'zbm', 'director']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      expect(res.status).toBe(200);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    // Re-runs on the same DB: retire this suite's own earlier rows.
    await owner.query(
      `update expense_claims set deleted_at = now() where deleted_at is null and user_id = $1 and month = $2`,
      [U.otherRep, `${EM}-01`],
    );
    await owner.query(
      `delete from tour_plan_submissions where tour_plan_id in (select id from tour_plans where user_id = $1 and month = $2)`,
      [U.otherRep, `${TPM}-01`],
    );
    await owner.query(`delete from tour_plans where user_id = $1 and month = $2`, [
      U.otherRep,
      `${TPM}-01`,
    ]);
    await owner.query(
      `update leave_requests set deleted_at = now() where deleted_at is null and user_id = $1 and from_date = $2`,
      [U.otherRep, LMON],
    );
  });
  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('expense: assigned approver sees lines + receipt URLs; unrelated manager does not; reason required', async () => {
    let r = await http().post('/v1/expense-claims').set(as('bm2')).send({ month: EM });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    const id = r.body.id as string;
    r = await http()
      .post(`/v1/expense-claims/${id}/lines`)
      .set(as('bm2'))
      .send({ date: `${EM}-03`, category: 'hotel', amount: 1500, notes: 'hotel stay' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const lineId = r.body.lines[0].id as string;
    r = await http()
      .post(`/v1/expense-claims/${id}/lines/${lineId}/attachments`)
      .set(as('bm2'))
      .send({ fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 64 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const att = r.body.attachment.id as string;
    store.objects.set(decodeURIComponent(r.body.uploadUrl).split('/put/')[1]!, {
      bytes: pdf(64),
      type: 'application/pdf',
    });
    expect(
      (await http().post(`/v1/expense-attachments/${att}/confirm`).set(as('bm2'))).status,
    ).toBe(200);
    r = await http().post(`/v1/expense-claims/${id}/submit`).set(as('bm2'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const approvalId = r.body.approvalId as string;

    // The assigned approver reads the claim by id and a short-lived receipt link.
    r = await http().get(`/v1/expense-claims/${id}`).set(as('rbm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await http().post(`/v1/expense-attachments/${att}/download-url`).set(as('rbm'));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(r.body.downloadUrl).toMatch(/^https:\/\/r2\.test\/get\//);
    expect(r.body.expiresAt).toBeTruthy();
    r = await http().get(`/v1/approvals/${approvalId}`).set(as('rbm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.subject.type).toBe('expense');
    expect(r.body.subject.claim.lines[0]).toMatchObject({
      date: `${EM}-03`,
      category: 'hotel',
      amount: 1500,
      notes: 'hotel stay',
    });
    expect(r.body.subject.receipts).toHaveLength(1);
    expect(r.body.subject.receipts[0]).toMatchObject({ attachmentId: att, lineId });
    expect(r.body.subject.receipts[0].downloadUrl).toMatch(/^https:\/\/r2\.test\/get\//);
    // The requester sees the same; a manager outside bm2's line gets 404.
    expect((await http().get(`/v1/approvals/${approvalId}`).set(as('bm2'))).body.subject.type).toBe(
      'expense',
    );
    expect((await http().get(`/v1/approvals/${approvalId}`).set(as('abm'))).status).toBe(404);
    expect((await http().get(`/v1/approvals/${uuidv7()}`).set(as('rbm'))).status).toBe(404);

    for (const b of BLANKS) {
      for (const url of [
        `/v1/expense-claims/${id}/decision`,
        `/v1/approvals/${approvalId}/decision`,
      ]) {
        r = await http()
          .post(url)
          .set(as('rbm'))
          .send({ decision: 'reject', ...b });
        expect(r.status, JSON.stringify(r.body)).toBe(422);
        expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
      }
    }
    r = await http()
      .post(`/v1/expense-claims/${id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: '  Hotel bill is for another date  ' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body, JSON.stringify(r.body)).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Hotel bill is for another date',
      rejectedBy: { id: U.regional, name: expect.any(String) },
    });
    expect(r.body.rejectedAt).toBeTruthy();
    const mine = await http().get(`/v1/expense-claims/${id}`).set(as('bm2'));
    expect(mine.body.rejectionReason).toBe('Hotel bill is for another date');
    expect(
      (await http().get(`/v1/approvals/${approvalId}`).set(as('bm2'))).body.rejectionReason,
    ).toBe('Hotel bill is for another date');
    // Not visible to unrelated users.
    expect((await http().get(`/v1/expense-claims/${id}`).set(as('abm'))).status).toBe(404);
    expect((await http().get(`/v1/expense-claims/${id}`).set(as('bm'))).status).toBe(404);
    const n = (await notices('bm2', 'expense.rejected')).find((x) => x.entityId === id);
    expect(n?.body).toContain('Reason: Hotel bill is for another date');
  });

  it('leave: reason required, stored and notified; approver sees balance', async () => {
    const mon = LMON;
    let r = await http()
      .post('/v1/leave/requests')
      .set(as('bm2'))
      .send({ typeCode: 'SL', fromDate: mon, toDate: mon, reason: 'fever' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    const approvalId = r.body.approvalId as string;
    const byId = await http().get(`/v1/leave/requests/${id}`).set(as('rbm'));
    expect(byId.status, JSON.stringify(byId.body)).toBe(200);
    const d = await http().get(`/v1/approvals/${approvalId}`).set(as('rbm'));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.subject).toMatchObject({ type: 'leave', request: { id, reason: 'fever' } });
    expect(d.body.subject).toHaveProperty('overlaps');
    expect(d.body.subject).toHaveProperty('balance');
    expect((await http().get(`/v1/approvals/${approvalId}`).set(as('abm'))).status).toBe(404);
    for (const b of BLANKS) {
      r = await http()
        .post(`/v1/leave/requests/${id}/decision`)
        .set(as('rbm'))
        .send({ decision: 'reject', ...b });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
    }
    r = await http()
      .post(`/v1/leave/requests/${id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: 'Audit week' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Audit week',
      rejectedBy: { id: U.regional, name: expect.any(String) },
    });
    const mine = await http().get(`/v1/leave/requests/${id}`).set(as('bm2'));
    expect(mine.body.rejectionReason).toBe('Audit week');
    expect((await http().get(`/v1/leave/requests/${id}`).set(as('bm'))).status).toBe(404);
    const n = (await notices('bm2', 'leave.rejected')).find((x) => x.entityId === id);
    expect(n?.body).toContain('Reason: Audit week');
  });

  it('tour plan: approver sees resolved days; reason required, notified, cleared on resubmit', async () => {
    const me = await http().get('/v1/me').set(as('bm2'));
    const wt = await http().get('/v1/work-types?limit=50').set(as('bm2'));
    const field = wt.body.items.find(
      (w: { kind: string; code: string }) => w.kind === 'field' && w.code.startsWith('FIELD_'),
    );
    const entry = {
      session: 'full',
      workTypeId: field.id,
      territoryIds: [me.body.territoryIds[0]],
      notes: 'Cover the market',
    };
    const days = monthDates(TPM)
      .slice(0, 3)
      .map((date) => ({ date, entries: [entry] }));
    let r = await http().put(`/v1/tour-plans/${TPM}`).set(as('bm2')).send({ days });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const planId = r.body.id as string;
    r = await http()
      .post(`/v1/tour-plans/${TPM}/submit`)
      .set(as('bm2'))
      .send({ submitterNote: '  Two new doctors in week 1  ' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.submitterNote).toBe('Two new doctors in week 1');
    const subId = r.body.submissions[0].id as string;
    // By id: owner and assigned approver yes; outside the line 404.
    expect((await http().get(`/v1/tour-plans/${planId}`).set(as('bm2'))).status).toBe(200);
    const tp = await http().get(`/v1/tour-plans/${planId}`).set(as('rbm'));
    expect(tp.status, JSON.stringify(tp.body)).toBe(200);
    expect(tp.body).toMatchObject({ id: planId, submitterNote: 'Two new doctors in week 1' });
    expect((await http().get(`/v1/tour-plans/${planId}`).set(as('abm'))).status).toBe(404);
    expect((await http().get(`/v1/tour-plans/${planId}`).set(as('bm'))).status).toBe(404);
    expect((await http().get(`/v1/tour-plans/${uuidv7()}`).set(as('rbm'))).status).toBe(404);
    const q = await http()
      .get('/v1/approvals?mine=to_decide&subjectType=tour_plan&limit=100')
      .set(as('rbm'));
    // #86: the approval's subject is the submission.
    const a = q.body.items.find((x: { subjectId: string }) => x.subjectId === subId);
    expect(a).toBeTruthy();
    const d = await http().get(`/v1/approvals/${a.id}`).set(as('rbm'));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.subject.type).toBe('tour_plan');
    expect(d.body.subject.plan.month).toBe(TPM);
    expect(d.body.subject.days[0].entries[0]).toMatchObject({
      session: 'full',
      workType: { id: field.id, name: field.name },
      notes: 'Cover the market',
    });
    expect(d.body.subject.days[0].entries[0].territories[0].name).toBeTruthy();
    expect((await http().get(`/v1/approvals/${a.id}`).set(as('abm'))).status).toBe(404);
    for (const b of BLANKS) {
      r = await http()
        .post(`/v1/approvals/${a.id}/decision`)
        .set(as('rbm'))
        .send({ decision: 'reject', ...b });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
    }
    r = await http()
      .post(`/v1/approvals/${a.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: 'Add doctor calls' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'rejected', rejectionReason: 'Add doctor calls' });
    let plan = await http().get(`/v1/tour-plans/${TPM}`).set(as('bm2'));
    expect(plan.body, JSON.stringify(plan.body)).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Add doctor calls',
      rejectedBy: { id: U.regional, name: expect.any(String) },
    });
    const n = (await notices('bm2', 'tour_plan.rejected')).find((x) => x.entityId === planId);
    expect(n?.body).toContain('Reason: Add doctor calls');
    // Editing keeps the reason visible; resubmit clears it; the old request keeps its reason.
    r = await http().put(`/v1/tour-plans/${TPM}`).set(as('bm2')).send({ days });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'rejected', rejectionReason: 'Add doctor calls' });
    r = await http().post(`/v1/tour-plans/${TPM}/submit`).set(as('bm2'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const subId2 = r.body.submissions.at(-1).id as string;
    plan = await http().get(`/v1/tour-plans/${TPM}`).set(as('bm2'));
    expect(plan.body).toMatchObject({
      status: 'submitted',
      rejectionReason: null,
      rejectedBy: null,
    });
    expect((await http().get(`/v1/approvals/${a.id}`).set(as('bm2'))).body.rejectionReason).toBe(
      'Add doctor calls',
    );
    // Approve the resubmission: the rep gets tour_plan.approved with the approver's name.
    const q2 = await http()
      .get('/v1/approvals?mine=to_decide&subjectType=tour_plan&limit=100')
      .set(as('rbm'));
    const a2 = q2.body.items.find((x: { subjectId: string }) => x.subjectId === subId2);
    r = await http()
      .post(`/v1/approvals/${a2.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'approve', comment: 'Looks good' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rbmName = (await http().get('/v1/me').set(as('rbm'))).body.name as string;
    const ok = (await notices('bm2', 'tour_plan.approved')).find((x) => x.entityId === planId);
    expect(ok?.body).toContain(`approved by ${rbmName}`);
    expect(ok?.body).toContain('Comment: Looks good');
  });

  it('doctor: reason required; the adder reads it on the approval and is notified', async () => {
    let r = await http()
      .post('/v1/doctors')
      .set(as('rbm'))
      .send({
        territoryId: T.hq,
        name: `Dr. Detail Test ${TAG}`,
        qualification: 'MBBS',
        specialtyId: null,
        categoryId: null,
        registrationNo: `DT-${TAG}`,
        addressLine: null,
        city: null,
        state: null,
        pincode: `7${String(Date.now()).slice(-5)}`,
        location: null,
        phone: null,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const docId = r.body.id as string;
    const q = await http()
      .get('/v1/approvals?mine=to_decide&subjectType=doctor&limit=100')
      .set(as('zbm'));
    const a = q.body.items.find((x: { subjectId: string }) => x.subjectId === docId);
    expect(a).toBeTruthy();
    const byId = await http().get(`/v1/doctors/${docId}`).set(as('zbm'));
    expect(byId.status, JSON.stringify(byId.body)).toBe(200);
    const d = await http().get(`/v1/approvals/${a.id}`).set(as('zbm'));
    expect(d.body.subject).toMatchObject({
      type: 'doctor',
      doctor: { id: docId, name: `Dr. Detail Test ${TAG}`, registrationNo: `DT-${TAG}` },
    });
    expect((await http().get(`/v1/approvals/${a.id}`).set(as('abm'))).status).toBe(404);
    r = await http()
      .post(`/v1/approvals/${a.id}/decision`)
      .set(as('zbm'))
      .send({ decision: 'reject', comment: ' ' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
    r = await http()
      .post(`/v1/approvals/${a.id}/decision`)
      .set(as('zbm'))
      .send({ decision: 'reject', comment: 'Duplicate of an existing doctor' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mine = await http().get(`/v1/approvals/${a.id}`).set(as('rbm'));
    expect(mine.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Duplicate of an existing doctor',
    });
    const n = (await notices('rbm', 'doctor.rejected')).find((x) => x.entityId === docId);
    expect(n?.body).toContain('Reason: Duplicate of an existing doctor');
    // Rejection info on the doctor record itself.
    const doc = await http().get(`/v1/doctors/${docId}`).set(as('rbm'));
    expect(doc.body, JSON.stringify(doc.body)).toMatchObject({
      approvalStatus: 'rejected',
      rejectionReason: 'Duplicate of an existing doctor',
      rejectedBy: { id: expect.any(String), name: expect.any(String) },
    });
    expect(doc.body.rejectedAt).toBeTruthy();
    // Batch fetch by ids: scoped, unknown ids silently absent, 422 on bad input.
    r = await http().get(`/v1/doctors?ids=${docId},${uuidv7()}&limit=100`).set(as('rbm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items.map((x: { id: string }) => x.id)).toEqual([docId]);
    expect(r.body.items[0].rejectionReason).toBe('Duplicate of an existing doctor');
    const other = await http().get(`/v1/doctors?ids=${docId}`).set(as('bm2'));
    expect(other.status).toBe(200);
    for (const x of other.body.items) expect(x.rejectionReason).toBeNull();
    expect((await http().get('/v1/doctors?ids=nope').set(as('rbm'))).status).toBe(422);
    // Same ids= semantics on chemists and stockists.
    for (const m of ['chemists', 'stockists']) {
      const all = (await http().get(`/v1/${m}?limit=2`).set(as('rbm'))).body.items as {
        id: string;
      }[];
      const want = all.map((x) => x.id);
      const got = await http()
        .get(`/v1/${m}?ids=${[...want, uuidv7()].join(',')}&limit=100`)
        .set(as('rbm'));
      expect(got.status, JSON.stringify(got.body)).toBe(200);
      expect(got.body.items.map((x: { id: string }) => x.id).sort()).toEqual([...want].sort());
      expect((await http().get(`/v1/${m}?ids=nope`).set(as('rbm'))).status).toBe(422);
      const tooMany = Array.from({ length: 101 }, () => uuidv7()).join(',');
      expect((await http().get(`/v1/${m}?ids=${tooMany}`).set(as('rbm'))).status).toBe(422);
    }
    const many = Array.from({ length: 101 }, () => uuidv7()).join(',');
    expect((await http().get(`/v1/doctors?ids=${many}`).set(as('rbm'))).status).toBe(422);
    // Approval notifies the adder with the approver's name.
    r = await http()
      .post('/v1/doctors')
      .set(as('rbm'))
      .send({
        territoryId: T.hq,
        name: `Dr. Approve Test ${TAG}`,
        qualification: 'MBBS',
        specialtyId: null,
        categoryId: null,
        registrationNo: `DA-${TAG}`,
        addressLine: null,
        city: null,
        state: null,
        pincode: `6${String(Date.now()).slice(-5)}`,
        location: null,
        phone: null,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const doc2 = r.body.id as string;
    const q2 = await http()
      .get('/v1/approvals?mine=to_decide&subjectType=doctor&limit=100')
      .set(as('zbm'));
    const a2 = q2.body.items.find((x: { subjectId: string }) => x.subjectId === doc2);
    r = await http()
      .post(`/v1/approvals/${a2.id}/decision`)
      .set(as('zbm'))
      .send({ decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const zName = (await http().get('/v1/me').set(as('zbm'))).body.name as string;
    const ok = (await notices('rbm', 'doctor.approved')).find((x) => x.entityId === doc2);
    expect(ok?.body).toContain(`approved by ${zName}`);
  });

  it('sign-up reject needs a reason', async () => {
    for (const b of [{}, { reason: '' }, { reason: '   ' }, { reason: null }]) {
      const r = await http()
        .post(`/v1/signup-requests/${uuidv7()}/reject`)
        .set(as('director'))
        .send(b);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
    }
  });
});
