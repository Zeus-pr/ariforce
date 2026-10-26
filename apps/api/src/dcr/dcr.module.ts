import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PlansModule } from '../plans/plans.module';
import { DcrController } from './dcr.controller';
import { DcrService } from './dcr.service';

@Module({
  imports: [FieldModule, PlansModule],
  controllers: [DcrController],
  providers: [DcrService],
})
export class DcrModule {}
