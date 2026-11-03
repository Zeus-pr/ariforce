import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { assertNoSubmittedDcr, leaveDcrConflict } from '../src/leave/leave.util';

const pg = new PgDialect();
/** Fake tx: records each statement, answers the DCR lookup with `rows`. */
function fakeTx(rows: { id: string; date: string }[]) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const r = pg.sqlToQuery(q);
      seen.push(r);
      return { rows: r.sql.includes('from dcrs d') ? rows : [] };
    },
  };
  return { tx: tx as never, seen };
}

describe('leaveDcrConflict', () => {
  it('is null without submitted DCRs', () => {
    expect(leaveDcrConflict([])).toBeNull();
  });
  it('returns sorted unique dates and ids', () => {
    expect(
      leaveDcrConflict([
        { id: 'b', date: '2026-10-30' },
        { id: 'a', date: '2026-10-29' },
        { id: 'b', date: '2026-10-30' },
      ]),
    ).toEqual({ dates: ['2026-10-29', '2026-10-30'], dcrIds: ['a', 'b'] });
  });
});

describe('assertNoSubmittedDcr', () => {
  it('locks first, queries submitted DCRs only over the whole leave range', async () => {
    const { tx, seen } = fakeTx([]);
    await expect(
      assertNoSubmittedDcr(tx, 'u1', '2026-10-29', '2026-10-31'),
    ).resolves.toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]!.sql).toContain('pg_advisory_xact_lock(hashtextextended(');
    expect(seen[0]!.params).toEqual(['ariforce:dcr-leave:u1']);
    expect(seen[1]!.sql).toContain(
      "(d.deleted_at is null and d.status in ('submitted', 'approved'))",
    );
    expect(seen[1]!.sql).toContain('d.date between');
    expect(seen[1]!.params).toEqual(['u1', '2026-10-29', '2026-10-31']);
  });
  it('throws 409 LEAVE_DCR_CONFLICT with dates and dcrIds', async () => {
    const { tx } = fakeTx([{ id: 'dcr-1', date: '2026-10-29' }]);
    const e = (await assertNoSubmittedDcr(tx, 'u1', '2026-10-29', '2026-10-29').catch(
      (x: unknown) => x,
    )) as { getStatus(): number; getResponse(): unknown };
    expect(e.getStatus()).toBe(409);
    expect(JSON.stringify(e.getResponse())).toContain('LEAVE_DCR_CONFLICT');
    expect(JSON.stringify(e.getResponse())).toContain('"dates":["2026-10-29"]');
    expect(JSON.stringify(e.getResponse())).toContain('"dcrIds":["dcr-1"]');
  });
});
