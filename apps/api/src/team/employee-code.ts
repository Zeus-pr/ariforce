import { sql } from 'drizzle-orm';
import type { Tx } from '@ariforce/db';

/** Family codes. A promotion stays in the same family, so the number never changes with rank. */
const FAMILY: Record<string, string> = {
  director: 'ARIDIR',
  business_manager: 'ARISLS',
  area_business_manager: 'ARISLS',
  regional_business_manager: 'ARISLS',
  zonal_business_manager: 'ARISLS',
  sales_manager: 'ARISLS',
  general_manager: 'ARISLS',
  vice_president: 'ARISLS',
  system_admin: 'ARIADM',
  hr: 'ARIHRM',
  distribution_head: 'ARIDST',
  accountant: 'ARIACC',
};

export function codeFamily(role: string) {
  return FAMILY[role] ?? 'ARIOTH';
}

export function formatEmployeeCode(family: string, n: number) {
  return `${family}${String(n).padStart(6, '0')}`;
}

function rowsOf(result: unknown) {
  return ((result as { rows?: Record<string, unknown>[] }).rows ??
    (result as Record<string, unknown>[])) as Record<string, unknown>[];
}

/** Next free number in the family. Numbers already used, including by suspended people, are skipped. */
export async function nextEmployeeCode(tx: Tx, companyId: string, role: string) {
  const family = codeFamily(role);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${family}))`);
  const result = await tx.execute(sql`
    select coalesce(max(substring(employee_code from 7)::int), 0) as n
      from users
     where company_id = ${companyId}::uuid
       and employee_code ~ ${`^${family}[0-9]{6}$`}
  `);
  return formatEmployeeCode(family, Number(rowsOf(result)[0]?.n ?? 0) + 1);
}
