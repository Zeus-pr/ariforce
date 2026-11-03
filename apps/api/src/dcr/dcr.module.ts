import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { FilesModule } from '../files/files.module';
import { PlansModule } from '../plans/plans.module';
import { DcrController, RcpaController } from './dcr.controller';
import { DcrFlowService } from './dcr-flow.service';
import { DcrReviewService } from './dcr-review.service';
import { DcrService } from './dcr.service';
import { ExpenseAutoDraftService } from '../expenses/auto-draft.service';

@Module({
  imports: [FieldModule, PlansModule, FilesModule],
  controllers: [DcrController, RcpaController],
  providers: [DcrService, DcrFlowService, DcrReviewService, ExpenseAutoDraftService],
  exports: [DcrService],
})
export class DcrModule {}
