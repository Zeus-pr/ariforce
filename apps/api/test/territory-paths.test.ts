import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { childPath } from '../src/masters/imports.service';

const OWNER = process.env.DIRECT_URL;
const PID = '01930000-0000-7000-8000-0000000000aa';
const ID = '01930000-0000-7000-8000-0000000000bb';

/** Real paths are code-based (WB.HQ_MALDA); seed and older imports use ids. */
describe('territory path convention', () => {
  it('follows a code-based parent with a normalised code segment', () => {
    expect(childPath(PID, 'WB.HQ_BURDWAN', 'HQ-BURDWAN-BMCH', ID, new Set())).toBe(
      'WB.HQ_BURDWAN.HQ_BURDWAN_BMCH',
    );
  });
  it('follows an id-based parent with an id segment', () => {
    expect(childPath(PID, `X.${PID}`, 'HQ-1', ID, new Set())).toBe(`X.${PID}.${ID}`);
  });
  it('falls back to the id when the code path is taken; roots use the id', () => {
    expect(childPath(PID, 'WB', 'HQ_A', ID, new Set(['WB.HQ_A']))).toBe(`WB.${ID}`);
    expect(childPath(null, null, 'WB', ID, new Set())).toBe(ID);
  });
});

describe.skipIf(!OWNER)('subtree prefix test ignores LIKE wildcards', () => {
  it('starts_with does not treat _ as a wildcard; kpi view uses it', async () => {
    const pool = new Pool({ connectionString: OWNER });
    try {
      const r = await pool.query(
        `select 'WB.HQxMALDA.A' like 'WB.HQ_MALDA' || '.%' as like_hit,
                starts_with('WB.HQxMALDA.A', 'WB.HQ_MALDA' || '.') as sw_hit,
                starts_with('WB.HQ_MALDA.A', 'WB.HQ_MALDA' || '.') as sw_own,
                pg_get_viewdef('kpi_user_doctor_list'::regclass) as def`,
      );
      expect(r.rows[0]).toMatchObject({ like_hit: true, sw_hit: false, sw_own: true });
      expect(r.rows[0].def).toContain('starts_with');
      expect(r.rows[0].def).not.toMatch(/~~/);
    } finally {
      await pool.end();
    }
  });
});
