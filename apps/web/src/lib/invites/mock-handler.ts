/** Mock mode only: accepts invite tokens the local team adapter issued; others fall through to the contract mock. */
import { http, HttpResponse } from 'msw';
import { acceptMockInvite, isMockWebToken } from './mock-store';

export function mockInviteAccept(base: string) {
  return [
    http.post(`${base}/v1/invites/accept`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => null)) as { token?: string; password?: string } | null;
      if (!b?.token || !isMockWebToken(b.token)) return undefined;
      if (!b.password || b.password.length < 8)
        return HttpResponse.json({ error: { code: 'VALIDATION', message: 'Invalid' } }, { status: 422 });
      if (acceptMockInvite(b.token) !== 'ok')
        return HttpResponse.json({ error: { code: 'INVITE_INVALID', message: 'Invalid, used, revoked or expired invite' } }, { status: 404 });
      return HttpResponse.json({ userId: '00000000-0000-4000-8000-00000000a001', email: 'invited@example.test' });
    }),
  ];
}
