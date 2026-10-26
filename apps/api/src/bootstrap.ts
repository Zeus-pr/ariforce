import { VersioningType, type INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express } from 'express';
import { AUTH_BASE_PATH } from './auth/auth';
import { AuthService } from './auth/auth.service';

/**
 * Shared app configuration used by main.ts and tests. The app must be created with
 * `bodyParser: false`: better-auth reads the raw body, so it is mounted first and JSON parsing after.
 */
export function configureApp(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  server.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(app.get(AuthService).auth));
  app.use(express.json({ limit: '1mb' }));
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));
  app.enableShutdownHooks();
  return app;
}
