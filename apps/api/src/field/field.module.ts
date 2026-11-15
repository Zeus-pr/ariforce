import { Module } from '@nestjs/common';
import { CheckInsService } from './checkins.service';
import { DevicesController } from './devices.controller';
import { AttendanceController, CheckInsController, UsersController } from './field.controllers';
import { OutletLocationsController } from './outlet-locations.controller';
import { OutletLocationsService } from './outlet-locations.service';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [
    CheckInsController,
    AttendanceController,
    UsersController,
    SettingsController,
    DevicesController,
    OutletLocationsController,
  ],
  providers: [CheckInsService, OutletLocationsService],
  exports: [CheckInsService, OutletLocationsService],
})
export class FieldModule {}
