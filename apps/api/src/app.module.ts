import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { DcrModule } from './dcr/dcr.module';
import { FieldModule } from './field/field.module';
import { MastersModule } from './masters/masters.module';
import { PlansModule } from './plans/plans.module';
import { MeController } from './me/me.controller';
import { OpenApiController } from './openapi/openapi.controller';

@Module({
  imports: [DbModule, AuthModule, FilesModule, MastersModule, FieldModule, PlansModule, DcrModule],
  controllers: [HealthController, OpenApiController, MeController],
})
export class AppModule {}
