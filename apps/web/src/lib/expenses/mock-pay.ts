/**
 * Mock mode only: the contract mock ties paying a claim to finance:write (Accountant). The owner
 * decision is that Director and System Admin pay (lib/permissions canPayExpenses), so give those
 * mock personas finance:read + finance:write before the handlers start. The real API is unchanged
 * (docs/CONTRACT-GAPS.md).
 */
import type { Permission } from '@ariforce/contracts';
import { canPayExpenses } from '../permissions';
import type { Role } from '../roles';

type Persona = { roles: string[]; permissions: Permission[] };

export function grantMockPay(users: Persona[]) {
  for (const u of users) {
    if (!canPayExpenses(u.roles[0] as Role)) continue;
    const add = (['finance:read', 'finance:write'] as Permission[]).filter(
      (p) => !u.permissions.includes(p),
    );
    if (add.length) u.permissions = [...u.permissions, ...add];
  }
}
