import { Module } from '@nestjs/common';
import { DcrModule } from '../dcr/dcr.module';
import { KpisModule } from '../kpis/kpis.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [DcrModule, KpisModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
