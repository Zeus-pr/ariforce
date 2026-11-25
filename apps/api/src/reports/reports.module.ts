import { Module } from '@nestjs/common';
import { MasterExcelController } from './master-excel.controller';
import { MasterExcelService } from './master-excel.service';

@Module({
  controllers: [MasterExcelController],
  providers: [MasterExcelService],
})
export class ReportsModule {}
