import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/** Internal header the API sets (overwriting any client value) so better-auth sees the same IP. */
export const CLIENT_IP_HEADER = 'x-ariforce-client-ip';

/** Forwarded IPs are trusted only in an explicitly configured deployment. */
export const clientIpMode = () => {
  const mode = process.env.CLIENT_IP_MODE;
  return mode === 'cloudflare' || mode === 'railway' ? mode : 'socket';
};

const norm = (ip: string | undefined | null) => {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/, '');
  return isIP(v) ? v : null;
};

/**
 * Cloudflare mode requires an origin reachable only through Cloudflare. Railway mode requires all
 * ingress to pass through its HTTP edge or trusted private services; no raw TCP proxy is allowed.
 * X-Forwarded-For is never used.
 */
export function clientIp(req: IncomingMessage): string | null {
  const mode = clientIpMode();
  if (mode === 'cloudflare' || mode === 'railway') {
    const forwarded = req.headers[mode === 'cloudflare' ? 'cf-connecting-ip' : 'x-real-ip'];
    const v = norm(
      Array.isArray(forwarded) ? (mode === 'cloudflare' ? forwarded[0] : undefined) : forwarded,
    );
    if (v) return v;
  }
  return norm(req.socket?.remoteAddress);
}
