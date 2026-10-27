import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/** Internal header the API sets (overwriting any client value) so better-auth sees the same IP. */
export const CLIENT_IP_HEADER = 'x-ariforce-client-ip';

/** `cloudflare` = behind Cloudflare (proxied DNS or Tunnel); anything else = direct socket. */
export const clientIpMode = () =>
  process.env.CLIENT_IP_MODE === 'cloudflare' ? 'cloudflare' : 'socket';

const norm = (ip: string | undefined | null) => {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/, '');
  return isIP(v) ? v : null;
};

/**
 * Trusted client IP (#77). CF-Connecting-IP only when CLIENT_IP_MODE=cloudflare (the origin must
 * be reachable only through Cloudflare); otherwise the TCP peer. X-Forwarded-For is never used.
 */
export function clientIp(req: IncomingMessage): string | null {
  if (clientIpMode() === 'cloudflare') {
    const cf = req.headers['cf-connecting-ip'];
    const v = norm(Array.isArray(cf) ? cf[0] : cf);
    if (v) return v;
  }
  return norm(req.socket?.remoteAddress);
}
