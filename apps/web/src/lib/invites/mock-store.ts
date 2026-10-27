/**
 * Mock mode only: invite tokens issued by the local team adapter, kept in localStorage so the /invite
 * page (a fresh tab) can accept them. Real mode never touches this.
 */
const KEY = 'af:mock-invites';
type Row = { userId: string; expiresAt: string; used: boolean };

const read = (): Record<string, Row> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Row>;
  } catch {
    return {};
  }
};
const write = (v: Record<string, Row>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

/** Issues a token for `userId`, revoking earlier unused ones (like the API). */
export function issueMockInvite(userId: string, days = 7) {
  const all = read();
  for (const [t, r] of Object.entries(all)) if (r.userId === userId && !r.used) delete all[t];
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = `mock-web-invite-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const expiresAt = new Date(Date.now() + days * 864e5).toISOString();
  all[token] = { userId, expiresAt, used: false };
  write(all);
  return { token, expiresAt };
}

/** 'ok' marks it used; otherwise why it can't be used. */
export function acceptMockInvite(token: string): 'ok' | 'invalid' {
  const all = read();
  const r = all[token];
  if (!r || r.used || Date.parse(r.expiresAt) < Date.now()) return 'invalid';
  r.used = true;
  write(all);
  return 'ok';
}
export const isMockWebToken = (t: string) => t.startsWith('mock-web-invite-');
