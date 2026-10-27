/** Mock mode only: accepts invite tokens the local team adapter issued; others fall through to the contract mock. */
import { http, HttpResponse } from 'msw';
import { INVITE_PASSWORD_MIN } from '@ariforce/contracts';
import { acceptMockInvite, isMockWebToken } from './mock-store';

const ERR = { invalid: [404, 'INVITE_INVALID'], used: [409, 'INVITE_USED'], expired: [410, 'INVITE_EXPIRED'] } as const;

export function mockInviteAccept(base: string) {
  return [
    http.post(`${base}/v1/invites/accept`, async ({ request }) => {
      const b = (await request.clone().json().catch(() => null)) as { token?: string; password?: string } | null;
      if (!b?.token || !isMockWebToken(b.token)) return undefined;
      if (!b.password || b.password.length < INVITE_PASSWORD_MIN)
        return HttpResponse.json(
          { error: { code: 'VALIDATION', message: `Password must be at least ${INVITE_PASSWORD_MIN} characters` } },
          { status: 422 },
        );
      const res = acceptMockInvite(b.token);
      if (res !== 'ok') {
        const [status, code] = ERR[res];
        return HttpResponse.json({ error: { code, message: code } }, { status });
      }
      return HttpResponse.json({ userId: '00000000-0000-4000-8000-00000000a001', email: 'invited@example.test' });
    }),
  ];
}
