import { Module } from '@nestjs/common';
import { MasterExcelController } from './master-excel.controller';
import { MasterExcelService } from './master-excel.service';
import { VisitBreakdownController } from './visit-breakdown.controller';
import { VisitBreakdownService } from './visit-breakdown.service';

@Module({
  controllers: [MasterExcelController, VisitBreakdownController],
  providers: [MasterExcelService, VisitBreakdownService],
})
export class ReportsModule {}
