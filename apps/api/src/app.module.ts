import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { DoctorsController } from './doctors/doctors.controller';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { OpenApiController } from './openapi/openapi.controller';

@Module({
  imports: [DbModule, AuthModule, FilesModule],
  controllers: [HealthController, OpenApiController, MeController, DoctorsController],
})
export class AppModule {}
