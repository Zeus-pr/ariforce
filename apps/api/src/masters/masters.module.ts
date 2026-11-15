import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PlansModule } from '../plans/plans.module';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MASTER_CONTROLLERS } from './masters.controllers';
import { MastersService } from './masters.service';
import { TerritoriesCompactController } from './territories-compact.controller';
import { TerritoryAdminController } from './territory-admin.controller';
import { TerritoryAdminService } from './territory-admin.service';
import { TerritoryLinksService } from './territory-links.service';

@Module({
  imports: [PlansModule, FilesModule],
  controllers: [
    DoctorsController,
    ImportsController,
    TerritoryAdminController,
    TerritoriesCompactController,
    ...MASTER_CONTROLLERS,
  ],
  providers: [
    MastersService,
    ImportsService,
    DoctorsService,
    TerritoryLinksService,
    TerritoryAdminService,
  ],
  exports: [MastersService],
})
export class MastersModule {}
