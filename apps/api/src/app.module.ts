import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { MastersModule } from './masters/masters.module';
import { MeController } from './me/me.controller';
import { OpenApiController } from './openapi/openapi.controller';

@Module({
  imports: [DbModule, AuthModule, FilesModule, MastersModule],
  controllers: [HealthController, OpenApiController, MeController],
})
export class AppModule {}
