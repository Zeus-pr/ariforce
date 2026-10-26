import { INestApplication, VersioningType } from '@nestjs/common';

/** Shared app configuration used by main.ts and tests. */
export function configureApp(app: INestApplication) {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  return app;
}
