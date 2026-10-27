import { Module } from '@nestjs/common';
import { ExceptionsController } from './exceptions.controller';
import { ExceptionsService } from './exceptions.service';

/** Exception and Alert Center (#56). JobsService/JobsRunner come from the global NotificationsModule. */
@Module({
  controllers: [ExceptionsController],
  providers: [ExceptionsService],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
