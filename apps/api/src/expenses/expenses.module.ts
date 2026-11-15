import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PlansModule } from '../plans/plans.module';
import {
  ExpenseAttachmentsController,
  ExpenseClaimsController,
  ExpenseReportsController,
} from './expenses.controller';
import { ExpenseAutoDraftService } from './auto-draft.service';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [PlansModule, FilesModule],
  controllers: [ExpenseClaimsController, ExpenseAttachmentsController, ExpenseReportsController],
  providers: [ExpensesService, ExpenseAutoDraftService],
})
export class ExpensesModule {}
