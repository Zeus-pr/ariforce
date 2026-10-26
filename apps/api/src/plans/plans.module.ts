import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController, TourPlansController } from './plans.controllers';
import { TourPlansService } from './tour-plans.service';

@Module({
  controllers: [TourPlansController, ApprovalsController],
  providers: [ApprovalsService, TourPlansService],
  exports: [ApprovalsService],
})
export class PlansModule {}
