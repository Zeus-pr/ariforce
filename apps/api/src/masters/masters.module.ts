import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MASTER_CONTROLLERS } from './masters.controllers';
import { MastersService } from './masters.service';

@Module({
  imports: [PlansModule],
  controllers: [DoctorsController, ImportsController, ...MASTER_CONTROLLERS],
  providers: [MastersService, ImportsService, DoctorsService],
  exports: [MastersService],
})
export class MastersModule {}
