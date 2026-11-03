import type { KpiReport } from '@ariforce/contracts';
import { isApprover, type Role } from '@/lib/roles';

type Rollup = KpiReport['rollup'];

/** The widest rollup the contract allows this role (docs/kpi-definitions.md). */
export function rollupFor(role: Role): Rollup {
  if (role === 'director') return 'company';
  return isApprover(role) ? 'team' : 'self';
}
