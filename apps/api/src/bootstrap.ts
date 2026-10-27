import { VersioningType, type INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { AUTH_BASE_PATH, webOrigins } from './auth/auth';

/** Our own public routes under /v1/auth, handled by Nest rather than better-auth. */
const NEST_AUTH_PATHS = new Set([
  `${AUTH_BASE_PATH}/sign-up-request`,
  `${AUTH_BASE_PATH}/sign-up-options`,
]);
import { AuthService } from './auth/auth.service';
import { CLIENT_IP_HEADER, clientIp } from './common/client-ip';
import { LIMITS, rateLimitStore } from './common/rate-limit';

/** Production hides /docs and /openapi.json and enables HSTS. */
export const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Shared app configuration used by main.ts and tests. The app must be created with
 * `bodyParser: false`: better-auth reads the raw body, so it is mounted first and JSON parsing after.
 */
export function configureApp(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  server.disable('x-powered-by');
  // Security headers for a JSON API (#81): nothing may be framed, loaded or executed from our responses.
  const strict = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProd() ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  // The dev-only API reference page loads its UI from a CDN: same headers minus CSP there.
  const docsPage = helmet({ contentSecurityPolicy: false, hsts: false });
  server.use((req, res, next) =>
    !isProd() && req.path.startsWith('/docs') ? docsPage(req, res, next) : strict(req, res, next),
  );
  // CORS must run before the better-auth handler so sign-in/out also get the headers.
  // Strict: only WEB_ORIGIN origins. Expose Retry-After (429 back-off) and Content-Disposition
  // (export file names) to the web app's fetch.
  app.enableCors({
    origin: webOrigins(),
    credentials: true,
    exposedHeaders: ['Retry-After', 'Content-Disposition'],
  });
  const authHandler = toNodeHandler(app.get(AuthService).auth);
  // Our own public sign-up request route lives under /v1/auth but is handled by Nest.
  // Trusted client IP for every request (never X-Forwarded-For), exposed to better-auth (#77).
  server.use((req, _res, next) => {
    const ip = clientIp(req);
    if (ip) req.headers[CLIENT_IP_HEADER] = ip;
    else delete req.headers[CLIENT_IP_HEADER];
    next();
  });
  server.all(`${AUTH_BASE_PATH}/*splat`, async (req, res, next) => {
    if (NEST_AUTH_PATHS.has(req.path)) return next();
    // Shared per-IP limits in front of better-auth: stricter on sign-in.
    if (req.method === 'POST') {
      const ip = clientIp(req) ?? '?';
      const signIn = req.path.startsWith(`${AUTH_BASE_PATH}/sign-in`);
      const rule = signIn ? LIMITS.signIn() : LIMITS.authOther();
      const r = await rateLimitStore().hit(
        `auth:${signIn ? 'sign-in' : 'other'}:ip:${ip}`,
        rule.limit,
        rule.windowMs,
      );
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.retryAfter));
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests; try again later',
            details: { retryAfterSeconds: r.retryAfter },
          },
        });
        return;
      }
    }
    return authHandler(req, res);
  });
  app.use(express.json({ limit: '1mb' }));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // API reference only outside production (#81); /openapi.json is hidden by its controller.
  if (!isProd()) app.use('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));
  app.enableShutdownHooks();
  return app;
}
