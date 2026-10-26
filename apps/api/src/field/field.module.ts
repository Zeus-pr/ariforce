import { Module } from '@nestjs/common';
import { CheckInsService } from './checkins.service';
import { DevicesController } from './devices.controller';
import { AttendanceController, CheckInsController, UsersController } from './field.controllers';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [
    CheckInsController,
    AttendanceController,
    UsersController,
    SettingsController,
    DevicesController,
  ],
  providers: [CheckInsService],
  exports: [CheckInsService],
})
export class FieldModule {}
