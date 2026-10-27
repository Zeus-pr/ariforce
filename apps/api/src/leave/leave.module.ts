import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

@Module({
  imports: [PlansModule],
  controllers: [LeaveController],
  providers: [LeaveService],
})
export class LeaveModule {}
