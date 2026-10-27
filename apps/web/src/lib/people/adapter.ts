/**
 * System Admin "People" data layer. The only place that knows the people endpoints.
 * Contract: origin/feat/sysadmin-people (310ae1c). GET /v1/users items carry version, primaryRole, rank,
 * managerName, territories[] (primary first), hasLogin, inviteStatus, lastActiveAt. PATCH
 * /v1/employees/{id} takes {version, name?, email?, employeeCode?, phone?, designation?, joinedOn?,
 * role?, territoryIds?, managerId?, status?: active|suspended}.
 */
import type { components } from '@ariforce/contracts';
import { api, apiReady, toApiError } from '@/lib/api';
import type { Role } from '@/lib/roles';

export type Person = components['schemas']['UserSummary'];
export type PersonPatch = {
  version: number;
  name?: string;
  email?: string;
  phone?: string | null;
  employeeCode?: string | null;
  designation?: string | null;
  joinedOn?: string | null;
  role?: Role;
  territoryIds?: string[];
  managerId?: string | null;
  status?: 'active' | 'suspended';
};
export type PeopleQuery = {
  q?: string;
  role?: Role;
  status?: Person['status'];
  territoryId?: string;
  managerId?: string;
  hasLogin?: 'true' | 'false';
  cursor?: string;
  limit?: number;
};
export type Failure = {
  code: string;
  message: string;
  kind: 'conflict' | 'forbidden' | 'missing' | 'invalid' | 'busy' | 'other';
  /** REPORTS_OUTRANK: the direct reports to reassign first. */
  userIds?: string[];
};

const BY_CODE: Record<string, Omit<Failure, 'code'>> = {
  VERSION_CONFLICT: {
    kind: 'conflict',
    message:
      'Someone else changed this person while you were editing. The latest details are loaded; check them and save again.',
  },
  EMAIL_LOCKED_HAS_LOGIN: {
    kind: 'invalid',
    message: 'This person already signs in, so their email can’t be changed.',
  },
  EMAIL_TAKEN: { kind: 'invalid', message: 'Another person already uses this email.' },
  EMPLOYEE_CODE_TAKEN: {
    kind: 'invalid',
    message: 'Another person already has this employee code.',
  },
  CONFLICT: {
    kind: 'invalid',
    message: 'That manager reports to this person, which would make a loop. Pick someone else.',
  },
  MANAGER_RANK: {
    kind: 'invalid',
    message:
      'Their current manager doesn’t outrank the new role. Pick a new manager along with the role.',
  },
  REPORTS_OUTRANK: {
    kind: 'invalid',
    message:
      'Some direct reports would be at or above the new role. Move them to another manager first.',
  },
  LAST_SYSTEM_ADMIN: {
    kind: 'invalid',
    message: 'The company needs at least one active System Admin, so this one has to stay.',
  },
};

/** Plain-words messages for the errors this screen can hit. */
export function failure(res: unknown): Failure {
  const e = toApiError(res);
  const status = (res as { response?: Response })?.response?.status;
  const known = BY_CODE[e.code];
  if (known) {
    const ids = (e.details as { userIds?: string[] } | undefined)?.userIds;
    return { code: e.code, ...known, ...(ids ? { userIds: ids } : {}) };
  }
  if (status === 409)
    return {
      code: e.code,
      kind: 'invalid',
      message: e.message || 'That clashes with another record.',
    };
  if (status === 403 || e.code === 'FORBIDDEN')
    return {
      code: e.code,
      kind: 'forbidden',
      message: `You can’t make this change. ${e.message}`.trim(),
    };
  if (status === 404 || e.code === 'NOT_FOUND')
    return {
      code: e.code,
      kind: 'missing',
      message: 'This person no longer exists. The list has been refreshed.',
    };
  if (status === 422 || e.code === 'VALIDATION')
    return { code: e.code, kind: 'invalid', message: e.message || 'Some details are not valid.' };
  if (status === 429 || e.code === 'RATE_LIMITED')
    return {
      code: e.code,
      kind: 'busy',
      message: 'Too many changes in a short time. Wait a minute and try again.',
    };
  return { code: e.code, kind: 'other', message: e.message || 'Could not save. Try again.' };
}

export async function listPeople(qy: PeopleQuery) {
  await apiReady();
  const r = await api.GET('/v1/users', {
    params: { query: { limit: 50, sort: 'name', ...qy, q: qy.q || undefined } as never },
  });
  if (r.error || !r.data) throw failure(r);
  return { items: r.data.items, nextCursor: r.data.nextCursor ?? null };
}

/** Latest copy of one person (the directory has no by-id read; search by email and match the id). */
export async function getPerson(p: Pick<Person, 'id' | 'email'>): Promise<Person | null> {
  const { items } = await listPeople({ q: p.email, limit: 20 });
  return items.find((x) => x.id === p.id) ?? null;
}

export async function updatePerson(id: string, patch: PersonPatch) {
  const r = await api.PATCH('/v1/employees/{id}', {
    params: { path: { id } },
    body: patch as never,
  });
  if (r.error) throw failure(r);
}
