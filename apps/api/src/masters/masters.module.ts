import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MASTER_CONTROLLERS } from './masters.controllers';
import { MastersService } from './masters.service';

@Module({
  controllers: [ImportsController, ...MASTER_CONTROLLERS],
  providers: [MastersService, ImportsService],
  exports: [MastersService],
})
export class MastersModule {}
