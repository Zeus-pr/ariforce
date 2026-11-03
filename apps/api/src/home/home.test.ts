import { describe, expect, it } from 'vitest';
import { HOME_KPIS } from '@ariforce/contracts';
import type { Tx } from '@ariforce/db';
import type { Principal } from '../auth/principal';
import { ExceptionRecheck, RECHECK_DELAY_MS, recheckKey } from '../jobs/exception-recheck';
import { exceptionsDailySlot } from '../jobs/jobs.runner';
import { HomeService } from './home.service';

describe('exceptions promptness', () => {
  it('fans out exceptions.daily per 15-minute slot', () => {
    expect(exceptionsDailySlot(new Date('2026-10-29T18:44:59Z'))).toBe('2026-10-29T18:30');
    expect(exceptionsDailySlot(new Date('2026-10-29T18:45:00Z'))).toBe('2026-10-29T18:45');
  });

  it('coalesces rechecks per company, date and 5 minutes', () => {
    const a = recheckKey('c', '2026-10-28', new Date('2026-10-29T10:00:00Z'));
    expect(recheckKey('c', '2026-10-28', new Date('2026-10-29T10:04:59Z'))).toBe(a);
    expect(recheckKey('c', '2026-10-28', new Date('2026-10-29T10:05:00Z'))).not.toBe(a);
    expect(recheckKey('c', '2026-10-27', new Date('2026-10-29T10:00:00Z'))).not.toBe(a);
  });

  it('queues a one-day evaluate a minute later, and never throws', async () => {
    const got: unknown[] = [];
    const tx = { transaction: (fn: (sp: unknown) => Promise<unknown>) => fn({}) } as unknown as Tx;
    const p = { companyId: 'c', userId: 'u' } as Principal;
    const at = new Date('2026-10-29T10:00:00Z');
    await new ExceptionRecheck({
      enqueue: (...a: unknown[]) => (got.push(a.slice(2)), Promise.resolve()),
    } as never).queue(tx, p, '2026-10-28', at);
    expect(got[0]).toEqual([
      'exceptions.evaluate',
      { from: '2026-10-28', to: '2026-10-28', notify: false, trigger: 'event' },
      {
        dedupeKey: recheckKey('c', '2026-10-28', at),
        runAt: new Date(at.getTime() + RECHECK_DELAY_MS),
      },
    ]);
    const bad = new ExceptionRecheck({ enqueue: () => Promise.reject(new Error('x')) } as never);
    await expect(bad.queue(tx, p, '2026-10-28', at)).resolves.toBeUndefined();
  });
});

describe('GET /v1/me/kpis', () => {
  const tenant = {
    run: (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({ where: () => Promise.resolve([{ timezone: 'Asia/Kolkata' }]) }),
        }),
      }),
  };
  const calls: unknown[] = [];
  const svc = new HomeService(
    tenant as never,
    {} as never,
    {
      report: (_p: unknown, q: unknown) => (calls.push(q), Promise.resolve(q)),
    } as never,
  );
  const p = {
    userId: 'u',
    companyId: 'c',
    teamUserIds: ['u'],
    permissions: [],
  } as unknown as Principal;

  it('refuses team scope without a team', async () => {
    await expect(svc.kpis(p, { scope: 'team' })).rejects.toThrow('You have no team');
  });

  it('asks the KPI engine for a closed past month with the home KPIs', async () => {
    calls.length = 0;
    await svc.kpis({ ...p, teamUserIds: null }, { scope: 'team', month: '2026-02' });
    expect(calls[0]).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      rollup: 'team',
      kpis: [...HOME_KPIS],
    });
  });
});
