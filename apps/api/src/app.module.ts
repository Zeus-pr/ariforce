import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FilesModule } from './files/files.module';
import { HealthController } from './health/health.controller';
import { WorkTypesCheck } from './health/work-types.check';
import { DcrModule } from './dcr/dcr.module';
import { KpisModule } from './kpis/kpis.module';
import { FieldModule } from './field/field.module';
import { MastersModule } from './masters/masters.module';
import { PlansModule } from './plans/plans.module';
import { TeamModule } from './team/team.module';
import { ExpensesModule } from './expenses/expenses.module';
import { LeaveModule } from './leave/leave.module';
import { MeController } from './me/me.controller';
import { OpenApiController } from './openapi/openapi.controller';

@Module({
  imports: [
    DbModule,
    AuthModule,
    FilesModule,
    MastersModule,
    FieldModule,
    PlansModule,
    DcrModule,
    KpisModule,
    ExpensesModule,
    LeaveModule,
    TeamModule,
  ],
  controllers: [HealthController, OpenApiController, MeController],
  providers: [WorkTypesCheck],
})
export class AppModule {}
