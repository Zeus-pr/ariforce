import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import { masterReadPermission, type Permission } from '../schemas/roles';

/** Master collections; writes need masters:write (territories: territories:write). */
export const MASTER_PATHS = [
  'doctors',
  'chemists',
  'stockists',
  'products',
  'divisions',
  'territories',
  'work-types',
  'product-hq-mappings',
  'specialties',
  'doctor-categories',
] as const;

/**
 * Same gate as the API: masters writes (create/edit/deactivate/import) need RBM+ or system_admin.
 * Registered before the data handlers; returns undefined (falls through) when allowed.
 */
export function mastersGuardHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const deny = (perm: Permission) =>
    HttpResponse.json(
      { error: { code: 'FORBIDDEN', message: `Missing permission: ${perm}` } },
      { status: 403 },
    );
  const check = (request: Request, perms: Permission[]) => {
    const p = who(request);
    if (!p) return undefined; // data handler answers 401
    const missing = perms.find((x) => !p.permissions.includes(x));
    return missing ? deny(missing) : undefined;
  };
  return [
    ...MASTER_PATHS.flatMap((m) => {
      const w: Permission = m === 'territories' ? 'territories:write' : 'masters:write';
      return [
        http.get(`${baseUrl}/v1/${m}`, ({ request }) => check(request, [masterReadPermission(m)])),
        http.get(`${baseUrl}/v1/${m}/:id`, ({ request }) =>
          check(request, [masterReadPermission(m)]),
        ),
        http.post(`${baseUrl}/v1/${m}/import`, ({ request }) =>
          check(request, ['imports:write', w]),
        ),
        http.post(`${baseUrl}/v1/${m}`, ({ request }) => check(request, [w])),
        http.patch(`${baseUrl}/v1/${m}/:id`, ({ request }) => check(request, [w])),
        http.delete(`${baseUrl}/v1/${m}/:id`, ({ request }) => check(request, [w])),
      ];
    }),
    http.get(`${baseUrl}/v1/imports/:id`, ({ request }) => check(request, ['imports:write'])),
  ];
}
