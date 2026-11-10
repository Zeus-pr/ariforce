import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@ariforce/db';
import type { Principal } from '../auth/principal';
import { companySettings, invalidateCompanySettings, punchOnCompanyToday } from './field.util';

const row = (companyId: string, radius: number) => ({
  id: companyId,
  timezone: 'Asia/Kolkata',
  defaultGeofenceM: radius,
  geofenceMaxAccuracyM: 100,
  geofenceBlockOutOfFence: false,
  geofenceBlockMock: true,
  dcrLockAfterHours: 24,
  version: 1,
});
function fakeTx(db: Map<string, number>, calls: string[]) {
  let cid = '';
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([row(cid, db.get(cid)!)]) }) }),
  };
  return (p: Principal) => {
    cid = p.companyId;
    calls.push(cid);
    return tx as unknown as Tx;
  };
}
const P = (companyId: string) => ({ companyId, userId: 'u' }) as unknown as Principal;

describe('company settings cache', () => {
  afterEach(() => {
    invalidateCompanySettings();
    vi.unstubAllEnvs();
  });

  it('caches per company id, invalidates per company, fresh bypasses', async () => {
    const db = new Map([
      ['a', 100],
      ['b', 200],
    ]);
    const calls: string[] = [];
    const tx = fakeTx(db, calls);
    expect((await companySettings(tx(P('a')), P('a'))).radiusM).toBe(100);
    expect((await companySettings(tx(P('b')), P('b'))).radiusM).toBe(200);
    db.set('a', 111);
    db.set('b', 222);
    const loads = () => calls.length;
    const before = loads();
    const a1 = await companySettings({} as Tx, P('a'));
    expect(a1.radiusM).toBe(100); // cached, no load
    expect(loads()).toBe(before);
    a1.radiusM = 999; // callers get a copy
    expect((await companySettings({} as Tx, P('a'))).radiusM).toBe(100);
    expect((await companySettings(tx(P('a')), P('a'), { fresh: true })).radiusM).toBe(111);
    invalidateCompanySettings('a');
    expect((await companySettings(tx(P('a')), P('a'))).radiusM).toBe(111);
    expect((await companySettings({} as Tx, P('b'))).radiusM).toBe(200); // b untouched
  });

  it('TTL 0 turns the cache off', async () => {
    vi.stubEnv('COMPANY_SETTINGS_CACHE_TTL_SECONDS', '0');
    const db = new Map([['a', 1]]);
    const calls: string[] = [];
    const tx = fakeTx(db, calls);
    await companySettings(tx(P('a')), P('a'));
    db.set('a', 2);
    expect((await companySettings(tx(P('a')), P('a'))).radiusM).toBe(2);
  });

  it('expires after the TTL', async () => {
    vi.stubEnv('COMPANY_SETTINGS_CACHE_TTL_SECONDS', '1');
    vi.useFakeTimers();
    try {
      const db = new Map([['a', 1]]);
      const tx = fakeTx(db, []);
      await companySettings(tx(P('a')), P('a'));
      db.set('a', 2);
      expect((await companySettings(tx(P('a')), P('a'))).radiusM).toBe(1);
      vi.advanceTimersByTime(1001);
      expect((await companySettings(tx(P('a')), P('a'))).radiusM).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('punch day', () => {
  it('accepts a punch whose captured day is the company today', () => {
    expect(punchOnCompanyToday('2026-11-11', '2026-11-11')).toBe(true);
  });
  it('refuses a punch the device clock places on another day', () => {
    expect(punchOnCompanyToday('2026-11-10', '2026-11-11')).toBe(false);
    expect(punchOnCompanyToday('2026-11-12', '2026-11-11')).toBe(false);
  });
});
