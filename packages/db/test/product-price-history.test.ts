import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const file = (f: string) =>
  readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8');

describe('product prices migrations (0032, 0033)', () => {
  it('0032: idempotent, RLS forced, append-only, app role insert+select only', () => {
    const s = file('0032_product_price_history');
    expect(s).toContain('CREATE TABLE IF NOT EXISTS "product_price_history"');
    expect(s).toContain('ALTER TABLE product_price_history FORCE ROW LEVEL SECURITY');
    expect(s).toContain('CREATE POLICY tenant_isolation ON product_price_history');
    expect(s).toContain('product_price_history_no_update BEFORE UPDATE OR DELETE');
    expect(s).toContain('product_price_history_no_truncate BEFORE TRUNCATE');
    expect(s).toContain('GRANT SELECT, INSERT ON product_price_history TO ariforce_app');
    expect(s).not.toMatch(/GRANT[^;]*UPDATE[^;]*product_price_history/);
    expect(s).toContain('ariforce_migrations');
  });
  it('0033: generated role permissions grant products:prices to system_admin only', () => {
    const s = file('0033_role_permissions_prices');
    const lines = s.split('\n').filter((l) => l.includes("'products:prices'"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/system_admin|ARRAY/);
    const blocks = s.split('--> statement-breakpoint');
    const withPerm = blocks.filter((b) => b.includes("'products:prices'"));
    expect(withPerm).toHaveLength(1);
    expect(withPerm[0]).toContain("key::text = 'system_admin'");
  });
});
describe.skipIf(!OWNER || !APP)('product_price_history (live)', () => {
  it('table exists with FORCE RLS', async () => {
    const { Pool } = await import('pg');
    const owner = new Pool({ connectionString: OWNER });
    try {
      const r = await owner.query(
        `select relforcerowsecurity from pg_class where relname = 'product_price_history'`,
      );
      expect(r.rows[0].relforcerowsecurity).toBe(true);
    } finally {
      await owner.end();
    }
  });
});
