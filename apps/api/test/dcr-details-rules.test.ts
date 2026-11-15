import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, T, U } from '@ariforce/db';
import { insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

/** Meeting sub-types, endTime, places and derived durationMin on DCR drafts/submit and TP items. */
describe.skipIf(!OWNER || !APP)('DCR/TP details rules (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let me: { id: string; bearer: string };
  const wt: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = () => ({ authorization: me.bearer });
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 5.5 * 36e5 + 864e5).toISOString().slice(0, 10);
  const meeting = (o: Record<string, unknown> = {}) => ({
    kind: 'meeting',
    title: 'Cycle Meeting',
    mode: 'online',
    startTime: '10:00',
    endTime: '11:30',
    ...o,
  });
  const office = (o: Record<string, unknown> = {}) => ({
    kind: 'office',
    taskType: 'Reports',
    description: 'Monthly reports',
    startTime: '09:00',
    endTime: '10:15',
    ...o,
  });
  const draft = (details: unknown, workTypeId = wt.meeting) =>
    http().put('/v1/dcrs/draft').set(as()).send({ date: today, workTypeId, details });
  const tp = (details: unknown, workTypeId = wt.meeting) =>
    http()
      .put('/v1/tour-plans/items')
      .set(as())
      .send({ from: tomorrow, to: tomorrow, plan: { workTypeId, details } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    me = await insertStaff(`dcr-rules-${RUN}@example.test`, 'business_manager', U.regional, [T.hq]);
    const o = await http().get(`/v1/dcrs/options?date=${today}&products=false`).set(as());
    for (const w of o.body.workTypes as { id: string; detailsKind: string | null }[])
      if (w.detailsKind && !wt[w.detailsKind]) wt[w.detailsKind] = w.id;
    expect(wt.meeting && wt.office).toBeTruthy();
  });
  afterAll(async () => {
    if (me) {
      await owner.query(`delete from dcrs where user_id=$1`, [me.id]);
      await owner.query(`delete from tour_plan_items where user_id=$1`, [me.id]);
    }
    await owner?.end();
    await app?.close();
  });

  it('meeting: derived durationMin, places and endTime stored and returned', async () => {
    const r = await draft(meeting({ durationMin: 5, fromPlace: 'HQ', toPlace: 'Office' }));
    expect(r.status).toBe(200);
    expect(r.body.details).toMatchObject({
      title: 'Cycle Meeting',
      endTime: '11:30',
      durationMin: 90,
      fromPlace: 'HQ',
      toPlace: 'Office',
    });
    const g = await http().get(`/v1/dcrs/${r.body.id}`).set(as());
    expect(g.body.details).toMatchObject({ endTime: '11:30', durationMin: 90, toPlace: 'Office' });
    const l = await http().get(`/v1/dcrs?from=${today}&to=${today}`).set(as());
    const row = (l.body.items as { id: string; details: unknown }[]).find(
      (x) => x.id === r.body.id,
    );
    expect(row?.details).toMatchObject({ endTime: '11:30', durationMin: 90 });
  });

  it('MEETING_TYPE_INVALID on DCR draft, TP upsert, and submit of an old draft', async () => {
    expect((await draft(meeting({ title: 'Team huddle' }))).body.error.code).toBe(
      'MEETING_TYPE_INVALID',
    );
    expect((await draft(meeting({ title: 'Review Meeting' }))).status).toBe(200);
    const t = await tp(meeting({ title: 'cycle meeting' }));
    expect([t.status, t.body.error.code]).toEqual([422, 'MEETING_TYPE_INVALID']);
    // An old draft with a free-text title still reads, but cannot be submitted.
    const ok = await draft(meeting());
    await owner.query(`update dcrs set details = details || '{"title":"Old text"}' where id=$1`, [
      ok.body.id,
    ]);
    const g = await http().get(`/v1/dcrs/${ok.body.id}`).set(as());
    expect([g.status, g.body.details.title]).toEqual([200, 'Old text']);
    const s = await http()
      .post(`/v1/dcrs/${ok.body.id}/submit`)
      .set({ ...as(), 'idempotency-key': randomUUID() })
      .send({ version: g.body.version });
    expect([s.status, s.body.error.code]).toEqual([422, 'MEETING_TYPE_INVALID']);
  });

  it('END_TIME_NOT_AFTER_START, DURATION_TOO_LONG on DCR and TP', async () => {
    for (const send of [draft, tp]) {
      expect((await send(meeting({ endTime: '10:00' }))).body.error.code).toBe(
        'END_TIME_NOT_AFTER_START',
      );
      expect((await send(meeting({ startTime: '06:00', endTime: '18:01' }))).body.error.code).toBe(
        'DURATION_TOO_LONG',
      );
      expect((await send(meeting({ startTime: '06:00', endTime: '18:00' }))).status).toBe(200);
    }
  });

  it('admin work: startTime required with endTime; legacy durationMin still works', async () => {
    const r = await draft(office({ startTime: null }), wt.office);
    expect([r.status, r.body.error.code]).toEqual([422, 'END_TIME_NOT_AFTER_START']);
    const legacy = await draft(
      office({ startTime: null, endTime: undefined, durationMin: 45 }),
      wt.office,
    );
    expect([legacy.status, legacy.body.details.durationMin]).toEqual([200, 45]);
    const none = await draft(office({ startTime: null, endTime: undefined }), wt.office);
    expect(none.status).toBe(422);
    const t = await tp(office({ fromPlace: 'A', toPlace: 'B' }), wt.office);
    expect(t.status).toBe(200);
    expect(t.body.plan.details).toMatchObject({ durationMin: 75, fromPlace: 'A', toPlace: 'B' });
  });

  it('legacy meeting client (durationMin, no endTime) still works', async () => {
    const r = await draft(meeting({ endTime: undefined, durationMin: 30 }));
    expect([r.status, r.body.details.durationMin]).toEqual([200, 30]);
    expect(A).toBeTruthy();
  });
});
