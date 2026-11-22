import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

@Module({
  imports: [PlansModule],
  controllers: [LeaveController, HolidaysController],
  providers: [LeaveService, HolidaysService],
  exports: [LeaveService],
})
export class LeaveModule {}
