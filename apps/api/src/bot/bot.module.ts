import { Module } from '@nestjs/common';
import { KpisModule } from '../kpis/kpis.module';
import { TeamModule } from '../team/team.module';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { BotTools } from './bot.tools';

@Module({
  imports: [TeamModule, KpisModule],
  controllers: [BotController],
  providers: [BotService, BotTools],
})
export class BotModule {}
