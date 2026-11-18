import { sql } from 'drizzle-orm';
import type { Tx } from '@ariforce/db';

export const OUTLET_CODE_PREFIX = {
  doctor: 'ARIDOC',
  chemist: 'ARICHM',
  stockist: 'ARISTK',
} as const;

export type OutletCodeKind = keyof typeof OUTLET_CODE_PREFIX;

const TABLE = {
  doctor: 'doctors',
  chemist: 'chemists',
  stockist: 'stockists',
} as const;

function pattern(kind: OutletCodeKind) {
  return new RegExp(`^${OUTLET_CODE_PREFIX[kind]}\\d{6}$`);
}

function rowsOf(result: unknown) {
  return ((result as { rows?: Record<string, unknown>[] }).rows ??
    (result as Record<string, unknown>[])) as Record<string, unknown>[];
}

async function lock(tx: Tx, companyId: string, kind: OutletCodeKind) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${kind}))`);
}

async function maxNumber(tx: Tx, companyId: string, kind: OutletCodeKind) {
  const prefix = OUTLET_CODE_PREFIX[kind];
  const result = await tx.execute(sql`
    select coalesce(max(substring(code from 7)::int), 0) as n
      from ${sql.raw(TABLE[kind])}
     where company_id = ${companyId}::uuid
       and code ~ ${`^${prefix}[0-9]{6}$`}
  `);
  return Number(rowsOf(result)[0]?.n ?? 0);
}

function format(kind: OutletCodeKind, n: number) {
  return `${OUTLET_CODE_PREFIX[kind]}${String(n).padStart(6, '0')}`;
}

/** The next code. Does not reserve it. */
export async function previewOutletCode(tx: Tx, companyId: string, kind: OutletCodeKind) {
  return format(kind, (await maxNumber(tx, companyId, kind)) + 1);
}

/** Use the requested code when it is still free. Otherwise take the next number. */
export async function assignOutletCode(
  tx: Tx,
  companyId: string,
  kind: OutletCodeKind,
  requested?: unknown,
) {
  await lock(tx, companyId, kind);
  const want = typeof requested === 'string' && pattern(kind).test(requested) ? requested : null;
  if (want) {
    const taken = await tx.execute(sql`
      select 1 as hit from ${sql.raw(TABLE[kind])}
       where company_id = ${companyId}::uuid and code = ${want}
       limit 1
    `);
    if (!rowsOf(taken).length) return want;
  }
  return format(kind, (await maxNumber(tx, companyId, kind)) + 1);
}
