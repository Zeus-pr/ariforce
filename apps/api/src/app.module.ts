import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { OpenApiController } from './openapi/openapi.controller';

@Module({ controllers: [HealthController, OpenApiController] })
export class AppModule {}
