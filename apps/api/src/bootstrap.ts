import { INestApplication, VersioningType } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';

/** Shared app configuration used by main.ts and tests. */
export function configureApp(app: INestApplication) {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));
  app.enableShutdownHooks();
  return app;
}
