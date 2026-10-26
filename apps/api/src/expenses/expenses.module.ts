import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PlansModule } from '../plans/plans.module';
import {
  ExpenseAttachmentsController,
  ExpenseClaimsController,
  ExpenseReportsController,
} from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [PlansModule, FilesModule],
  controllers: [ExpenseClaimsController, ExpenseAttachmentsController, ExpenseReportsController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
