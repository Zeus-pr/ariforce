import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalsController,
  TourPlanItemsController,
  TourPlansController,
} from './plans.controllers';
import { TourPlanItemsService } from './tp-items.service';
import { TourPlansService } from './tour-plans.service';

@Module({
  controllers: [TourPlanItemsController, TourPlansController, ApprovalsController],
  providers: [ApprovalsService, TourPlansService, TourPlanItemsService],
  exports: [ApprovalsService],
})
export class PlansModule {}
