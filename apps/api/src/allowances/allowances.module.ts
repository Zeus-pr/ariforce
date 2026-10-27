import { Module } from '@nestjs/common';
import { AllowancesController } from './allowances.controller';
import { AllowancesService } from './allowances.service';

@Module({ controllers: [AllowancesController], providers: [AllowancesService] })
export class AllowancesModule {}
