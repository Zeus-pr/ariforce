import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from '../../contracts/src/schemas/roles';
import { ROLE_PERMISSIONS_MIGRATION, rolePermissionsSql } from '../src/role-permissions-sql';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Parse "UPDATE roles SET permissions = ARRAY[...] WHERE key::text = 'k'" back into a matrix. */
function parse(sql: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of sql.matchAll(
    /SET permissions = ARRAY\[([^\]]*)\]::text\[\]\s*WHERE key::text = '(\w+)'/g,
  ))
    out[m[2]!] = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  return out;
}

describe('migration 0019 role permissions', () => {
  const src = read(`../drizzle/${ROLE_PERMISSIONS_MIGRATION}.sql`);
  const gen = read(`../migrations/${ROLE_PERMISSIONS_MIGRATION}.sql`);
  it('drizzle file equals the generator output', () => expect(src).toBe(rolePermissionsSql()));
  it('covers every role with exactly DEFAULT_ROLE_PERMISSIONS (both files)', () => {
    for (const sql of [src, gen]) {
      const m = parse(sql);
      expect(Object.keys(m).sort()).toEqual([...ROLE_KEYS].sort());
      for (const k of ROLE_KEYS)
        expect(m[k]).toEqual([...new Set(DEFAULT_ROLE_PERMISSIONS[k])].sort());
    }
  });
  it('keeps the masters rule', () => {
    const m = parse(src);
    for (const k of [
      'business_manager',
      'area_business_manager',
      'distribution_head',
      'accountant',
    ])
      expect(m[k]).not.toContain('masters:write');
    for (const k of [
      'regional_business_manager',
      'zonal_business_manager',
      'sales_manager',
      'general_manager',
      'vice_president',
      'director',
      'system_admin',
    ])
      expect(m[k]).toEqual(
        expect.arrayContaining(['masters:write', 'territories:write', 'imports:write']),
      );
    expect(m.distribution_head).not.toContain('masters:read');
    expect(m.accountant).not.toContain('stockists:read');
  });
  it('SETs, never appends, and touches only permissions', () => {
    expect(src).not.toMatch(/\|\||array_append|array_cat|updated_at/);
  });
});
