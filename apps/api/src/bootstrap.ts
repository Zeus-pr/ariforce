import { VersioningType, type INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';
import { AUTH_BASE_PATH, webOrigins } from './auth/auth';

/** Our own public routes under /v1/auth, handled by Nest rather than better-auth. */
const NEST_AUTH_PATHS = new Set([
  `${AUTH_BASE_PATH}/sign-up-request`,
  `${AUTH_BASE_PATH}/sign-up-options`,
]);
import { AuthService } from './auth/auth.service';

/**
 * Shared app configuration used by main.ts and tests. The app must be created with
 * `bodyParser: false`: better-auth reads the raw body, so it is mounted first and JSON parsing after.
 */
export function configureApp(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  // CORS must run before the better-auth handler so sign-in/out also get the headers.
  app.enableCors({ origin: webOrigins(), credentials: true });
  const authHandler = toNodeHandler(app.get(AuthService).auth);
  // Our own public sign-up request route lives under /v1/auth but is handled by Nest.
  server.all(`${AUTH_BASE_PATH}/*splat`, (req, res, next) =>
    NEST_AUTH_PATHS.has(req.path) ? next() : authHandler(req, res),
  );
  app.use(express.json({ limit: '1mb' }));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));
  app.enableShutdownHooks();
  return app;
}
