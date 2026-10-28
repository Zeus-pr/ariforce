import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PlansModule } from '../plans/plans.module';
import { DcrController, RcpaController } from './dcr.controller';
import { DcrFlowService } from './dcr-flow.service';
import { DcrService } from './dcr.service';

@Module({
  imports: [FieldModule, PlansModule],
  controllers: [DcrController, RcpaController],
  providers: [DcrService, DcrFlowService],
})
export class DcrModule {}
