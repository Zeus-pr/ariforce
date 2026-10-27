import { Module } from '@nestjs/common';
import { SfcController } from './sfc.controller';
import { SfcService } from './sfc.service';

@Module({ controllers: [SfcController], providers: [SfcService] })
export class SfcModule {}
