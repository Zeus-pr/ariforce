import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PlansModule } from '../plans/plans.module';
import { StockStatementsController } from './stock-statements.controller';
import { StockStatementsService } from './stock-statements.service';

@Module({
  imports: [PlansModule, FilesModule],
  controllers: [StockStatementsController],
  providers: [StockStatementsService],
})
export class StockStatementsModule {}
