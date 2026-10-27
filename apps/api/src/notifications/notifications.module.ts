import { Global, Module } from '@nestjs/common';
import { TenantService } from '../common/tenant.service';
import { JobsRunner } from '../jobs/jobs.runner';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Jobs + in-app notifications (#35). Global so leave/expenses can inject NotificationsService. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [TenantService, JobsService, JobsRunner, NotificationsService],
  exports: [JobsService, JobsRunner, NotificationsService],
})
export class NotificationsModule {}
