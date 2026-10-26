import * as z from 'zod';
import { Id } from './common';

export const ROLE_KEYS = [
  'rep',
  'area_manager',
  'regional_manager',
  'zonal_manager',
  'national_head',
  'admin',
] as const;
export const RoleKey = z.enum(ROLE_KEYS).meta({ id: 'RoleKey' });
export type RoleKey = z.infer<typeof RoleKey>;

/** Rank: higher sees more of the hierarchy. Admin is company-wide. */
export const ROLE_RANK: Record<RoleKey, number> = {
  rep: 1,
  area_manager: 2,
  regional_manager: 3,
  zonal_manager: 4,
  national_head: 5,
  admin: 6,
};

export const PERMISSIONS = [
  'me:read',
  'roles:read',
  'territories:read',
  'territories:write',
  'users:read',
  'users:write',
  'masters:read',
  'masters:write',
  'audit:read',
] as const;
export const Permission = z.enum(PERMISSIONS).meta({ id: 'Permission' });
export type Permission = z.infer<typeof Permission>;

export const Role = z
  .object({
    id: Id,
    key: RoleKey,
    name: z.string(),
    rank: z.int(),
    permissions: z.array(Permission),
  })
  .meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;
export const RoleList = z.object({ items: z.array(Role) }).meta({ id: 'RoleList' });
