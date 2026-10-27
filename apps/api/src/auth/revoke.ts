import { authSession, users, type Tx } from '@ariforce/db';
import { eq, inArray } from 'drizzle-orm';

/**
 * Deletes every better-auth session (cookie and bearer) of a tenant user (#79), in the caller's
 * transaction so it commits with the status/role change. Returns the number of sessions revoked.
 * The next request with an old cookie or token gets 401.
 */
export async function revokeUserSessions(tx: Tx, userId: string): Promise<number> {
  const [u] = await tx.select({ a: users.authUserId }).from(users).where(eq(users.id, userId));
  if (!u?.a) return 0;
  const gone = await tx
    .delete(authSession)
    .where(inArray(authSession.userId, [u.a]))
    .returning({ id: authSession.id });
  return gone.length;
}
