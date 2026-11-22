import { Module } from '@nestjs/common';
import { DcrModule } from '../dcr/dcr.module';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { KpisModule } from '../kpis/kpis.module';
import { LeaveModule } from '../leave/leave.module';
import { MastersModule } from '../masters/masters.module';
import { PlansModule } from '../plans/plans.module';
import { StockStatementsModule } from '../stock-statements/stock-statements.module';
import { TeamModule } from '../team/team.module';
import { BotController } from './bot.controller';
import { BotRecords } from './bot.records';
import { BotService } from './bot.service';
import { BotTools } from './bot.tools';

@Module({
  imports: [
    TeamModule,
    KpisModule,
    MastersModule,
    DcrModule,
    PlansModule,
    LeaveModule,
    ExpensesModule,
    StockStatementsModule,
    ExceptionsModule,
  ],
  controllers: [BotController],
  providers: [BotService, BotTools, BotRecords],
})
export class BotModule {}
