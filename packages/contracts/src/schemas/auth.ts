import * as z from 'zod';
import { Id, Timestamp } from './common';
import { Permission, RoleKey } from './roles';

export const SignInEmailBody = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    rememberMe: z.boolean().optional(),
  })
  .meta({ id: 'SignInEmailBody' });
export type SignInEmailBody = z.infer<typeof SignInEmailBody>;

export const SessionInfo = z
  .object({
    session: z.object({ id: z.string(), expiresAt: Timestamp }),
    user: z.object({ id: z.string(), email: z.email(), name: z.string() }),
  })
  .meta({ id: 'SessionInfo' });
export type SessionInfo = z.infer<typeof SessionInfo>;

export const Me = z
  .object({
    id: Id,
    companyId: Id,
    companyName: z.string(),
    email: z.email(),
    name: z.string(),
    employeeCode: z.string().nullable(),
    roles: z.array(RoleKey),
    permissions: z.array(Permission),
    territoryIds: z.array(Id).meta({ description: 'Territories directly assigned to this user' }),
    managerId: Id.nullable(),
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof Me>;
