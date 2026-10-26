/**
 * Mock mode only: answer masters writes from read-only roles (ABM, BM) with the API's 403, so the
 * mock behaves like the real API's masters rule (docs/PERMISSIONS.md). Runs before the contract
 * mocks; requests from writers fall through to them.
 */
import { http, HttpResponse } from 'msw';
import { SESSION_KEY } from './auth-boot';
import { canWriteMasters } from './permissions';
import type { Role } from './roles';

function currentRole(): Role | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as {
      role?: Role;
      previewRole?: Role;
    } | null;
    return s?.previewRole ?? s?.role ?? null;
  } catch {
    return null;
  }
}

export function mastersWriteGuard(base: string) {
  const forbid = () => {
    const role = currentRole();
    if (!role || canWriteMasters(role)) return undefined;
    return HttpResponse.json(
      {
        error: { code: 'FORBIDDEN', message: 'Your role can view master data but not change it.' },
      },
      { status: 403 },
    );
  };
  return ['doctors', 'chemists', 'stockists'].flatMap((k) => [
    http.post(`${base}/v1/${k}`, forbid),
    http.post(`${base}/v1/${k}/import`, forbid),
    http.patch(`${base}/v1/${k}/:id`, forbid),
    http.delete(`${base}/v1/${k}/:id`, forbid),
  ]);
}
